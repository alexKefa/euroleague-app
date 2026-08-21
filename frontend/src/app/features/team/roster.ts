import {
  Component,
  OnInit,
  AfterViewChecked,
  OnDestroy,
  ElementRef,
  ViewChild,
  inject,
  signal,
  computed,
  effect,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { Chart, registerables, ChartData } from "chart.js";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Team, RosterEntry, Game, GameTeamSummary, StandingsRow } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { ChipDirective } from "../../shared/chip.directive";

Chart.register(...registerables);

const RADAR_AXES: { key: keyof StandingsRow["stats"]; labelKey: string }[] = [
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
  styleUrl: "./roster.css",
})
export class TeamRosterComponent implements OnInit, AfterViewChecked, OnDestroy {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  @ViewChild("radarCanvas") private radarCanvasRef?: ElementRef<HTMLCanvasElement>;
  private chart?: Chart;

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
    for (const axis of RADAR_AXES) {
      const values = rows
        .map((r) => r.stats[axis.key])
        .filter((v): v is number => typeof v === "number");
      avg[axis.key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    }
    return avg;
  });

  readonly radarChartData = computed<ChartData<"radar">>(() => {
    const row = this.teamStandingsRow();
    const avg = this.leagueAverage();
    return {
      labels: RADAR_AXES.map((a) => this.i18n.t(a.labelKey)),
      datasets: [
        {
          label: this.i18n.t("roster.leagueAverage"),
          data: RADAR_AXES.map((a) => avg[a.key] ?? 0),
          borderDash: [4, 4],
          borderColor: "#6B7480",
          backgroundColor: "rgba(107, 116, 128, 0.12)",
        },
        {
          label: row?.team.code ?? this.i18n.t("roster.teamFallback"),
          data: RADAR_AXES.map((a) => (row ? (row.stats[a.key] as number) ?? 0 : 0)),
          borderColor: row?.team.primaryColor ?? "#3E7CB1",
          backgroundColor: this.withAlpha(row?.team.primaryColor ?? "#3E7CB1", 0.3),
        },
      ],
    };
  });

  constructor() {
    // Re-render the chart whenever the computed data changes (standings/team load).
    effect(() => {
      const data = this.radarChartData();
      if (this.chart) {
        this.chart.data = data;
        this.chart.update();
      }
    });
  }

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

  ngAfterViewChecked(): void {
    if (!this.chart && this.radarCanvasRef) {
      this.chart = new Chart(this.radarCanvasRef.nativeElement, {
        type: "radar",
        data: this.radarChartData(),
        options: {
          responsive: true,
          scales: {
            r: {
              beginAtZero: true,
              ticks: { display: false },
              grid: { color: "rgba(255, 255, 255, 0.08)" },
              angleLines: { color: "rgba(255, 255, 255, 0.08)" },
              pointLabels: { color: "#8A8A86", font: { family: "JetBrains Mono", size: 10 } },
            },
          },
          plugins: {
            legend: { labels: { color: "#8A8A86", font: { family: "JetBrains Mono", size: 10 } } },
          },
        },
      });
    }
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private withAlpha(hex: string, alpha: number): string {
    const clean = hex.replace("#", "");
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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