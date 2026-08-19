import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { AuthService } from "../../core/auth.service";
import { StandingsRow, LeaderEntry, NewsArticle, Game } from "../../core/models";

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
}