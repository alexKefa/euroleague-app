import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { HttpErrorResponse } from "@angular/common/http";
import { FormArray, FormControl, ReactiveFormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { forkJoin, of } from "rxjs";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { Collectible, DUEL_CATEGORIES, DUEL_CATEGORY_SCALES, DuelCard, DuelCategory, FormBadge, MyCollectible } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { normalizePlayerName, quarterScore } from "./duel-helpers";

const LINEUP_SIZE = 5;
const PREVIEW_CHUNK = 60;

type SortKey = "total" | DuelCategory;

interface BuilderCard {
  id: string;
  collectible: Collectible;
  duel: DuelCard;
  playerKey: string;
  scores: Record<DuelCategory, number>;
  total: number;
}

const FORM_ICON: Record<FormBadge, string> = {
  ice_cold: "🧊",
  cold: "↓",
  steady: "→",
  hot: "↑",
  on_fire: "🔥",
};

const INJURY_KEY: Record<string, string> = {
  out: "injuries.statusOut",
  doubtful: "injuries.statusDoubtful",
  questionable: "injuries.statusQuestionable",
  probable: "injuries.statusProbable",
};

/**
 * Four Quarters lineup builder. Three entry points share it: post an open
 * challenge (no params), challenge a player (leagueId / opponentUserId /
 * opponentName), or accept (route /battles/duel/:id/accept). `rematch` is a
 * duel id whose lineup is preselected.
 */
@Component({
  selector: "app-duel-lineup-builder",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, CollectibleCardComponent, ButtonDirective, SkeletonComponent],
  templateUrl: "./duel-lineup-builder.html",
})
export class DuelLineupBuilderComponent implements OnInit {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly categories = DUEL_CATEGORIES;
  readonly lineupSlots = Array.from({ length: LINEUP_SIZE }, (_, i) => i);

  // The 5 chosen card ids ("" = empty slot).
  readonly lineup = new FormArray(Array.from({ length: LINEUP_SIZE }, () => new FormControl<string>("", { nonNullable: true })));
  private readonly lineupIds = toSignal(this.lineup.valueChanges, { initialValue: this.lineup.value });

