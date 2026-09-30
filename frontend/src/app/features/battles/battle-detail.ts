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
import { BattleDetail, CardStatLine, Collectible, DUEL_STATS, DuelRound, DuelStat, StatLine } from "../../core/models";
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

// Same rules as the backend's resolveStatDuel (services/statDuel.ts), used
// only to preview a win chance while accepting. The duel itself is always
// resolved server-side.
function roundWinner(stat: DuelStat, c: StatLine, o: StatLine): Side {
  if (c[stat] !== o[stat]) return c[stat] > o[stat] ? "challenger" : "opponent";
  if (c.pir !== o.pir) return c.pir > o.pir ? "challenger" : "opponent";
  return "challenger";
}

function opponentWinProb(challengerStat: DuelStat, opponentStat: DuelStat, c: StatLine, o: StatLine): number {
  const picked = challengerStat === opponentStat ? [challengerStat] : [challengerStat, opponentStat];
  const remaining = DUEL_STATS.filter((s) => !picked.includes(s));
  const draws: DuelStat[][] =
    picked.length === 2
      ? remaining.map((s) => [s])
      : remaining.flatMap((a, i) => remaining.slice(i + 1).map((b) => [a, b]));
  const wins = draws.filter((draw) => {
    const opponentRounds = [...picked, ...draw].filter((s) => roundWinner(s, c, o) === "opponent").length;
    return opponentRounds >= 2;
  }).length;
  return wins / draws.length;
}

/**
 * One route for every battle state: composing a challenge ("new"),
 * accepting or waiting on a pending one, and the finished duel's reveal.
 * Stat duel (v4, 2026-09-30): pick a card, then a category; best of three
 * categories wins. Finished v3 coin-flip battles still render (mode
 * "coinFlip"), without rounds.
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

  readonly stats = DUEL_STATS;
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
  readonly pickedStat = signal<DuelStat | null>(null);
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
  // The challenger's card line, known while accepting (only their category is hidden).
  readonly theirLine = computed(() => this.battle()?.challengerStats ?? null);
  // Best category for each card in the grid, so the picker hints at a
  // card's strength before you tap it.
  readonly bestStatByCard = computed(() => {
    const map = new Map<string, DuelStat>();
    for (const [id, line] of this.myCardStats()) {
      map.set(id, [...DUEL_STATS].sort((a, b) => this.relativeStrength(line.raw, b) - this.relativeStrength(line.raw, a))[0]);
    }
    return map;
  });

  // Accepting: my chance averaged over whatever the challenger might have
  // picked (their category is hidden), given my current card + category.
  readonly acceptWinPct = computed(() => {
    const mine = this.pickedLine();
    const theirs = this.theirLine();
    const stat = this.pickedStat();
    if (!mine || !theirs || !stat) return null;
    const avg = DUEL_STATS.reduce((sum, c) => sum + opponentWinProb(c, stat, theirs.boosted, mine.boosted), 0) / DUEL_STATS.length;
    return Math.round(avg * 100);
  });

  readonly canAffordStake = computed(() => this.myPoints() !== null && this.myPoints()! >= STAKE_BASE);
  readonly canSubmit = computed(() => !!this.pickedId() && !!this.pickedStat() && !this.submitting() && this.canAffordStake());

  // Finished stat duel.
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
      this.pickedStat.set(null);
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
    const total = b.duelRounds?.length ?? 0;
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
    this.revealedRounds.set(this.battle()?.duelRounds?.length ?? 0);
    this.revealDone.set(true);
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
                // Strongest cards first (sum of boosted stats relative to
                // typical values), so the best picks are at the top.
                this.myCards.set(
                  [...owned].sort((a, b) => this.overall(stats.get(b.id)) - this.overall(stats.get(a.id)))
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

  // Rough per-stat scale so "strongest category" compares like with like
  // (5 rebounds is a lot more than 5 points). Display-only.
  private static readonly TYPICAL: StatLine = { points: 10, rebounds: 4, assists: 2.5, steals: 0.8, blocks: 0.4, pir: 10 };
  private relativeStrength(line: StatLine, stat: DuelStat): number {
    return line[stat] / BattleDetailComponent.TYPICAL[stat];
  }
  private overall(line: CardStatLine | undefined): number {
    if (!line) return 0;
    return DUEL_STATS.reduce((sum, s) => sum + line.boosted[s] / BattleDetailComponent.TYPICAL[s], 0);
  }

  pickCard(id: string): void {
    if (this.pickedId() === id) return;
    this.pickedId.set(id);
    // Preselect the card's best category, still one tap to change.
    this.pickedStat.set(this.bestStatByCard().get(id) ?? null);
  }

  pickStat(stat: DuelStat): void {
    this.pickedStat.set(stat);
  }

  statLabel(stat: DuelStat | null): string {
    return stat ? this.i18n.t(`battles.stat.${stat}`) : "";
  }

  // Rarity boost and injury penalty, shown separately under the stat grid.
  // The rarity part is the multiplier with the injury factor divided back out.
  private static readonly INJURY_FACTOR: Record<string, number> = { out: 0.75, doubtful: 0.85, questionable: 0.9, probable: 1 };
  rarityPct(line: CardStatLine): number {
    const injury = line.injury ? BattleDetailComponent.INJURY_FACTOR[line.injury] : 1;
    return Math.round((line.multiplier / injury - 1) * 100);
  }
  injuryPct(line: CardStatLine): number {
    return line.injury ? Math.round((1 - BattleDetailComponent.INJURY_FACTOR[line.injury]) * 100) : 0;
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
    const stat = this.pickedStat();
    if (!cardId || !stat || !this.canSubmit()) return;
    this.submitting.set(true);
    this.errorKey.set(null);
    this.api.challengeToBattle(this.newLeagueId, this.newOpponentUserId, cardId, stat).subscribe({
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
    const stat = this.pickedStat();
    if (!b || !cardId || !stat || !this.canSubmit()) return;
    this.submitting.set(true);
    this.errorKey.set(null);
    this.api.acceptBattle(b.id, cardId, stat).subscribe({
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
