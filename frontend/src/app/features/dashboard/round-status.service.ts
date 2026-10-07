import { Injectable, computed, effect, inject, signal, untracked } from "@angular/core";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { EventsService } from "../../core/events.service";
import { PredictionHistoryRound, Schedule, SpinStatus } from "../../core/models";
import { FantasyInput, RoundStatus, buildRoundStatus } from "./round-status.logic";

const SEASON = "2026-27";

/**
 * Loads what the dashboard's round header + checklist need (2026-10-07
 * redesign) from existing endpoints, and recomputes the RoundStatus every
 * second while started. Each source loads on its own: one failing hides
 * only its own checklist row. The Live Center reads `schedule` from here
 * instead of fetching it again.
 */
@Injectable({ providedIn: "root" })
export class RoundStatusService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private events = inject(EventsService);

  private readonly nowSig = signal(Date.now());
  readonly now = this.nowSig.asReadonly();

  private readonly scheduleSig = signal<Schedule | null>(null);
  readonly schedule = this.scheduleSig.asReadonly();
  private readonly scheduleErrorSig = signal(false);
  readonly scheduleError = this.scheduleErrorSig.asReadonly();
  private readonly loadingSig = signal(true);
  readonly loading = this.loadingSig.asReadonly();

  private readonly topScorerGameIds = signal<Set<string> | null>(null);
  private readonly fantasy = signal<FantasyInput | null>(null);
  private readonly spin = signal<SpinStatus | null>(null);
  private readonly history = signal<PredictionHistoryRound[] | null>(null);

  readonly status = computed<RoundStatus | null>(() => {
    const schedule = this.scheduleSig();
    if (!schedule) return null;
    const history = this.history();
    const loggedIn = this.auth.isAuthenticated();
    return buildRoundStatus(
      {
        schedule,
        predictedGameIds: this.events.predictedGameIds(),
        topScorerGameIds: loggedIn ? this.topScorerGameIds() : null,
        fantasy: loggedIn ? this.fantasy() : null,
        spin: loggedIn ? this.spin() : null,
        // Unknown (guest, or history not loaded) is treated as "has picked",
        // so nobody gets the first-run highlight by mistake.
        everPicked: !loggedIn || history === null || history.length > 0 || this.events.predictedGameIds().size > 0,
      },
      this.nowSig()
    );
  });

  readonly roundPoints = computed<number | null>(() => {
    const round = this.scheduleSig()?.round;
    const history = this.history();
    if (round == null || history === null) return null;
    return history.find((r) => r.round === round)?.points ?? 0;
  });

  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisible = () => {
    if (document.visibilityState === "visible") this.refresh();
  };

  constructor() {
    // A game going final can settle points and roll the round over.
    effect(() => {
      const update = this.events.lastGameUpdate();
      if (update?.status !== "final" || this.timer === null) return;
      untracked(() => this.refresh());
    });
  }

  start(): void {
    if (this.timer !== null) return;
    this.nowSig.set(Date.now());
    this.timer = setInterval(() => this.nowSig.set(Date.now()), 1000);
    document.addEventListener("visibilitychange", this.onVisible);
    this.refresh();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.onVisible);
  }

  refresh(): void {
    this.api.getSchedule(SEASON).subscribe({
      next: (s) => {
        this.scheduleSig.set(s);
        this.scheduleErrorSig.set(false);
        this.loadingSig.set(false);
      },
      error: () => {
        this.scheduleErrorSig.set(true);
        this.loadingSig.set(false);
      },
    });
    if (!this.auth.isAuthenticated()) return;

    this.api.getMyTopScorerPredictions().subscribe({
      next: (rows) => this.topScorerGameIds.set(new Set(rows.map((r) => r.gameId))),
      error: () => this.topScorerGameIds.set(null),
    });
    this.api.getFantasyLineup().subscribe({
      next: (lineup) =>
        this.fantasy.set({
          round: lineup.round,
          hasSquad: lineup.players.length > 0,
          lockAt: lineup.lockAt,
          fullTimeoutAvailable: !!lineup.fullTimeoutAvailable,
          carriedOver: lineup.baselinePlayerIds !== null && lineup.transfersUsed === 0,
        }),
      error: () => this.fantasy.set(null),
    });
    this.api.getSpinStatus().subscribe({
      next: (s) => this.spin.set(s),
      error: () => this.spin.set(null),
    });
    this.api.getPredictionHistory().subscribe({
      next: (h) => this.history.set(h),
      error: () => this.history.set(null),
    });
  }
}
