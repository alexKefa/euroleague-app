import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { StandingsRow, LeaderEntry, RoundMvp, NewsArticle, Game } from "../../core/models";

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
})
export class DashboardComponent implements OnInit {
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly standings = signal<StandingsRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedTeamId = signal<string | null>(null);
  readonly leaders = signal<LeaderEntry[]>([]);
  readonly leaderCategory = signal<LeaderCategory>("points");
  readonly leaderCategories = LEADER_CATEGORIES;
  readonly news = signal<NewsArticle[]>([]);
  readonly teamGames = signal<Game[]>([]);
  readonly roundMvp = signal<RoundMvp | null>(null);

  readonly selectedRow = computed(
    () => this.standings().find((r) => r.team.id === this.selectedTeamId()) ?? null
  );

  // teamGames is already ascending by tipoffAt (see GET /teams/:id/games).
  readonly recentGames = computed(() =>
    this.teamGames()
      .filter((g) => g.status === "final")
      .slice(-4)
      .reverse()
  );
  readonly upcomingGames = computed(() =>
    this.teamGames()
      .filter((g) => g.status === "scheduled")
      .slice(0, 4)
  );
  readonly nextGame = computed(() => this.upcomingGames()[0] ?? null);

  ngOnInit(): void {
    this.api.getNews(3).subscribe({
      next: (articles) => this.news.set(articles),
      error: () => {}, // non-critical widget
    });

    this.selectLeaderCategory("points");

    this.api.getRoundMvp(5).subscribe({
      next: (result) => this.roundMvp.set(result),
      error: () => {}, // non-critical widget
    });

    this.api.getStandings().subscribe({
      next: (rows) => {
        this.standings.set(rows);
        this.loading.set(false);
        // Guests have no favorite team — don't default to the top-ranked one,
        // that would misleadingly present it as "your team".
        if (rows.length > 0 && this.auth.isAuthenticated()) {
          const savedTeamId = this.auth.currentUser()?.favoriteTeamId;
          const hasSavedTeam = savedTeamId && rows.some((r) => r.team.id === savedTeamId);
          this.loadTeam(hasSavedTeam ? savedTeamId! : rows[0].team.id);
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

  private loadTeam(teamId: string): void {
    this.selectedTeamId.set(teamId);
    const row = this.standings().find((r) => r.team.id === teamId);
    this.theme.applyTeam(row?.team ?? null);

    this.teamGames.set([]);
    this.api.getTeamGames(teamId).subscribe({
      next: (games) => this.teamGames.set(games),
      error: () => {}, // non-critical widget
    });
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

  teamResult(game: Game): "W" | "L" | null {
    if (game.homeScore === null || game.awayScore === null) return null;
    const won = this.isHomeGame(game)
      ? game.homeScore > game.awayScore
      : game.awayScore > game.homeScore;
    return won ? "W" : "L";
  }
}