import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Team, RosterEntry, Game, GameTeamSummary, StandingsRow } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { StatLegendComponent, StatLegendEntry } from "../../shared/stat-legend";
import { SkeletonComponent } from "../../shared/skeleton";

// Plain box-score terms instead of advanced-stat proxies (eFG%-based
// "offRating"/"defRating", assist ratio for "playmaking") — those didn't
// read as basketball to a casual fan even once the radar chart was
// replaced with bars. All three axes are now raw per-game counts: points
// scored, points allowed, and rebounds (rpg is approximated backend-side
// from player_season_stats — see routes/standings.ts — since no raw team
// total is synced). `invert` marks defense: fewer points allowed is
// better, the opposite direction from the other two axes, so delta's
// sign has to flip for it.
const COMPARISON_AXES: { key: keyof StandingsRow["stats"]; labelKey: string; percent: boolean; invert?: boolean }[] = [
  { key: "ppg", labelKey: "roster.axisOffense", percent: false },
  { key: "papg", labelKey: "roster.axisDefense", percent: false, invert: true },
  { key: "rpg", labelKey: "roster.axisRebounding", percent: false },
];
type ComparisonAxis = (typeof COMPARISON_AXES)[number];

@Component({
  selector: "app-team-roster",
  standalone: true,
  imports: [CommonModule, RouterLink, RetryImgDirective, ChipDirective, StatLegendComponent, SkeletonComponent],
  templateUrl: "./roster.html",
})
export class TeamRosterComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
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

  // {code, key} pairs, not translated strings — the label text is resolved
  // inside the computed() below so it stays reactive to i18n.lang (a plain
  // field initializer would freeze the label in whatever language was
  // active when the component was constructed).
  private readonly traditionalLegendKeys: { code: string; key: string }[] = [
    { code: "GP", key: "roster.legendGP" },
    { code: "MIN", key: "roster.legendMIN" },
    { code: "PPG", key: "roster.legendPPG" },
    { code: "RPG", key: "roster.legendRPG" },
    { code: "APG", key: "roster.legendAPG" },
    { code: "SPG", key: "roster.legendSPG" },
    { code: "PIR", key: "roster.legendPIR" },
  ];

  private readonly advancedLegendKeys: { code: string; key: string }[] = [
    { code: "TS%", key: "roster.legendTS" },
    { code: "eFG%", key: "roster.legendEFG" },
    { code: "REB%", key: "roster.legendREB" },
    { code: "AST%", key: "roster.legendAST" },
    { code: "TOV%", key: "roster.legendTOV" },
    { code: "POSS", key: "roster.legendPOSS" },
    { code: "USG%", key: "roster.legendUSG" },
  ];

  readonly statLegendEntries = computed<StatLegendEntry[]>(() => {
    const keys = this.statsView() === "traditional" ? this.traditionalLegendKeys : this.advancedLegendKeys;
    return keys.map((k) => ({ code: k.code, label: this.i18n.t(k.key) }));
  });

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

  teamValue(axis: ComparisonAxis): number {
    return (this.teamStandingsRow()?.stats[axis.key] as number | null) ?? 0;
  }

  leagueAvgValue(axis: ComparisonAxis): number {
    return this.leagueAverage()[axis.key] ?? 0;
  }

  formatValue(axis: ComparisonAxis, value: number): string {
    return axis.percent ? this.fmtPct(value) : this.fmtNum(value);
  }

  // true when the team is doing BETTER than league average on this axis —
  // the same "team minus average" sign for most axes, flipped for defense
  // (papg), where allowing fewer points than average is the good outcome.
  isAboveAverage(axis: ComparisonAxis): boolean {
    const raw = this.teamValue(axis) - this.leagueAvgValue(axis);
    return axis.invert ? raw <= 0 : raw >= 0;
  }

  // Bar fill as a % of a per-row scale (team/league-avg's own max + 15%
  // headroom) rather than a flat 0-100 — needed now that axes mix raw
  // points (60-100 range) with a genuine percentage (0-100 range), so one
  // shared scale would no longer make sense for all of them.
  barWidth(axis: ComparisonAxis): number {
    const max = Math.max(this.teamValue(axis), this.leagueAvgValue(axis)) * 1.15 || 1;
    return Math.min(100, (this.teamValue(axis) / max) * 100);
  }

  markerPosition(axis: ComparisonAxis): number {
    const max = Math.max(this.teamValue(axis), this.leagueAvgValue(axis)) * 1.15 || 1;
    return Math.min(100, (this.leagueAvgValue(axis) / max) * 100);
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