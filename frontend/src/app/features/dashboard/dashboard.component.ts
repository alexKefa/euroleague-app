import { Component, OnInit, OnDestroy, HostListener, inject, signal, computed, effect } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { ThemeService } from "../../core/theme.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { StandingsRow, LeaderEntry, RoundMvp, NewsArticle, Game, LeaderboardEntry, League, FantasyLineup } from "../../core/models";
import { PageHintComponent } from "../../shared/page-hint";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { NavIconComponent } from "../../shared/nav-icon";
import { TourService } from "../../core/tour/tour.service";
import { ButtonDirective } from "../../shared/button.directive";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { NewsStoriesComponent } from "../../shared/news-stories";
import { SkeletonComponent } from "../../shared/skeleton";
import { CollectibleCardComponent } from "../store/collectible-card";
import {
  newsDateLocale,
  shortDateFormat as gameShortDateFormat,
  gameDateTimeFormat as gameDateTimeFormatFn,
} from "../../shared/news-date-format";
import { TeamCodePipe } from "../../shared/team-display-code";

const LEADER_CATEGORIES = [
  { value: "points", label: "PTS" },
  { value: "rebounds", label: "REB" },
  { value: "assists", label: "AST" },
  { value: "steals", label: "STL" },
  { value: "blocks", label: "BLK" },
  { value: "valuation", label: "PIR" },
] as const;

type LeaderCategory = (typeof LEADER_CATEGORIES)[number]["value"];

// Performances/Leaders/Predictors/Schedule used to be four separate
// stacked cards — merged into one tabbed card (2026-09-01 scroll-reduction
// pass) since a dashboard should read "at a glance", and every one of these
// already has its own full page a tap away (/stats, /predictions,
// /schedule) via the links kept inside each tab.
type DashboardTab = "performances" | "leaders" | "predictors" | "schedule";

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
    CollectibleCardComponent,
    TeamCodePipe,
  ],
  templateUrl: "./dashboard.component.html",
  styleUrl: "./dashboard.component.css",
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
  // Showcase cards open in a modal on tap — same pattern as the full
  // leaderboard (features/predictions/predictions.ts) and the league
  // leaderboard (features/leagues/league-detail.ts), minus badges: this
  // teaser deliberately never showed badges (see the comment above), so the
  // modal here stays cards-only rather than pulling that in too.
  readonly selectedEntry = signal<LeaderboardEntry | null>(null);
  // My Leagues teaser — unlike the other dashboard cards, this renders even
  // when empty (a CTA to create/join one) rather than being omitted, since
  // the whole point of putting it here is discovery: a user who's never
  // heard of Leagues needs to see *something*, not just existing members
  // getting a shortcut. Requires an account (leagues can't be created/
  // joined as a guest), so gated behind auth like the favorite-team hero,
  // not shown to guests the way the public leaderboard teaser is.
  readonly myLeagues = signal<League[]>([]);
  // Fantasy Five teaser, same "requires an account, gated like myLeagues"
  // reasoning — surfaces the current round's lock status so this card is
  // never just a static ad, without duplicating the roster-builder page's
  // own fetch of the whole player pool.
  readonly fantasyLineup = signal<FantasyLineup | null>(null);

  // Which tab the merged Performances/Leaders/Predictors/Schedule card is
  // showing. Defaults to the first section that actually has data (see the
  // effect in the constructor) rather than a fixed tab, since e.g. an
  // early-season roundMvp can be empty; userPickedTab stops that
  // auto-selection from fighting a tap once someone's chosen one by hand.
  readonly activeTab = signal<DashboardTab>("performances");
  private userPickedTab = false;

  readonly selectedRow = computed(
    () => this.standings().find((r) => r.team.id === this.selectedTeamId()) ?? null
  );

  // Top-3 + your team's own row (deduped) — replaces what used to be the
  // full 21-row standings list. Your rank is already in the hero above;
  // this is just enough context to place it, with the full table one tap
  // away via the "view full" link kept on this card.
  readonly miniStandings = computed(() => {
    const rows = this.standings();
    const top3 = rows.slice(0, 3);
    const teamId = this.selectedTeamId();
    if (!teamId || top3.some((r) => r.team.id === teamId)) return top3;
    const yourRow = rows.find((r) => r.team.id === teamId);
    return yourRow ? [...top3, yourRow] : top3;
  });

  readonly hasPerformances = computed(() => (this.roundMvp()?.leaders?.length ?? 0) > 0);
  readonly hasLeaders = computed(() => this.leaders().length > 0);
  readonly hasPredictors = computed(() => this.leaderboard().length > 0);
  readonly hasSchedule = computed(() => this.recentGames().length > 0 || this.upcomingGames().length > 0);

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
      // for a 3-item list. dedupe:true collapses the same story appearing
      // 2-3x in a row when several of our RSS feeds cover it near-
      // simultaneously (see services/newsDedupe.ts) — the full /news page
      // deliberately keeps every source's copy instead, so it doesn't pass
      // this.
      this.api.getNews(10, lang, true).subscribe({
        next: (articles) => this.news.set(articles),
        error: () => {}, // non-critical widget
      });
    });

    effect(() => {
      if (this.userPickedTab) return;
      if (this.hasPerformances()) this.activeTab.set("performances");
      else if (this.hasLeaders()) this.activeTab.set("leaders");
      else if (this.hasPredictors()) this.activeTab.set("predictors");
      else if (this.hasSchedule()) this.activeTab.set("schedule");
    });
  }

  setTab(tab: DashboardTab): void {
    this.userPickedTab = true;
    this.activeTab.set(tab);
  }

  tabButtonClass(tab: DashboardTab): Record<string, boolean> {
    const active = this.activeTab() === tab;
    return { "bg-highlight text-page": active, "text-muted hover:bg-page": !active };
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

  openMember(entry: LeaderboardEntry): void {
    this.selectedEntry.set(entry);
  }

  closeMember(): void {
    this.selectedEntry.set(null);
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.closeMember();
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
    this.api.getNews(10, this.i18n.lang(), true).subscribe({
      next: (articles) => this.news.set(articles),
      error: () => {}, // non-critical widget
    });
  };

  private loadDashboardData(): void {
    this.api.getRoundMvp(5).subscribe({
      next: (result) => this.roundMvp.set(result),
      error: () => {}, // non-critical widget
    });

    if (this.auth.isAuthenticated()) {
      this.api.getMyLeagues().subscribe({
        next: (rows) => this.myLeagues.set(rows),
        error: () => {}, // non-critical widget
      });
      this.api.getFantasyLineup().subscribe({
        next: (lineup) => this.fantasyLineup.set(lineup),
        error: () => {}, // non-critical widget
      });
    }

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

  // Display-only translation of teamResult()'s "W"/"L" — kept as a
  // separate function rather than folded into teamResult() itself, since
  // callers also compare the raw "W"/"L" value directly (win/loss color
  // classes) and shouldn't have to compare against a language-dependent
  // string. Ν/Η (Νίκη/Ήττα — Win/Loss) is the standard Greek sports
  // shorthand, same convention as a standings table's Ν-Η record column.
  resultLabel(result: "W" | "L" | null): string {
    if (result === null) return "";
    if (this.i18n.lang() !== "el") return result;
    return result === "W" ? "Ν" : "Η";
  }
}