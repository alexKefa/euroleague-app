import { Component, OnDestroy, OnInit, computed, effect, inject, signal, untracked } from "@angular/core";
import { CommonModule } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { EventsService } from "../../core/events.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { BattlesNotificationService } from "../../core/battles-notification.service";
import { BattleDetail, BattlePower, CardStatLine, Collectible, DuelRound, DuelStat } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { NavIconComponent } from "../../shared/nav-icon";
import { BattlesInfoComponent } from "./battles-info";

// Mirrors the backend's BATTLE_STAKE_BASE/CAP (services/battles.ts) for the
// stake range shown before committing.
const STAKE_BASE = 25;
const STAKE_CAP = 100;

// Reveal pacing (stat duel): cards slide in, then one round every
// ROUND_MS, then the result. Skippable, and instant under reduced motion.
const INTRO_MS = 600;
const ROUND_MS = 1100;

type Side = "challenger" | "opponent";

/**
 * One route for every battle state: composing a challenge ("new"),
 * accepting or waiting on a pending one, and the finished duel's reveal.
 * Power battle (v5, 2026-10-09): pick a card; rarity, then PIR average,
 * then form make its power, and a weighted draw decides. Finished v4 stat
 * duels (rounds) and v3 coin flips still render in their own modes.
 */