  readonly loading = signal(true);
  readonly loadFailed = signal(false);
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);
  readonly cards = signal<BuilderCard[]>([]);
  readonly sortBy = signal<SortKey>("total");

  // Accept mode: the duel id; create mode: optional target.
  readonly acceptId = signal<string | null>(null);
  readonly opponentName = signal("");
  private leagueId = "";
  private opponentUserId = "";

  readonly sortKeys: SortKey[] = ["total", ...DUEL_CATEGORIES];

  readonly sorted = computed(() => {
    const key = this.sortBy();
    const list = [...this.cards()];
    list.sort((a, b) => (key === "total" ? b.total - a.total : b.scores[key] - a.scores[key]));
    return list;
  });

  private readonly byId = computed(() => new Map(this.cards().map((c) => [c.id, c])));

  readonly slotCards = computed(() => this.lineupIds().map((id) => (id ? (this.byId().get(id) ?? null) : null)));
  readonly filledCount = computed(() => this.lineupIds().filter((id) => !!id).length);
  private readonly pickedKeys = computed(() => new Set(this.slotCards().filter((c): c is BuilderCard => !!c).map((c) => c.playerKey)));
  readonly canLock = computed(() => this.filledCount() === LINEUP_SIZE && !this.submitting());
  readonly lineupTotal = computed(() => {
    const picked = this.slotCards().filter((c): c is BuilderCard => !!c);
    return Math.round(picked.reduce((s, c) => s + c.total, 0) * 10) / 10;
  });

  ngOnInit(): void {
    const snap = this.route.snapshot;
    this.acceptId.set(snap.paramMap.get("id"));
    this.leagueId = snap.queryParamMap.get("leagueId") ?? "";
    this.opponentUserId = snap.queryParamMap.get("opponentUserId") ?? "";
    this.opponentName.set(snap.queryParamMap.get("opponentName") ?? "");
    const rematch = snap.queryParamMap.get("rematch");

    const acceptId = this.acceptId();
    if (acceptId) {
      // Best effort: show who is challenging.
      this.api.getDuel(acceptId).subscribe({
        next: (d) => this.opponentName.set(d.opponent?.username ?? ""),
        error: () => {},
      });
    }

    this.loadCards(rematch);
  }

  private loadCards(rematch: string | null): void {
    this.api.getCollectibles().subscribe({
      next: (catalog) => {
        this.api.getMyCollectibles().subscribe({
          next: (mine: MyCollectible[]) => {
            const owned = new Set(mine.map((m) => m.collectibleId));
            const playable = catalog.filter((c) => c.tier !== "coach" && owned.has(c.id));
            const finishById = new Map(mine.map((m) => [m.collectibleId, m.finish]));
            if (!playable.length) {
              this.loading.set(false);
              return;
            }
            const chunks: string[][] = [];
            for (let i = 0; i < playable.length; i += PREVIEW_CHUNK) {
              chunks.push(playable.slice(i, i + PREVIEW_CHUNK).map((c) => c.id));
            }
            forkJoin(chunks.map((ids) => this.api.getDuelPreview(ids))).subscribe({
              next: (parts) => {
                const scales = parts[0]?.scales ?? DUEL_CATEGORY_SCALES;
                const duelById = new Map(parts.flatMap((p) => p.cards).map((d) => [d.collectibleId, d]));
                const built: BuilderCard[] = [];
                for (const c of playable) {
                  const duel = duelById.get(c.id);
                  if (!duel) continue;
                  const scoreMap = {} as Record<DuelCategory, number>;
                  let total = 0;
                  for (const cat of DUEL_CATEGORIES) {
                    scoreMap[cat] = quarterScore(duel, cat, scales);
                    total += scoreMap[cat];
                  }
                  built.push({
                    id: c.id,
                    collectible: { ...c, finish: finishById.get(c.id) },
                    duel,
                    playerKey: normalizePlayerName(c.name),
                    scores: scoreMap,
                    total: Math.round(total * 10) / 10,
                  });
                }
                this.cards.set(built);
                if (rematch) this.preselectFrom(rematch);
                else this.loading.set(false);
              },
              error: () => this.fail(),
            });
          },
          error: () => this.fail(),
        });
      },
      error: () => this.fail(),
    });
  }

  private fail(): void {
    this.loading.set(false);
    this.loadFailed.set(true);
  }

  private preselectFrom(duelId: string): void {
    this.api.getDuel(duelId).subscribe({
      next: (d) => {
        const ids = d.myLineup.map((c) => c.collectibleId).filter((id) => this.byId().has(id));
        this.setLineup(ids);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private setLineup(ids: string[]): void {
    const padded = Array.from({ length: LINEUP_SIZE }, (_, i) => ids[i] ?? "");
    this.lineup.setValue(padded);
  }

  isPicked(id: string): boolean {
    return this.lineupIds().includes(id);
  }

  // A card of a player who already holds a slot can't be added.
  isBlocked(card: BuilderCard): boolean {
    return !this.isPicked(card.id) && this.pickedKeys().has(card.playerKey);
  }

  toggle(card: BuilderCard): void {
    this.errorKey.set(null);
    const ids = this.lineup.value as string[];
    const at = ids.indexOf(card.id);
    if (at >= 0) {
      this.lineup.at(at).setValue("");
      return;
    }
    if (this.isBlocked(card)) {
      this.errorKey.set("duels.builder.samePlayer");
      return;
    }
    const free = ids.indexOf("");
    if (free < 0) {
      this.errorKey.set("duels.builder.lineupFull");
      return;
    }
    this.lineup.at(free).setValue(card.id);
  }

  clearSlot(i: number): void {
    this.errorKey.set(null);
    this.lineup.at(i).setValue("");
  }

  autoFill(): void {
    this.errorKey.set(null);
    const best = [...this.cards()].sort((a, b) => b.total - a.total);
    const seen = new Set<string>();
    const picks: string[] = [];
    for (const c of best) {
      if (seen.has(c.playerKey)) continue;
      seen.add(c.playerKey);
      picks.push(c.id);
      if (picks.length === LINEUP_SIZE) break;
    }
    this.setLineup(picks);
  }

  setSort(key: SortKey): void {
    this.sortBy.set(key);
  }

  sortLabel(key: SortKey): string {
    return key === "total" ? this.i18n.t("duels.builder.sortTotal") : this.i18n.t("duels.cat." + key);
  }

  formIcon(badge: FormBadge | null): string {
    return badge ? FORM_ICON[badge] : "";
  }

  injuryLabel(status: string): string {
    return this.i18n.t(INJURY_KEY[status] ?? "injuries.statusOut");
  }

  needText(): string {
    return this.i18n.t("duels.builder.needMore").replace("{n}", String(LINEUP_SIZE - this.filledCount()));
  }

  lock(): void {
    if (!this.canLock()) return;
    const ids = this.lineup.value as string[];
    this.submitting.set(true);
    this.errorKey.set(null);
    const acceptId = this.acceptId();
    const req = acceptId
      ? this.api.acceptDuel(acceptId, ids)
      : this.api.createDuel({
          lineup: ids,
          ...(this.opponentUserId ? { opponentUserId: this.opponentUserId } : {}),
          ...(this.leagueId ? { leagueId: this.leagueId } : {}),
        });
    req.subscribe({
      next: (view) => this.router.navigate(["/battles", "duel", view.id]),
      error: (err: unknown) => {
        this.submitting.set(false);
        const code = err instanceof HttpErrorResponse ? (err.error?.code as string | undefined) : undefined;
        const key = code ? `duels.error.${code}` : "duels.error.generic";
        this.errorKey.set(this.i18n.t(key) === key ? "duels.error.generic" : key);
      },
    });
  }
}
