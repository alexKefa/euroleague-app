import { Component, OnInit, computed, effect, inject, signal, untracked } from "@angular/core";
import { CommonModule } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { EventsService } from "../../core/events.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { BattlesNotificationService } from "../../core/battles-notification.service";
import { BattleDetail, CardPowerBreakdown, Collectible } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { NavIconComponent } from "../../shared/nav-icon";
import { BattlesInfoComponent } from "./battles-info";

// Reveal animation stages, driven purely by CSS classes in
// battle-detail.css — the duel itself is already decided server-side by
// the time this plays; the sequence is pure presentation.
type RevealStage = "idle" | "approaching" | "clashed" | "revealed";

// Matches the backend's BATTLE_STAKE_BASE/CAP and computeStakeForWinProb
// (services/battles.ts) exactly — a real stake taken from the loser's own
// points, not a minted reward (2026-09-22 fix for a live-caught infinite-
// farming exploit), scaled by how big an underdog the winner was
// (2026-09-23 — same odds-weighted shape as predictions' own
// pointsForCorrectPick). Duplicated client-side, not fetched, so the
// picker can preview it live per candidate card with zero extra round
// trips — same "small self-contained duplication is fine" convention this
// app already uses for normalizePlayerName.
const STAKE_BASE = 25;
const STAKE_CAP = 100;
function computeStakeForWinProb(winProb: number): number {
  return Math.min(STAKE_CAP, Math.max(STAKE_BASE, Math.round(STAKE_BASE / winProb)));
}

