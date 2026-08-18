import { Component, OnInit, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { AuthService } from "../../core/auth.service";
import { Team, RosterEntry, Game } from "../../core/models";

@Component({
  selector: "app-team-roster",
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: "./roster.html",
})
export class TeamRosterComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  protected auth = inject(AuthService);

  readonly team = signal<Team | null>(null);
  readonly roster = signal<RosterEntry[]>([]);
  readonly upcomingGames = signal<Game[]>([]);
  readonly recentGames = signal<Game[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  // gameId -> predicted team id, for games the user has already picked
  readonly myPicks = signal<Map<string, string>>(new Map());

  ngOnInit(): void {
    const teamId = this.route.snapshot.paramMap.get("id");
    if (!teamId) {
      this.error.set("No team specified.");
      this.loading.set(false);
      return;
    }

    // Team list doesn't have a single-team-by-id endpoint yet, so pull
    // it from the full list — fine at 20 teams, worth a dedicated
    // GET /api/teams/:id if this ever needs to scale.
    this.api.getTeams().subscribe({
      next: (teams) => {
        const team = teams.find((t) => t.id === teamId) ?? null;
        this.team.set(team);
        this.theme.applyTeam(team);
      },
    });

    this.api.getTeamGames(teamId).subscribe({
      next: (allGames) => {
        // Games come back chronological ascending — split into
        // upcoming (soonest first) and recent results (most recent first).
        this.upcomingGames.set(allGames.filter((g) => g.status === "scheduled").slice(0, 5));
        this.recentGames.set(
          allGames
            .filter((g) => g.status === "final")
            .slice(-5)
            .reverse()
        );
      },
    });

    this.api.getRoster(teamId).subscribe({
      next: (rows) => {
        this.roster.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.error.set("Couldn't load the roster.");
        this.loading.set(false);
      },
    });

    if (this.auth.isAuthenticated()) {
      this.api.getMyPredictions().subscribe({
        next: (predictions) => {
          const map = new Map<string, string>();
          for (const p of predictions) map.set(p.gameId, p.predictedTeam.id);
          this.myPicks.set(map);
        },
        error: () => {}, // non-critical
      });
    }
  }

  /**
   * Tailwind classes for a PIR rating pill. Thresholds are rough EuroLeague
   * norms (season PIR leaders land ~22-25, solid rotation players ~12-19,
   * limited-minutes players below that) — not an official grading scale,
   * just a reasonable visual split.
   */
  pirBadgeClass(value: number | null): string {
    if (value === null) return "bg-slate-100 text-slate-400";
    if (value >= 20) return "bg-emerald-100 text-emerald-800";
    if (value >= 12) return "bg-amber-100 text-amber-800";
    return "bg-slate-100 text-slate-600";
  }

  isHomeGame(game: Game): boolean {
    return game.homeTeam.id === this.team()?.id;
  }

  opponentCode(game: Game): string {
    return this.isHomeGame(game) ? game.awayTeam.code : game.homeTeam.code;
  }

  isWin(game: Game): boolean {
    if (game.homeScore === null || game.awayScore === null) return false;
    return this.isHomeGame(game)
      ? game.homeScore > game.awayScore
      : game.awayScore > game.homeScore;
  }

  teamScore(game: Game): number | null {
    return this.isHomeGame(game) ? game.homeScore : game.awayScore;
  }

  opponentScore(game: Game): number | null {
    return this.isHomeGame(game) ? game.awayScore : game.homeScore;
  }

  myPickFor(game: Game): string | null {
    return this.myPicks().get(game.id) ?? null;
  }

  predict(game: Game, teamId: string): void {
    if (!this.auth.isAuthenticated()) return;
    // Optimistic update — the backend still validates and is the source of truth.
    const map = new Map(this.myPicks());
    map.set(game.id, teamId);
    this.myPicks.set(map);

    this.api.submitPrediction(game.id, teamId).subscribe({
      error: () => {
        // Roll back on failure (e.g. game started in the meantime).
        const rollback = new Map(this.myPicks());
        rollback.delete(game.id);
        this.myPicks.set(rollback);
      },
    });
  }
}