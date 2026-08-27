import { Component, OnInit, OnDestroy, inject, signal, computed, effect } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { StandingsRow, LeaderEntry, RoundMvp, NewsArticle, Game, LeaderboardEntry } from "../../core/models";
import { PageHintComponent } from "../../shared/page-hint";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { NavIconComponent } from "../../shared/nav-icon";
import { TourService } from "../../core/tour/tour.service";
import { ButtonDirective } from "../../shared/button.directive";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { NewsStoriesComponent } from "../../shared/news-stories";
import { SkeletonComponent } from "../../shared/skeleton";
import {
  newsDateLocale,
  shortDateFormat as gameShortDateFormat,
  gameDateTimeFormat as gameDateTimeFormatFn,
} from "../../shared/news-date-format";

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
  imports: [
    CommonModule,
    RouterLink,
    PageHintComponent,
    RetryImgDirective,
    NavIconComponent,
    ButtonDirective,
    DropdownComponent,
    NewsStoriesComponent,
    SkeletonComponent,
  ],
  templateUrl: "./dashboard.component.html",
})
export class DashboardComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private theme = inject(ThemeService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected tour = inject(TourService);

  readonly standings = signal<StandingsRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedTeamId = signal<string | null>(null);
  readonly leaders = signal<LeaderEntry[]>([]);
  readonly leaderCategory = signal<LeaderCategory>("points");
  readonly leaderCategories = LEADER_CATEGORIES;
  readonly leaderDropdownOptions: DropdownOption[] = LEADER_CATEGORIES.map((c) => ({
    value: c.value,
    label: c.label,
  }));
  readonly news = signal<NewsArticle[]>([]);
  readonly teamGames = signal<Game[]>([]);
  readonly roundMvp = signal<RoundMvp | null>(null);
  // Top 5 of the predictions leaderboard — a compact teaser here (full
  // board with badges lives on /predictions). Public endpoint, so this
  // renders for guests too: social proof for the points economy the
  // guest-only hint below is pitching.
  readonly leaderboard = signal<LeaderboardEntry[]>([]);

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

  constructor() {
    // Re-fetches whenever the language toggle changes — Eurohoops is
    // synced as fully separate en/el feeds (backend/src/sync/newsSync.ts),
    // not one feed translated, so switching language means genuinely
    // different articles.
    effect(() => {
      const lang = this.i18n.lang();
      // 10, not 3 — this now backs a stories rail (app-news-stories), which
      // wants a real row of circles to swipe/tap through, not just enough
      // for a 3-item list.
      this.api.getNews(10, lang).subscribe({
        next: (articles) => this.news.set(articles),
        error: () => {}, // non-critical widget
      });
    });
  }

  ngOnInit(): void {
    this.selectLeaderCategory("points");
    this.loadDashboardData();

    // Standalone home-screen PWAs (iOS especially) have no browser chrome
    // at all — no pull-to-refresh, no reload button — and the page gets
    // suspended while backgrounded, so reopening after a while can show
    // several-minutes-stale standings/scores with no way to fix it short
    // of force-quitting. This is the fix: refetch automatically once the
    // app's been hidden for a while, not on every trivial glance-away
    // (STALE_AFTER_MS), and only the actual data, not a full page reload —
    // no gesture involved, so nothing here can conflict with the news
    // stories' own swipe-to-close.
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  ngOnDestroy(): void {
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  private hiddenAt: number | null = null;
  private static readonly STALE_AFTER_MS = 60_000;

  // Bound as a class field (not a method) so the exact same function
  // reference can be passed to both addEventListener and removeEventListener.
  private onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.hiddenAt = Date.now();
      return;
    }
    if (document.visibilityState !== "visible" || this.hiddenAt === null) return;

    const hiddenForMs = Date.now() - this.hiddenAt;
    this.hiddenAt = null;
    if (hiddenForMs < DashboardComponent.STALE_AFTER_MS) return;

    this.loadDashboardData();
    this.selectLeaderCategory(this.leaderCategory());
    this.api.getNews(10, this.i18n.lang()).subscribe({
      next: (articles) => this.news.set(articles),
      error: () => {}, // non-critical widget
    });
  };

  private loadDashboardData(): void {
    this.api.getRoundMvp(5).subscribe({
      next: (result) => this.roundMvp.set(result),
      error: () => {}, // non-critical widget
    });

    this.api.getLeaderboard().subscribe({
      next: (rows) => this.leaderboard.set(rows.slice(0, 5)),
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
        // Only surface the error screen on a genuine first-load failure —
        // this same call also re-runs on the visibility-change refresh
        // (see onVisibilityChange), and a transient blip there shouldn't
        // wipe out an already-loaded dashboard and replace it with an
        // error; just keep showing the last known-good data instead.
        if (this.standings().length === 0) {
          this.error.set(
            "Couldn't load standings. Make sure the backend's /api/standings route is running (step 5)."
          );
        }
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

  // The dropdown emits a plain string; its options are always sourced from
  // LEADER_CATEGORIES, so the cast is safe.
  onLeaderCategoryChange(value: string | null): void {
    if (value) this.selectLeaderCategory(value as LeaderCategory);
  }

  isHomeGame(game: Game): boolean {
    return game.homeTeam.id === this.selectedTeamId();
  }

  opponentCode(game: Game): string {
    return this.isHomeGame(game) ? game.awayTeam.code : game.homeTeam.code;
  }

  opponentTeam(game: Game) {
    return this.isHomeGame(game) ? game.awayTeam : game.homeTeam;
  }

  // Greek month names/day-first order for the date pipe — see
  // shared/news-date-format.ts for why the locale has to be passed
  // explicitly and why time stays 24h in both languages.
  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  shortDateFormat(): string {
    return gameShortDateFormat(this.i18n.lang());
  }

  gameDateTimeFormat(): string {
    return gameDateTimeFormatFn(this.i18n.lang());
  }

  teamResult(game: Game): "W" | "L" | null {
    if (game.homeScore === null || game.awayScore === null) return null;
    const won = this.isHomeGame(game)
      ? game.homeScore > game.awayScore
      : game.awayScore > game.homeScore;
    return won ? "W" : "L";
  }
}