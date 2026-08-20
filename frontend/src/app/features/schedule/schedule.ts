import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { Game, Team } from "../../core/models";

// The user asked specifically for the 2026-27 schedule — no season picker,
// just round + team filters within that season.
const SEASON = "2026-27";

@Component({
  selector: "app-schedule",
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: "./schedule.html",
})
export class ScheduleComponent implements OnInit {
  private api = inject(ApiService);

  readonly loading = signal(true);
  readonly rounds = signal<number[]>([]);
  readonly currentRound = signal<number | null>(null);
  readonly games = signal<Game[]>([]);
  readonly teams = signal<Team[]>([]);
  readonly teamFilter = signal<string | null>(null);

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
}
