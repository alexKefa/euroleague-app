import { Component, OnInit, inject, signal, computed, effect } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { AuthService } from "../../core/auth.service";
import { EventsService } from "../../core/events.service";
import { Game, Team } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { ButtonDirective } from "../../shared/button.directive";

// The user asked specifically for the 2026-27 schedule — no season picker,
// just round + team filters within that season.
const SEASON = "2026-27";

@Component({
  selector: "app-schedule",
  standalone: true,
  imports: [CommonModule, RouterLink, RetryImgDirective, ButtonDirective],
  templateUrl: "./schedule.html",
})
export class ScheduleComponent implements OnInit {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);
  protected auth = inject(AuthService);
  private events = inject(EventsService);

  readonly loading = signal(true);
  readonly rounds = signal<number[]>([]);
  readonly currentRound = signal<number | null>(null);
  readonly games = signal<Game[]>([]);
  readonly teams = signal<Team[]>([]);
  readonly teamFilter = signal<string | null>(null);
  readonly simulating = signal(false);
  readonly completingSimulation = signal(false);

  constructor() {
    // Live score push: patch the matching game in place instead of
    // refetching the whole round whenever a game-update event arrives.
    effect(() => {
      const update = this.events.lastGameUpdate();
      if (!update) return;
      this.games.update((list) =>
        list.map((g) =>
          g.id === update.gameId
            ? { ...g, homeScore: update.homeScore, awayScore: update.awayScore, status: update.status }
            : g
        )
      );
    });
  }

  readonly hasPrevRound = computed(() => {
    const r = this.currentRound();
    const rounds = this.rounds();
    return r !== null && rounds.length > 0 && r > rounds[0];
  });
  readonly hasNextRound = computed(() => {
    const r = this.currentRound();
    const rounds = this.rounds();
    return r !== null && rounds.length > 0 && r < rounds[rounds.length - 1];
  });

  readonly filteredGames = computed(() => {
    const team = this.teamFilter();
    return this.games().filter((g) => !team || g.homeTeam.id === team || g.awayTeam.id === team);
  });

  // Rounds often span several days — group so each date gets its own header
  // instead of one long undifferentiated list.
  readonly gamesByDate = computed(() => {
    const groups = new Map<string, Game[]>();
    for (const game of this.filteredGames()) {
      const key = new Date(game.tipoffAt).toDateString();
      const arr = groups.get(key) ?? [];
      arr.push(game);
      groups.set(key, arr);
    }
    return [...groups.entries()].map(([date, games]) => ({ date, games }));
  });

  ngOnInit(): void {
    this.api.getTeams().subscribe({ next: (rows) => this.teams.set(rows), error: () => {} });

    this.api.getRounds(SEASON).subscribe({
      next: (info) => this.rounds.set(info.rounds),
      error: () => {},
    });

    // No round param — the backend picks the first non-final round, which
    // saves a round-trip versus fetching rounds first just to find that.
    this.api.getSchedule(SEASON).subscribe({
      next: (schedule) => {
        this.currentRound.set(schedule.round);
        this.games.set(schedule.games);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private loadRound(round: number): void {
    this.loading.set(true);
    this.api.getSchedule(SEASON, round).subscribe({
      next: (schedule) => {
        this.currentRound.set(schedule.round);
        this.games.set(schedule.games);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  selectRound(round: number): void {
    if (round === this.currentRound()) return;
    this.loadRound(round);
  }

  prevRound(): void {
    const r = this.currentRound();
    if (r === null) return;
    const rounds = this.rounds();
    const idx = rounds.indexOf(r);
    if (idx > 0) this.loadRound(rounds[idx - 1]);
  }

  nextRound(): void {
    const r = this.currentRound();
    if (r === null) return;
    const rounds = this.rounds();
    const idx = rounds.indexOf(r);
    if (idx >= 0 && idx < rounds.length - 1) this.loadRound(rounds[idx + 1]);
  }

  gameResult(game: Game): "home" | "away" | null {
    if (game.status !== "final") return null;
    return game.homeScore! > game.awayScore! ? "home" : "away";
  }

  // Admin-only testing tool: EuroLeague's real live feed has nothing to
  // poll until the season starts, so this ticks a real scheduled game
  // through live -> final on a compressed timeline to exercise the SSE
  // push path end-to-end. See backend/src/realtime/liveScoreSimulator.ts.
  simulateLiveGame(): void {
    this.simulating.set(true);
    this.api.simulateLiveGame().subscribe({
      next: () => this.simulating.set(false),
      error: () => this.simulating.set(false),
    });
  }

  // Fast-forwards whatever simulation is running through its remaining
  // ticks (still a full game — scoring, box score, "on fire" streaks —
  // just with no real-time delay), instead of waiting out the full ~96s
  // sequence. Not a truncation at the current score. A no-op (server just
  // replies {running: false}) if nothing's running.
  completeSimulation(): void {
    this.completingSimulation.set(true);
    this.api.completeLiveSimulation().subscribe({
      next: () => this.completingSimulation.set(false),
      error: () => this.completingSimulation.set(false),
    });
  }
}
