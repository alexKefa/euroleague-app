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
import { RouterLink } from "@angular/router";
import { Chart, registerables, ChartData } from "chart.js";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { AuthService } from "../../core/auth.service";
import { StandingsRow, LeaderEntry, NewsArticle, Game } from "../../core/models";

Chart.register(...registerables);

const RADAR_AXES: { key: keyof StandingsRow["stats"]; label: string }[] = [
  { key: "offRating", label: "Offense" },
  { key: "defRating", label: "Defense" },
  { key: "rebPct", label: "Rebounding" },
  { key: "astPct", label: "Playmaking" },
];

const LEADER_CATEGORIES = [
  { value: "points", label: "PTS" },
  { value: "rebounds", label: "REB" },
  { value: "assists", label: "AST" },
  { value: "steals", label: "STL" },
  { value: "blocks", label: "BLK" },
  { value: "valuation", label: "PIR" },
] as const;

type LeaderCategory = (typeof LEADER_CATEGORIES)[number]["value"];

@Component({
  selector: "app-dashboard",
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: "./dashboard.component.html",
  styleUrl: "./dashboard.component.css",
})
export class DashboardComponent implements OnInit, AfterViewChecked, OnDestroy {
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private auth = inject(AuthService);

  @ViewChild("radarCanvas") private radarCanvasRef?: ElementRef<HTMLCanvasElement>;
  private chart?: Chart;

  readonly standings = signal<StandingsRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedTeamId = signal<string | null>(null);
  readonly leaders = signal<LeaderEntry[]>([]);
  readonly leaderCategory = signal<LeaderCategory>("points");
  readonly leaderCategories = LEADER_CATEGORIES;
  readonly news = signal<NewsArticle[]>([]);
  readonly nextGame = signal<Game | null>(null);

  readonly selectedRow = computed(
    () => this.standings().find((r) => r.team.id === this.selectedTeamId()) ?? null
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
    const row = this.selectedRow();
    const avg = this.leagueAverage();
    return {
      labels: RADAR_AXES.map((a) => a.label),
      datasets: [
        {
          label: "League average",
          data: RADAR_AXES.map((a) => avg[a.key] ?? 0),
          borderDash: [4, 4],
          borderColor: "#6B7480",
          backgroundColor: "rgba(107, 116, 128, 0.12)",
        },
        {
          label: row?.team.code ?? "Team",
          data: RADAR_AXES.map((a) => (row ? (row.stats[a.key] as number) ?? 0 : 0)),
          borderColor: row?.team.primaryColor ?? "#3E7CB1",
          backgroundColor: this.withAlpha(row?.team.primaryColor ?? "#3E7CB1", 0.3),
        },
      ],
    };
  });

  constructor() {
    // Re-render the chart whenever the computed data changes (team switch, data load).
    effect(() => {
      const data = this.radarChartData();
      if (this.chart) {
        this.chart.data = data;
        this.chart.update();
      }
    });
  }

  ngOnInit(): void {
    this.api.getNews(3).subscribe({
      next: (articles) => this.news.set(articles),
      error: () => {}, // non-critical widget
    });

    this.selectLeaderCategory("points");

    this.api.getStandings().subscribe({
      next: (rows) => {
        this.standings.set(rows);
        this.loading.set(false);
        if (rows.length > 0) {
          const savedTeamId = this.auth.currentUser()?.favoriteTeamId;
          const hasSavedTeam = savedTeamId && rows.some((r) => r.team.id === savedTeamId);
          this.selectTeam(hasSavedTeam ? savedTeamId! : rows[0].team.id, false);
        }
      },
      error: () => {
        this.error.set(
          "Couldn't load standings. Make sure the backend's /api/standings route is running (step 5)."
        );
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
          scales: { r: { beginAtZero: true, ticks: { display: false } } },
        },
      });
    }
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  selectTeam(teamId: string, persist = true): void {
    this.selectedTeamId.set(teamId);
    const row = this.standings().find((r) => r.team.id === teamId);
    this.theme.applyTeam(row?.team ?? null);

    this.nextGame.set(null);
    this.api.getTeamGames(teamId).subscribe({
      next: (games) => {
        const next = games.find((g) => g.status === "scheduled") ?? null;
        this.nextGame.set(next);
      },
      error: () => {}, // non-critical widget
    });

    if (persist && this.auth.isAuthenticated()) {
      this.auth.updateFavoriteTeam(teamId).subscribe();
    }
  }

  selectLeaderCategory(category: LeaderCategory): void {
    this.leaderCategory.set(category);
    this.api.getLeaders(category, 5).subscribe({
      next: (rows) => this.leaders.set(rows),
      error: () => {}, // non-critical widget — fail quietly, standings error already covers the main failure mode
    });
  }

  isHomeGame(game: Game): boolean {
    return game.homeTeam.id === this.selectedTeamId();
  }

  opponentCode(game: Game): string {
    return this.isHomeGame(game) ? game.awayTeam.code : game.homeTeam.code;
  }

  private withAlpha(hex: string, alpha: number): string {
    const clean = hex.replace("#", "");
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}