// Handles three shapes under one component/route: composing a new challenge
// (route id "new", ?leagueId=&opponentUserId=&opponentName=), viewing/
// responding to a pending one, and the finished duel's 3D reveal — the
// card-picker UI is shared by the first two.
@Component({
  selector: "app-battle-detail",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent, ButtonDirective, SkeletonComponent, NavIconComponent, BattlesInfoComponent],
  templateUrl: "./battle-detail.html",
  styleUrl: "./battle-detail.css",
})
export class BattleDetailComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private events = inject(EventsService);
  protected navHistory = inject(NavHistoryService);
  private battlesNotif = inject(BattlesNotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly loading = signal(true);
  readonly notFound = signal(false);
  readonly battle = signal<BattleDetail | null>(null);

  readonly isNew = signal(false);
  private newLeagueId = "";
  private newOpponentUserId = "";
  readonly newOpponentName = signal("");

  readonly stakeBase = STAKE_BASE;
  readonly stakeCap = STAKE_CAP;
  // Fetched the same way Store/Packs already read the spendable balance
  // (PredictionSummary.points) — null while loading, so canAffordStake
  // defaults to false rather than optimistically true.
  readonly myPoints = signal<number | null>(null);

  readonly myCards = signal<Collectible[]>([]);
  // Power score per own card (services/battles.ts's computeCardPowers,
  // 2026-09-22 — direct ask: "stats should also count for the coin flip",
  // which they already did, just invisibly; this surfaces it) — keyed by
  // collectibleId so the picker can show a number per card, and (once the
  // opponent's power is known — composing blind never has one) a live
  // win-chance for whichever card is currently picked.
  // Full breakdown now, not just the total (2026-09-24, "show the cards used
  // with stats") — the picker/waiting screen shows tier vs. real PIR
  // separately, not just an opaque number.
  readonly myCardPowers = signal<Map<string, CardPowerBreakdown & { power: number }>>(new Map());
  readonly pickedId = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly errorKey = signal<string | null>(null);

  readonly revealStage = signal<RevealStage>("idle");
  private hasPlayedReveal = false;
  // Fixed-length array purely so the template can @for 12 confetti pieces —
  // the actual per-piece look (color/position/delay) is deterministic CSS
  // via :nth-child in battle-detail.css, not randomized in JS.
  readonly confettiPieces = Array.from({ length: 12 });

  private get myUserId(): string | null {
    return this.auth.currentUser()?.id ?? null;
  }

  readonly myCard = computed(() => {
    const b = this.battle();
    if (!b) return null;
    return b.challengerUserId === this.myUserId ? b.challengerCard : b.opponentCard;
  });
  readonly theirCard = computed(() => {
    const b = this.battle();
    if (!b) return null;
    return b.challengerUserId === this.myUserId ? b.opponentCard : b.challengerCard;
  });
  readonly didIWin = computed(() => !!this.battle() && this.battle()!.winnerUserId === this.myUserId);
  readonly iAmOpponent = computed(() => !!this.battle() && this.battle()!.opponentUserId === this.myUserId);
  readonly opponentDisplayName = computed(() => {
    const b = this.battle();
    if (!b) return "";
    return b.challengerUserId === this.myUserId ? b.opponentName : b.challengerName;
  });

  // Only meaningful once an opponent power is actually known — the
  // composer (a brand-new challenge) picks blind, with only each card's own
  // power shown; accepting an existing challenge already knows the
  // challenger's power (battle().challengerPower), so picking there gets a
  // live win-%/stake-preview readout instead.
  readonly pickedCardBreakdown = computed(() => {
    const id = this.pickedId();
    return id ? (this.myCardPowers().get(id) ?? null) : null;
  });
  readonly pickedCardPower = computed(() => this.pickedCardBreakdown()?.power ?? null);
  // The full card object behind pickedId (2026-09-24, "show the cards, not
  // just icons of the rarity") — the live matchup panel needs the actual
  // card ref (photo/tier/team) to render a thumbnail, not just its power.
  readonly pickedCard = computed(() => {
    const id = this.pickedId();
    return id ? (this.myCards().find((c) => c.id === id) ?? null) : null;
  });

  // The challenger's own card breakdown, for the "waiting for opponent" and
  // post-reveal stats panels — mirrors pickedCardBreakdown's shape so both
  // can feed the same stat-chip template.
  readonly challengerBreakdown = computed<(CardPowerBreakdown & { power: number }) | null>(() => {
    const b = this.battle();
    return b ? { power: b.challengerPower, ...b.challengerPowerBreakdown } : null;
  });
  readonly opponentBreakdown = computed<(CardPowerBreakdown & { power: number }) | null>(() => {
    const b = this.battle();
    if (!b || b.opponentPower == null || !b.opponentPowerBreakdown) return null;
    return { power: b.opponentPower, ...b.opponentPowerBreakdown };
  });
  // Whichever side of the finished duel is "mine"/"theirs" — myCard/theirCard
  // above already do this split for the card refs, this does it for the
  // matching power breakdown.
  readonly myCardBreakdown = computed(() => {
    const b = this.battle();
    if (!b) return null;
    return b.challengerUserId === this.myUserId ? this.challengerBreakdown() : this.opponentBreakdown();
  });
  readonly theirCardBreakdown = computed(() => {
    const b = this.battle();
    if (!b) return null;
    return b.challengerUserId === this.myUserId ? this.opponentBreakdown() : this.challengerBreakdown();
  });
  // My own win probability going into a *finished* duel — reads the
  // backend's preDuelChallengerWinProb, flipped if I was the opponent, so
  // it reads consistently with the live picker's own myWinProb below.
  readonly myPreDuelWinProb = computed(() => {
    const b = this.battle();
    if (!b || b.preDuelChallengerWinProb == null) return null;
    return b.challengerUserId === this.myUserId ? b.preDuelChallengerWinProb : 1 - b.preDuelChallengerWinProb;
  });
  readonly myPreDuelWinPct = computed(() => {
    const p = this.myPreDuelWinProb();
    return p == null ? null : Math.round(p * 100);
  });
  readonly myWinProb = computed(() => {
    const myPower = this.pickedCardPower();
    const theirPower = this.battle()?.challengerPower;
    if (myPower == null || theirPower == null) return null;
    return myPower / (myPower + theirPower);
  });
  readonly winChancePct = computed(() => {
    const p = this.myWinProb();
    return p == null ? null : Math.round(p * 100);
  });
  // "informed of points he loses" (2026-09-23, direct ask) — shown live as
  // the accepting player picks different cards, not just a flat number:
  // the underdog's card pays out more if it pulls off the upset, and costs
  // more for the favorite to lose with, same odds-weighted shape as
  // predictions' own points formula.
  readonly potentialStakeIfIWin = computed(() => {
    const p = this.myWinProb();
    return p == null ? null : computeStakeForWinProb(p);
  });
  readonly potentialStakeIfILose = computed(() => {
    const p = this.myWinProb();
    return p == null ? null : computeStakeForWinProb(1 - p);
  });
  // What accepting/challenging actually requires you to be able to afford
  // right now — the precise potential loss once a matchup is known
  // (accepting), or just the base rate while still composing blind (no
  // opponent card to weigh against yet), matching the backend's own
  // creation-time gate exactly.
  readonly requiredStake = computed(() => this.potentialStakeIfILose() ?? STAKE_BASE);
  readonly canAffordStake = computed(() => this.myPoints() !== null && this.myPoints()! >= this.requiredStake());

  constructor() {
    // The opponent's browser pushes battle-update via sendToUser on
    // challenge/decline/cancel, and — since accepting resolves the duel
    // immediately server-side — on the finished result too. Re-fetch on
    // receipt rather than trusting the payload, same convention as trades.
    //
    // Real bug caught live (2026-09-22): `current` was read as
    // `this.battle()` directly, which makes `battle` a tracked dependency
    // of this same effect — but refresh() (called from inside this very
    // effect) is what writes `battle`. Every write re-triggered the effect,
    // which (while lastBattleUpdate() still matched) called refresh()
    // again, forever — an infinite fetch loop that also kept restarting
    // the reveal animation, which is what actually made it visible ("laggy,
    // animating without ending"). `untracked()` reads the current value
    // without subscribing to it, so only a genuinely new lastBattleUpdate()
    // push re-runs this effect.
    effect(() => {
      const update = this.events.lastBattleUpdate();
      const current = untracked(() => this.battle());
      if (update && current && update.battleId === current.id) {
        this.refresh(current.id);
      }
    });
  }

  ngOnInit(): void {
    // Subscribed, not just read from the snapshot (same pattern as
    // album.ts) — sendChallenge() navigates from "new" to the real battle
    // id on the same route config, which Angular reuses the component
    // instance for rather than re-running ngOnInit; only a live param
    // subscription picks that transition up.
    this.route.paramMap.subscribe((params) => {
      const id = params.get("id")!;
      this.loading.set(true);
      this.notFound.set(false);
      this.battle.set(null);
      this.myCards.set([]);
      this.myPoints.set(null);
      this.pickedId.set(null);
      this.errorKey.set(null);
      this.revealStage.set("idle");
      this.hasPlayedReveal = false;

      if (id === "new") {
        this.isNew.set(true);
        this.newLeagueId = this.route.snapshot.queryParamMap.get("leagueId") ?? "";
        this.newOpponentUserId = this.route.snapshot.queryParamMap.get("opponentUserId") ?? "";
        this.newOpponentName.set(this.route.snapshot.queryParamMap.get("opponentName") ?? "");
        this.loadMyCards();
        this.loading.set(false);
        return;
      }
      this.isNew.set(false);
      this.refresh(id);
    });
  }

  private refresh(id: string): void {
    this.api.getBattle(id).subscribe({
      next: (b) => {
        this.battle.set(b);
        this.loading.set(false);
        if (b.status === "pending" && b.opponentUserId === this.myUserId && this.myCards().length === 0) {
          this.loadMyCards();
        }
        if (b.status === "finished" && !this.hasPlayedReveal) {
          this.hasPlayedReveal = true;
          this.playReveal();
        }
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  private playReveal(): void {
    this.revealStage.set("idle");
    setTimeout(() => this.revealStage.set("approaching"), 50);
    setTimeout(() => this.revealStage.set("clashed"), 750);
    setTimeout(() => this.revealStage.set("revealed"), 1150);
  }

  private loadMyCards(): void {
    this.api.getMyPredictionSummary().subscribe({
      next: (summary) => this.myPoints.set(summary.points),
      error: () => {}, // non-critical — canAffordStake just stays false, the button disables rather than mis-firing
    });
    this.api.getCollectibles().subscribe({
      next: (catalog) => {
        this.api.getMyCollectibles().subscribe({
          next: (mine) => {
            const ownedIds = new Set(mine.map((m) => m.collectibleId));
            const owned = catalog.filter((c) => c.tier !== "coach" && ownedIds.has(c.id));
            this.myCards.set(owned);
            if (owned.length > 0) {
              this.api.getCardPowers(owned.map((c) => c.id)).subscribe({
                next: (res) =>
                  this.myCardPowers.set(
                    new Map(res.powers.map((p) => [p.collectibleId, { power: p.power, tierBase: p.tierBase, pir: p.pir }]))
                  ),
                error: () => {}, // non-critical — the picker still works, just without the power/win% readout
              });
            }
          },
        });
      },
    });
  }

  pickCard(id: string): void {
    this.pickedId.set(this.pickedId() === id ? null : id);
  }

  // Maps a backend error code to its i18n key where a more specific message
  // exists; falls back to the generic action-failed key otherwise.
  private errorKeyFor(err: unknown, fallback: string): string {
    const code = err instanceof HttpErrorResponse ? err.error?.code : null;
    if (code === "INSUFFICIENT_POINTS") return "battles.insufficientPoints";
    if (code === "CHALLENGER_INSUFFICIENT_POINTS") return "battles.challengerInsufficientPoints";
    return fallback;
  }

  sendChallenge(): void {
    const cardId = this.pickedId();
    if (!cardId || this.submitting() || !this.canAffordStake()) return;
    this.submitting.set(true);
    this.errorKey.set(null);
    this.api.challengeToBattle(this.newLeagueId, this.newOpponentUserId, cardId).subscribe({
      next: (res) => this.router.navigate(["/battles", res.id]),
      error: (err) => {
        this.submitting.set(false);
        this.errorKey.set(this.errorKeyFor(err, "battles.challengeFailed"));
      },
    });
  }

  acceptChallenge(): void {
    const b = this.battle();
    const cardId = this.pickedId();
    if (!b || !cardId || this.submitting() || !this.canAffordStake()) return;
    this.submitting.set(true);
    this.errorKey.set(null);
    this.api.acceptBattle(b.id, cardId).subscribe({
      next: () => {
        this.submitting.set(false);
        this.refresh(b.id);
        this.battlesNotif.refresh(); // accepting is the opponent's own action — no SSE push comes back to them for it, so the badge needs a manual nudge
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
        this.battlesNotif.refresh(); // same self-action gap as acceptChallenge above
        this.router.navigate(["/leagues", b.leagueId]);
      },
    });
  }

  cancelChallenge(): void {
    const b = this.battle();
    if (!b) return;
    this.api.cancelBattle(b.id).subscribe({ next: () => this.router.navigate(["/leagues", b.leagueId]) });
  }

  backFallback(): string {
    const leagueId = this.isNew() ? this.newLeagueId : this.battle()?.leagueId;
    return leagueId ? `/leagues/${leagueId}` : "/leagues";
  }

  // Once a duel is finished there's nothing more to do on this page — send
  // the player straight to the league's Battles tab (not just "back", which
  // could land on whatever unrelated page they arrived from) so they can
  // start or check another one.
  goToBattles(): void {
    const leagueId = this.battle()?.leagueId;
    this.router.navigate(leagueId ? ["/leagues", leagueId] : ["/leagues"], { queryParams: leagueId ? { tab: "battles" } : {} });
  }
}
