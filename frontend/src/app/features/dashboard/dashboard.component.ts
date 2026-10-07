import { Component, OnInit, OnDestroy, inject, signal, computed, effect } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { StandingsRow, NewsArticle, Game, LeaderboardEntry, League } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { NavIconComponent } from "../../shared/nav-icon";
import { SkeletonComponent } from "../../shared/skeleton";
import { FirstPicksCardComponent } from "../../shared/first-picks-card";
import { newsDateLocale, gameDateTimeFormat as gameDateTimeFormatFn } from "../../shared/news-date-format";
import { TeamCodePipe } from "../../shared/team-display-code";
import { TodayTagPipe } from "../../shared/today-tag.pipe";
import { LiveCenterComponent } from "./live-center";
import { RoundRecapComponent } from "./round-recap";
import { RoundStatusService } from "./round-status.service";
import { RoundHeaderComponent } from "./round-header";
import { RoundChecklistComponent } from "./round-checklist";
import { LeagueBlockComponent } from "./league-block";

function athensDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Home screen. Redesigned 2026-10-07 around "what's open this round"
 * (docs/superpowers/specs/2026-10-07-dashboard-round-checklist-design.md):
 * round header + checklist first, then the next game, Live Center (only on
 * game days), the sponsor ticker, one compact league block and a slim
 * leagues/fantasy row. The round prize banner, economy hint and the tabbed
 * Performances/Leaders/Predictors/Schedule card were removed.
 */
@Component({
  selector: "app-dashboard",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RetryImgDirective,
    NavIconComponent,
    SkeletonComponent,
    FirstPicksCardComponent,
    TeamCodePipe,
    TodayTagPipe,
    LiveCenterComponent,
    RoundRecapComponent,
    RoundHeaderComponent,
    RoundChecklistComponent,
    LeagueBlockComponent,
  ],
  templateUrl: "./dashboard.component.html",
  styleUrl: "./dashboard.component.css",
})
export class DashboardComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  protected roundStatus = inject(RoundStatusService);
  private theme = inject(ThemeService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  // Sponsor ticker (2026-09-13): a static paid slot, no sponsor backend yet.
  // First real sponsor: Υγειοσωματική (a gym), linking to their Instagram.
  readonly sponsorText = "Υγειοσωματική — Δύναμη για κάθε buzzer-beater. Ακολούθησέ μας στο Instagram.";
  readonly sponsorLink = "https://www.instagram.com/igiosomatiki/";

  readonly standings = signal<StandingsRow[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedTeamId = signal<string | null>(null);
  readonly news = signal<NewsArticle[]>([]);
  readonly scheduleLoading = signal(true);
  readonly teamGames = signal<Game[]>([]);

  // The predictions leaderboard is loaded only for the viewer's own rank,
  // shown in the round header's all-done / between-rounds lines.
  private readonly fullLeaderboard = signal<LeaderboardEntry[]>([]);
  private readonly myBoardIndex = computed(() => {
    const uid = this.auth.currentUser()?.id;
    return uid ? this.fullLeaderboard().findIndex((r) => r.userId === uid) : -1;
  });
  readonly myRank = computed(() => (this.myBoardIndex() === -1 ? null : this.myBoardIndex() + 1));

  readonly myLeagues = signal<League[]>([]);
  readonly myLeaguesLoading = signal(true);
  // The fantasy row reads RoundStatusService's lineup (one fetch, not two).
  readonly fantasyLineup = this.roundStatus.lineup;
  readonly fantasyLoading = this.roundStatus.lineupLoading;

  readonly selectedRow = computed(() => this.standings().find((r) => r.team.id === this.selectedTeamId()) ?? null);

  // teamGames is already ascending by tipoffAt (see GET /teams/:id/games).
  readonly nextGame = computed(() => this.teamGames().find((g) => g.status === "scheduled") ?? null);

  // Live Center only earns its space on game days: a game is live, or one
  // tips off today (Athens time). Otherwise the next-game card covers it.
  readonly showLiveCenter = computed(() => {
    const games = this.roundStatus.schedule()?.games ?? [];
    const today = athensDateKey(new Date(this.roundStatus.now()));
    return games.some((g) => g.status === "live" || athensDateKey(new Date(g.tipoffAt)) === today);
  });

  constructor() {
    // Re-fetches on the language toggle: the en/el news feeds are separate
    // sources, not translations.
    effect(() => {
      const lang = this.i18n.lang();
      this.api.getNews(10, lang, true).subscribe({
        next: (articles) => this.news.set(articles),
        error: () => {}, // non-critical widget
      });
    });
  }

  ngOnInit(): void {
    this.loadDashboardData();
    this.roundStatus.start();
    // Standalone PWAs have no pull-to-refresh; refetch after being hidden a while.
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  ngOnDestroy(): void {
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.roundStatus.stop();
  }

  private hiddenAt: number | null = null;
  private static readonly STALE_AFTER_MS = 60_000;

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
    this.api.getNews(10, this.i18n.lang(), true).subscribe({
      next: (articles) => this.news.set(articles),
      error: () => {},
    });
  };

  private loadDashboardData(): void {
    if (this.auth.isAuthenticated()) {
      this.api.getMyLeagues().subscribe({
        next: (rows) => {
          this.myLeagues.set(rows);
          this.myLeaguesLoading.set(false);
        },
        error: () => this.myLeaguesLoading.set(false),
      });
      this.api.getLeaderboard(true).subscribe({
        next: (rows) => this.fullLeaderboard.set(rows),
        error: () => {},
      });
    }

    this.api.getStandings().subscribe({
      next: (rows) => {
        this.standings.set(rows);
        this.loading.set(false);
        // Guests have no favorite team; don't present the leader as "yours".
        if (rows.length > 0 && this.auth.isAuthenticated()) {
          const savedTeamId = this.auth.currentUser()?.favoriteTeamId;
          const hasSavedTeam = savedTeamId && rows.some((r) => r.team.id === savedTeamId);
          this.loadTeam(hasSavedTeam ? savedTeamId! : rows[0].team.id);
        } else {
          this.scheduleLoading.set(false);
        }
      },
      error: () => {
        // Only a first-load failure shows the error; a refresh blip keeps the last good data.
        if (this.standings().length === 0) {
          this.error.set("Couldn't load standings. Make sure the backend's /api/standings route is running (step 5).");
        }
        this.loading.set(false);
        this.scheduleLoading.set(false);
      },
    });
  }

  private loadTeam(teamId: string): void {
    this.selectedTeamId.set(teamId);
    const row = this.standings().find((r) => r.team.id === teamId);
    this.theme.applyTeam(row?.team ?? null);
    this.teamGames.set([]);
    this.scheduleLoading.set(true);
    this.api.getTeamGames(teamId).subscribe({
      next: (games) => {
        this.teamGames.set(games);
        this.scheduleLoading.set(false);
      },
      error: () => this.scheduleLoading.set(false),
    });
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

  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  gameDateTimeFormat(): string {
    return gameDateTimeFormatFn(this.i18n.lang());
  }
}
