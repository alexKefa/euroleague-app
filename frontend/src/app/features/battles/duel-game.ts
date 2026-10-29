import { Component, DestroyRef, OnInit, computed, effect, inject, signal, untracked } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { EventsService } from "../../core/events.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { CollectibleTier, DUEL_CATEGORY_SCALES, DuelCard, DuelCategory, DuelView } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { quarterScore } from "./duel-helpers";

interface Reveal {
  label: string;
  mine: DuelCard | null;
  theirs: DuelCard | null;
  myScore: number;
  theirScore: number;
}

/** Four Quarters game screen: scoreboard, hand, reveal, full time. */
@Component({
  selector: "app-duel-game",
  standalone: true,
  imports: [RouterLink, CollectibleCardComponent, ButtonDirective, SkeletonComponent],
  templateUrl: "./duel-game.html",
  styleUrl: "./duel-game.css",
})
export class DuelGameComponent implements OnInit {
  private api = inject(ApiService);
  private events = inject(EventsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);

  readonly quarterCols = [1, 2, 3, 4];
  readonly sides = [0, 1];
  private id = "";
  private loadSeq = 0;
  readonly forbidden = signal(false);

  readonly view = signal<DuelView | null>(null);
  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly selected = signal<number | null>(null);
  readonly committing = signal(false);
  readonly acting = signal(false);
  readonly noteKey = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly reveal = signal<Reveal | null>(null);
  // Count-up display values for the reveal.
  readonly shownMine = signal(0);
  readonly shownTheirs = signal(0);
  private revealTimer: ReturnType<typeof setInterval> | null = null;
  private revealHide: ReturnType<typeof setTimeout> | null = null;

  readonly isPending = computed(() => {
    const s = this.view()?.status;
    return s === "pending" || s === "open";
  });
  readonly isActive = computed(() => this.view()?.status === "active");
  readonly isFinished = computed(() => this.view()?.status === "finished");
  // The invited side (or anyone viewing an open challenge that isn't theirs).
  readonly canAccept = computed(() => this.isPending() && this.view()?.side === "opponent");
  readonly canDecline = computed(() => this.view()?.status === "pending" && this.view()?.side === "opponent");
  readonly canCancel = computed(() => this.isPending() && this.view()?.side === "challenger");

  readonly currentCategory = computed<DuelCategory | null>(() => {
    const v = this.view();
    if (!v || !this.isActive()) return null;
    if (v.quarter > 4) return "efficiency";
    return v.categories[v.quarter - 1] ?? null;
  });
  readonly nextCategory = computed<DuelCategory | null>(() => {
    const v = this.view();
    if (!v || !this.isActive() || v.quarter >= 4) return null;
    return v.categories[v.quarter] ?? null;
  });

  readonly myUsed = computed(() => this.usedSlots("mine"));
  readonly theirUsed = computed(() => this.usedSlots("theirs"));

  readonly myScores = computed(() => this.scoresFor(this.view()?.myLineup ?? []));
  readonly theirScores = computed(() => this.scoresFor(this.view()?.theirLineup ?? []));

  readonly canCommit = computed(() => this.isActive() && !this.view()?.iCommitted && this.selected() !== null && !this.committing());

  readonly countdown = computed(() => {
    const v = this.view();
    if (!v) return null;
    const target = this.isPending() ? v.expiresAt : this.isActive() ? v.quarterDeadline : null;
    if (!target) return null;
    const ms = new Date(target).getTime() - this.now();
    if (ms <= 0) return "0:00";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const two = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
  });

  readonly rematchParams = computed(() => {
    const v = this.view();
    if (!v?.opponent) return null;
    const q: Record<string, string> = { opponentUserId: v.opponent.id, opponentName: v.opponent.username, rematch: v.id };
    if (v.leagueId) q["leagueId"] = v.leagueId;
    return q;
  });

  readonly reasonKey = computed(() => {
    const r = this.view()?.finishReason;
    if (!r) return null;
    const key = `duels.game.reason.${r}`;
    return this.i18n.t(key) === key ? null : key;
  });

