import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Team, RosterEntry, Game, GameTeamSummary, StandingsRow } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { ChipDirective } from "../../shared/chip.directive";

// Every axis is itself a percentage (effective FG%, rebound%, assist
// ratio — see backend/src/sync-py/standings_sync.py's get_radar_stats),
// so they all share one 0-100 bar scale without needing a per-axis
// rescale. Replaced the radar chart (see PREDICTIONS.md/session history)
// because hidden axis ticks plus four jargon-y stat names made it
// unreadable — a fan couldn't tell "is this team good at X" from the
// shape alone. A labeled bar with a league-average marker states that
// directly.
const COMPARISON_AXES: { key: keyof StandingsRow["stats"]; labelKey: string }[] = [
  { key: "offRating", labelKey: "roster.axisOffense" },
  { key: "defRating", labelKey: "roster.axisDefense" },
  { key: "rebPct", labelKey: "roster.axisRebounding" },
  { key: "astPct", labelKey: "roster.axisPlaymaking" },
];

@Component({
  selector: "app-team-roster",
  standalone: true,
  imports: [CommonModule, RouterLink, RetryImgDirective, ChipDirective],
  templateUrl: "./roster.html",
})
export class TeamRosterComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  protected readonly comparisonAxes = COMPARISON_AXES;

  readonly team = signal<Team | null>(null);
  readonly roster = signal<RosterEntry[]>([]);
  readonly upcomingGames = signal<Game[]>([]);
  readonly recentGames = signal<Game[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly standings = signal<StandingsRow[]>([]);
  readonly statsView = signal<"traditional" | "advanced">("traditional");

  readonly teamStandingsRow = computed(
    () => this.standings().find((r) => r.team.id === this.team()?.id) ?? null
  );

  readonly leagueAverage = computed(() => {
    const rows = this.standings();
    const avg: Record<string, number> = {};
    for (const axis of COMPARISON_AXES) {
      const values = rows
        .map((r) => r.stats[axis.key])
        .filter((v): v is number => typeof v === "number");
      avg[axis.key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    }
    return avg;
  });

  ngOnInit(): void {
    this.api.getStandings().subscribe({
      next: (rows) => this.standings.set(rows),
      error: () => {}, // non-critical widget
    });

    const teamId = this.route.snapshot.paramMap.get("id");
    if (!teamId) {
      this.error.set(this.i18n.t("roster.noTeamSpecified"));
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
        this.error.set(this.i18n.t("roster.loadError"));
        this.loading.set(false);
      },
    });
  }

  teamValue(key: keyof StandingsRow["stats"]): number {
    return (this.teamStandingsRow()?.stats[key] as number | null) ?? 0;
  }

  leagueAvgValue(key: keyof StandingsRow["stats"]): number {
    return this.leagueAverage()[key] ?? 0;
  }

  delta(key: keyof StandingsRow["stats"]): number {
    return this.teamValue(key) - this.leagueAvgValue(key);
  }

  /**
   * Tailwind classes for a PIR rating pill. Thresholds are rough EuroLeague
   * norms (season PIR leaders land ~22-25, solid rotation players ~12-19,
   * limited-minutes players below that) — not an official grading scale,
   * just a reasonable visual split.
   */
  pirBadgeClass(value: number | null): string {
    if (value === null) return "bg-slate-500/10 text-muted";
    if (value >= 20) return "bg-emerald-500/15 text-emerald-400";
    if (value >= 12) return "bg-amber-500/15 text-amber-400";
    return "bg-slate-500/10 text-slate-400";
  }

  fmtPct(value: number | null): string {
    return value !== null ? `${value.toFixed(1)}%` : "—";
  }

  fmtNum(value: number | null): string {
    return value !== null ? value.toFixed(1) : "—";
  }

  isHomeGame(game: Game): boolean {
    return game.homeTeam.id === this.team()?.id;
  }

  opponentTeam(game: Game): GameTeamSummary {
    return this.isHomeGame(game) ? game.awayTeam : game.homeTeam;
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
}