@Component({
  selector: "app-battle-detail",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent, ButtonDirective, SkeletonComponent, NavIconComponent, BattlesInfoComponent],
  templateUrl: "./battle-detail.html",
  styleUrl: "./battle-detail.css",
})
export class BattleDetailComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private events = inject(EventsService);
  protected navHistory = inject(NavHistoryService);
  private battlesNotif = inject(BattlesNotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly stakeBase = STAKE_BASE;
  readonly stakeCap = STAKE_CAP;

  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly battle = signal<BattleDetail | null>(null);

  readonly isNew = signal(false);
  private newLeagueId = "";
  private newOpponentUserId = "";
  readonly newOpponentName = signal("");

  readonly myPoints = signal<number | null>(null);
  readonly myCards = signal<Collectible[]>([]);
  readonly myCardsLoading = signal(false);
  readonly myCardStats = signal<Map<string, CardStatLine>>(new Map());
  readonly pickedId = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);

  // Reveal: -1 = intro (cards sliding in), 0..n = rounds shown so far,
  // `done` once the result is on screen.
  readonly revealedRounds = signal(0);
  readonly revealDone = signal(false);
  private revealTimers: ReturnType<typeof setTimeout>[] = [];
  private hasPlayedReveal = false;
  readonly confettiPieces = Array.from({ length: 12 });

  private get myUserId(): string | null {
    return this.auth.currentUser()?.id ?? null;
  }

  readonly iAmChallenger = computed(() => !!this.battle() && this.battle()!.challengerUserId === this.myUserId);
  readonly iAmOpponent = computed(() => !!this.battle() && this.battle()!.opponentUserId === this.myUserId);
  readonly mySide = computed<Side>(() => (this.iAmChallenger() ? "challenger" : "opponent"));
  readonly didIWin = computed(() => !!this.battle() && this.battle()!.winnerUserId === this.myUserId);
  readonly opponentDisplayName = computed(() => {
    const b = this.battle();
    if (!b) return this.newOpponentName();
    return this.iAmChallenger() ? b.opponentName : b.challengerName;
  });
  readonly myCard = computed(() => {
    const b = this.battle();
    if (!b) return null;
    return this.iAmChallenger() ? b.challengerCard : b.opponentCard;
  });
  readonly theirCard = computed(() => {
    const b = this.battle();
    if (!b) return null;
    return this.iAmChallenger() ? b.opponentCard : b.challengerCard;
  });

  // Rarity filter for the card rail — collections get long, and a filter
  // is the quickest way to "show me my legendaries".
  readonly tierFilter = signal<"all" | "legendary" | "rare" | "common">("all");
  readonly tierCounts = computed(() => {
    const counts = { all: 0, legendary: 0, rare: 0, common: 0 } as Record<"all" | "legendary" | "rare" | "common", number>;
    for (const c of this.myCards()) {
      counts.all++;
      if (c.tier === "legendary" || c.tier === "rare" || c.tier === "common") counts[c.tier]++;
    }
    return counts;
  });
  readonly tierOptions = computed(() =>
    (["all", "legendary", "rare", "common"] as const).filter((t) => t === "all" || this.tierCounts()[t] > 0)
  );
  readonly visibleCards = computed(() => {
    const f = this.tierFilter();
    return f === "all" ? this.myCards() : this.myCards().filter((c) => c.tier === f);
  });

  // Picker state.
  readonly pickedCard = computed(() => {
    const id = this.pickedId();
    return id ? (this.myCards().find((c) => c.id === id) ?? null) : null;
  });
  readonly pickedLine = computed(() => {
    const id = this.pickedId();
    return id ? (this.myCardStats().get(id) ?? null) : null;
  });
  // Power of each of my cards (v5), from POST /battles/card-stats.
  readonly myCardPower = computed(() => {
    const map = new Map<string, BattlePower>();
    for (const [id, line] of this.myCardStats()) if (line.power) map.set(id, line.power);
    return map;
  });
  readonly pickedPower = computed(() => {
    const id = this.pickedId();
    return id ? (this.myCardPower().get(id) ?? null) : null;
  });
  // The challenger's power, shown while accepting (cards are public).
  readonly theirPower = computed(() => this.battle()?.power?.challenger ?? null);

  // Accepting: my exact chance, my power out of both powers.
  readonly acceptWinPct = computed(() => {
    const mine = this.pickedPower();
    const theirs = this.theirPower();
    if (!mine || !theirs) return null;
    return Math.round((mine.power / (mine.power + theirs.power)) * 100);
  });

  readonly canAffordStake = computed(() => this.myPoints() !== null && this.myPoints()! >= STAKE_BASE);
  readonly canSubmit = computed(() => !!this.pickedId() && !this.submitting() && this.canAffordStake());

  // Finished v5 power battle: rows revealed one by one, then the result.
  readonly powerRows = computed(() => {
    const p = this.battle()?.power;
    if (!p || !p.opponent) return [];
    const mine = this.mySide() === "challenger" ? p.challenger : p.opponent;
    const theirs = this.mySide() === "challenger" ? p.opponent : p.challenger;
    return (["rarity", "pir", "form", "power"] as const).map((key) => ({ key, mine: mine[key], theirs: theirs[key] }));
  });
  readonly myWinPct = computed(() => {
    const prob = this.battle()?.power?.challengerWinProb;
    if (prob == null) return null;
    return Math.round((this.mySide() === "challenger" ? prob : 1 - prob) * 100);
  });

  // Finished v4 stat duel.
  readonly rounds = computed<DuelRound[]>(() => this.battle()?.duelRounds ?? []);
  readonly myScore = computed(() => this.rounds().slice(0, this.revealedRounds()).filter((r) => r.winner === this.mySide()).length);
  readonly theirScore = computed(() => this.rounds().slice(0, this.revealedRounds()).filter((r) => r.winner !== this.mySide()).length);

  constructor() {
    // Re-fetch on a live battle-update push for this battle (the opponent
    // accepting resolves the duel). untracked() so writing `battle` from
    // refresh() can't re-trigger this effect.
    effect(() => {
      const update = this.events.lastBattleUpdate();
      const current = untracked(() => this.battle());
      if (update && current && update.battleId === current.id) this.refresh(current.id);
    });
  }

  ngOnInit(): void {
    // Subscribed, not a snapshot: sending a challenge navigates from "new"
    // to the real id on the same component instance.
    this.route.paramMap.subscribe((params) => {
      const id = params.get("id")!;
      this.clearRevealTimers();
      this.loading.set(true);
      this.notFound.set(false);
      this.battle.set(null);
      this.pickedId.set(null);
      this.errorKey.set(null);
      this.revealedRounds.set(0);
      this.revealDone.set(false);
      this.hasPlayedReveal = false;

      if (id === "new") {
        this.isNew.set(true);
        const q = this.route.snapshot.queryParamMap;
        this.newLeagueId = q.get("leagueId") ?? "";
        this.newOpponentUserId = q.get("opponentUserId") ?? "";
        this.newOpponentName.set(q.get("opponentName") ?? "");
        this.loadMyCards();
        this.loading.set(false);
        return;
      }
      this.isNew.set(false);
      this.refresh(id);
    });
  }

  ngOnDestroy(): void {
    this.clearRevealTimers();
  }

  private refresh(id: string): void {
    this.api.getBattle(id).subscribe({
      next: (b) => {
        this.battle.set(b);
        this.loading.set(false);
        if (b.status === "pending" && b.opponentUserId === this.myUserId && this.myCards().length === 0) this.loadMyCards();
        if (b.status === "finished" && !this.hasPlayedReveal) {
          this.hasPlayedReveal = true;
          this.playReveal(b);
        }
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  private playReveal(b: BattleDetail): void {
    const total = this.revealSteps(b);
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || total === 0) {
      this.skipReveal();
      return;
    }
    this.revealedRounds.set(0);
    this.revealDone.set(false);
    for (let i = 1; i <= total; i++) {
      this.revealTimers.push(setTimeout(() => this.revealedRounds.set(i), INTRO_MS + (i - 1) * ROUND_MS));
    }
    this.revealTimers.push(setTimeout(() => this.revealDone.set(true), INTRO_MS + total * ROUND_MS));
  }

  skipReveal(): void {
    this.clearRevealTimers();
    const b = this.battle();
    this.revealedRounds.set(b ? this.revealSteps(b) : 0);
    this.revealDone.set(true);
  }

  // v4: one step per round; v5: one per power row; v3: none.
  private revealSteps(b: BattleDetail): number {
    if (b.mode === "statDuel") return b.duelRounds?.length ?? 0;
    if (b.mode === "power") return b.power?.opponent ? 4 : 0;
    return 0;
  }

  private clearRevealTimers(): void {
    this.revealTimers.forEach(clearTimeout);
    this.revealTimers = [];
  }

  private loadMyCards(): void {
    this.myCardsLoading.set(true);
    this.api.getMyPredictionSummary().subscribe({
      next: (summary) => this.myPoints.set(summary.points),
      error: () => {},
    });
    this.api.getCollectibles().subscribe({
      next: (catalog) => {
        this.api.getMyCollectibles().subscribe({
          next: (mine) => {
            const finishById = new Map(mine.map((m) => [m.collectibleId, m.finish]));
            const owned = catalog
              .filter((c) => c.tier !== "coach" && finishById.has(c.id))
              .map((c) => ({ ...c, finish: finishById.get(c.id) }));
            if (owned.length === 0) {
              this.myCards.set([]);
              this.myCardsLoading.set(false);
              return;
            }
            this.api.getCardStats(owned.map((c) => c.id)).subscribe({
              next: (res) => {
                const stats = new Map<string, CardStatLine>(res.stats.map(({ collectibleId, finish, ...line }) => [collectibleId, line]));
                this.myCardStats.set(stats);
                // Strongest cards first by v5 power.
                this.myCards.set(
                  [...owned].sort((a, b) => (stats.get(b.id)?.power?.power ?? 0) - (stats.get(a.id)?.power?.power ?? 0))
                );
                this.myCardsLoading.set(false);
              },
              error: () => {
                this.myCards.set(owned);
                this.myCardsLoading.set(false);
              },
            });
          },
          error: () => this.myCardsLoading.set(false),
        });
      },
      error: () => this.myCardsLoading.set(false),
    });
  }

  pickCard(id: string): void {
    if (this.pickedId() === id) return;
    this.pickedId.set(id);
  }

  statLabel(stat: DuelStat | null): string {
    return stat ? this.i18n.t(`battles.stat.${stat}`) : "";
  }

  // Signed one-decimal for power parts (form can be negative).
  part(value: number, key: string): string {
    if (key === "form") return `${value > 0 ? "+" : ""}${value}`;
    return String(value);
  }

  statShort(stat: DuelStat): string {
    return this.i18n.t(`battles.statShort.${stat}`);
  }

  // Bar width for a round's comparison, relative to the larger value.
  barPct(value: number, other: number): number {
    const max = Math.max(value, other);
    return max > 0 ? Math.max(6, Math.round((value / max) * 100)) : 6;
  }

  mineOf(round: DuelRound): number {
    return this.mySide() === "challenger" ? round.challengerValue : round.opponentValue;
  }
  theirsOf(round: DuelRound): number {
    return this.mySide() === "challenger" ? round.opponentValue : round.challengerValue;
  }
  iWonRound(round: DuelRound): boolean {
    return round.winner === this.mySide();
  }
  roundSourceKey(round: DuelRound): string {
    if (round.source === "random") return "battles.roundRandom";
    if (round.source === "both") return "battles.roundBoth";
    return round.source === this.mySide() ? "battles.roundYourPick" : "battles.roundTheirPick";
  }

  private errorKeyFor(err: unknown, fallback: string): string {
    const code = err instanceof HttpErrorResponse ? err.error?.code : null;
    if (code === "INSUFFICIENT_POINTS") return "battles.insufficientPoints";
    if (code === "BATTLE_NOT_PENDING") return "battles.notPending";
    return fallback;
  }

  sendChallenge(): void {
    const cardId = this.pickedId();
    if (!cardId || !this.canSubmit()) return;
    this.submitting.set(true);
    this.errorKey.set(null);
    this.api.challengeToBattle(this.newLeagueId, this.newOpponentUserId, cardId).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.router.navigate(["/battles", res.id], { replaceUrl: true });
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorKey.set(this.errorKeyFor(err, "battles.challengeFailed"));
      },
    });
  }

  acceptChallenge(): void {
    const b = this.battle();
    const cardId = this.pickedId();
    if (!b || !cardId || !this.canSubmit()) return;
    this.submitting.set(true);
    this.errorKey.set(null);
    this.api.acceptBattle(b.id, cardId).subscribe({
      next: () => {
        this.submitting.set(false);
        this.refresh(b.id);
        this.battlesNotif.refresh(); // no SSE push comes back for your own accept
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorKey.set(this.errorKeyFor(err, "battles.acceptFailed"));
      },
    });
  }

  declineChallenge(): void {
    const b = this.battle();
    if (!b) return;
    this.api.declineBattle(b.id).subscribe({
      next: () => {
        this.battlesNotif.refresh();
        this.router.navigate(["/battles"]);
      },
    });
  }

  cancelChallenge(): void {
    const b = this.battle();
    if (!b) return;
    this.api.cancelBattle(b.id).subscribe({ next: () => this.router.navigate(["/battles"]) });
  }

  rematch(): void {
    const b = this.battle();
    if (!b) return;
    const opponentUserId = this.iAmChallenger() ? b.opponentUserId : b.challengerUserId;
    this.router.navigate(["/battles", "new"], {
      queryParams: { leagueId: b.leagueId, opponentUserId, opponentName: this.opponentDisplayName() },
    });
  }
}