  constructor() {
    // Live updates: refetch when this duel changes. The fetch runs untracked.
    effect(() => {
      const u = this.events.lastDuelUpdate();
      if (!u || !this.id || u.id !== this.id) return;
      untracked(() => this.load(false));
    });
  }

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get("id") ?? "";
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => {
      clearInterval(tick);
      this.clearRevealTimers();
    });
    this.load(true);
  }

  private usedSlots(who: "mine" | "theirs"): Set<number> {
    const v = this.view();
    const used = new Set<number>();
    if (!v) return used;
    for (const q of v.quarters) {
      const slot = who === "mine" ? q.mySlot : q.theirSlot;
      if (slot !== null) used.add(slot);
    }
    return used;
  }

  private scoresFor(cards: DuelCard[]): (number | null)[] {
    const cat = this.currentCategory();
    return cards.map((c) => (cat ? quarterScore(c, cat, DUEL_CATEGORY_SCALES) : null));
  }

  private load(initial: boolean): void {
    const seq = ++this.loadSeq;
    this.api.getDuel(this.id).subscribe({
      next: (v) => {
        if (seq !== this.loadSeq) return;
        const prev = this.view();
        this.view.set(v);
        this.loading.set(false);
        this.loadFailed.set(false);
        if (!initial && prev) this.detectReveal(prev, v);
        // Drop a selection that is no longer playable.
        const sel = this.selected();
        if (sel !== null && (this.myUsed().has(sel) || v.iCommitted || v.status !== "active")) this.selected.set(null);
      },
      error: (err: unknown) => {
        if (seq !== this.loadSeq) return;
        this.loading.set(false);
        if (err instanceof HttpErrorResponse && err.status === 403) this.forbidden.set(true);
        if (!this.view()) this.loadFailed.set(true);
      },
    });
  }

  // A quarter (or overtime) that has a score now but didn't before.
  private detectReveal(prev: DuelView, next: DuelView): void {
    const fresh = next.quarters
      .filter((q) => q.myScore !== null && q.theirScore !== null && !prev.quarters.find((p) => p.quarter === q.quarter && p.myScore !== null))
      .sort((a, b) => b.quarter - a.quarter)[0];
    const pending: Reveal[] = [];
    if (fresh) {
      pending.push({
        label: this.i18n.t("duels.game.resolved").replace("{n}", String(fresh.quarter)),
        mine: fresh.mySlot !== null ? (next.myLineup[fresh.mySlot] ?? null) : null,
        theirs: fresh.theirSlot !== null ? (next.theirLineup?.[fresh.theirSlot] ?? null) : null,
        myScore: fresh.myScore ?? 0,
        theirScore: fresh.theirScore ?? 0,
      });
    }
    if (next.overtime && !prev.overtime) {
      const ot = next.overtime;
      pending.push({
        label: this.i18n.t("duels.overtime"),
        mine: next.myLineup[ot.mySlot] ?? null,
        theirs: next.theirLineup?.[ot.theirSlot] ?? null,
        myScore: ot.myScore,
        theirScore: ot.theirScore,
      });
    }
    if (!pending.length) return;
    this.revealQueue = pending;
    this.nextReveal();
  }

  private clearRevealTimers(): void {
    if (this.revealTimer) clearInterval(this.revealTimer);
    if (this.revealHide) clearTimeout(this.revealHide);
    this.revealTimer = null;
    this.revealHide = null;
  }

  private revealQueue: Reveal[] = [];

  private nextReveal(): void {
    const r = this.revealQueue.shift();
    if (r) this.startReveal(r);
    else this.reveal.set(null);
  }

  private startReveal(r: Reveal): void {
    this.clearRevealTimers();
    this.reveal.set(r);
    this.shownMine.set(0);
    this.shownTheirs.set(0);
    const steps = 20;
    let i = 0;
    this.revealTimer = setInterval(() => {
      i++;
      const t = Math.min(1, i / steps);
      const e = 1 - Math.pow(1 - t, 3);
      this.shownMine.set(Math.round(r.myScore * e * 10) / 10);
      this.shownTheirs.set(Math.round(r.theirScore * e * 10) / 10);
      if (t >= 1 && this.revealTimer) {
        clearInterval(this.revealTimer);
        this.revealTimer = null;
      }
    }, 60);
    this.revealHide = setTimeout(() => this.nextReveal(), 4500);
  }

  dismissReveal(): void {
    this.clearRevealTimers();
    this.nextReveal();
  }

  tier(c: DuelCard): CollectibleTier {
    return c.tier as CollectibleTier;
  }

  pick(slot: number): void {
    const v = this.view();
    if (!v || !this.isActive() || v.iCommitted || this.myUsed().has(slot)) return;
    this.selected.set(this.selected() === slot ? null : slot);
    this.noteKey.set(null);
  }

  quarterCell(q: number): { me: number | null; them: number | null } {
    const row = this.view()?.quarters.find((x) => x.quarter === q);
    return { me: row?.myScore ?? null, them: row?.theirScore ?? null };
  }

  commit(): void {
    const v = this.view();
    const slot = this.selected();
    if (!v || slot === null || this.committing()) return;
    this.committing.set(true);
    this.noteKey.set(null);
    this.api.commitDuelMove(v.id, v.quarter, slot).subscribe({
      next: (next) => {
        this.loadSeq++;
        this.committing.set(false);
        this.selected.set(null);
        const prev = this.view();
        this.view.set(next);
        if (prev) this.detectReveal(prev, next);
      },
      error: (err: unknown) => {
        this.committing.set(false);
        const code = err instanceof HttpErrorResponse ? (err.error?.code as string | undefined) : undefined;
        if (code === "QUARTER_CHANGED" || code === "SLOT_USED") {
          this.selected.set(null);
          this.noteKey.set(`duels.error.${code}`);
          this.load(false);
          return;
        }
        const key = code ? `duels.error.${code}` : "duels.error.generic";
        this.noteKey.set(this.i18n.t(key) === key ? "duels.error.generic" : key);
      },
    });
  }

  decline(): void {
    this.act(this.api.declineDuel(this.id));
  }

  cancel(): void {
    this.act(this.api.cancelDuel(this.id));
  }

  private act(req: ReturnType<ApiService["declineDuel"]>): void {
    if (this.acting()) return;
    this.acting.set(true);
    req.subscribe({
      next: () => {
        this.acting.set(false);
        this.router.navigateByUrl(this.navHistory.previousUrl() ?? "/battles");
      },
      error: () => {
        this.acting.set(false);
        this.noteKey.set("duels.error.generic");
        this.load(false);
      },
    });
  }
}
