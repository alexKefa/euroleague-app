import { Component, OnInit, computed, effect, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { EventsService } from "../../core/events.service";
import { FavoritePlayersService } from "../../core/favorite-players.service";
import { Game, Prediction, LegendaryPoll, FavoritePlayer } from "../../core/models";
import { TeamCodePipe } from "../../shared/team-display-code";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { newsDateLocale, shortDateFormat } from "../../shared/news-date-format";

const SEASON = "2026-27";

type LiveCenterTab = "games" | "predictions" | "favorites" | "polls";

interface MyPredictionRow {
  prediction: Prediction;
  game: Game;
}

interface FavoriteRow extends FavoritePlayer {
  game: Game | null;
}

/**
 * Dashboard's "Live Center" — everything happening *right now* the user has
 * a stake in, one tabbed card: live games league-wide, this user's own
 * unresolved predictions, their favorited players' game-day status, and any
 * open legendary polls. Deliberately separate from the merged Performances/
 * Leaders/Predictors/Schedule card just below it on the dashboard — that
 * one is stats/analytics-flavored (a team's own box scores/leaders), this
 * one is "what should I check on today", a different domain even though
 * both are tabbed cards for the same "reduce dashboard scroll" reason.
 * Gated on auth like myLeagues/fantasyLineup below it — 3 of 4 tabs
 * (predictions, favorites, polls) need a logged-in user, and a partial
 * guest view would just be confusing.
 */
@Component({
  selector: "app-live-center",
  standalone: true,
  imports: [CommonModule, RouterLink, TeamCodePipe, RetryImgDirective, SkeletonComponent],
  templateUrl: "./live-center.html",
})
export class LiveCenterComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private events = inject(EventsService);
  protected favoritePlayers = inject(FavoritePlayersService);

  readonly loading = signal(true);
  // Current round's full schedule, league-wide — backs both the games tab
  // and the team-lookup used by the predictions/favorites tabs, one fetch.
  readonly games = signal<Game[]>([]);
  readonly myPredictions = signal<Prediction[]>([]);
  readonly openPolls = signal<LegendaryPoll[]>([]);

  private readonly gameById = computed(() => new Map(this.games().map((g) => [g.id, g])));
  private readonly gameByTeamId = computed(() => {
    const map = new Map<string, Game>();
    for (const g of this.games()) {
      map.set(g.homeTeam.id, g);
      map.set(g.awayTeam.id, g);
    }
    return map;
  });

  readonly liveGames = computed(() => this.games().filter((g) => g.status === "live"));
  readonly upcomingGames = computed(() =>
    this.games()
      .filter((g) => g.status === "scheduled")
      .slice(0, 4)
  );

  readonly myUpcomingPredictions = computed<MyPredictionRow[]>(() => {
    const byId = this.gameById();
    return this.myPredictions()
      .filter((p) => p.status !== "final")
      .map((p) => ({ prediction: p, game: byId.get(p.gameId) ?? null }))
      .filter((r): r is MyPredictionRow => r.game !== null)
      .sort((a, b) => new Date(a.game.tipoffAt).getTime() - new Date(b.game.tipoffAt).getTime())
      .slice(0, 5);
  });

  readonly favoriteRows = computed<FavoriteRow[]>(() => {
    const byTeam = this.gameByTeamId();
    return this.favoritePlayers.favorites().map((f) => ({ ...f, game: byTeam.get(f.teamId) ?? null }));
  });

  readonly openPollsList = computed(() => this.openPolls().filter((p) => p.status === "open").slice(0, 3));

  readonly hasLive = computed(() => this.liveGames().length > 0);
  readonly hasPredictions = computed(() => this.myUpcomingPredictions().length > 0);
  readonly hasFavorites = computed(() => this.favoriteRows().length > 0);
  readonly hasPolls = computed(() => this.openPollsList().length > 0);

  readonly activeTab = signal<LiveCenterTab>("games");
  private userPickedTab = false;

  constructor() {
    // Same "auto-pick the first tab that actually has something" pattern as
    // the dashboard's own merged stats card.
    effect(() => {
      if (this.userPickedTab) return;
      if (this.hasLive()) this.activeTab.set("games");
      else if (this.hasPredictions()) this.activeTab.set("predictions");
      else if (this.hasFavorites()) this.activeTab.set("favorites");
      else if (this.hasPolls()) this.activeTab.set("polls");
      else this.activeTab.set("games");
    });

    // Live score push: patch the matching game in place, same pattern as
    // schedule.ts — keeps the games/predictions/favorites tabs current
    // without a manual refresh while a game is live.
    effect(() => {
      const update = this.events.lastGameUpdate();
      if (!update) return;
      this.games.update((list) =>
        list.map((g) =>
          g.id === update.gameId
            ? {
                ...g,
                homeScore: update.homeScore,
                awayScore: update.awayScore,
                status: update.status,
                quarter: update.quarter ?? g.quarter,
                gameClockSeconds: update.gameClockSeconds ?? g.gameClockSeconds,
              }
            : g
        )
      );
    });
  }

  setTab(tab: LiveCenterTab): void {
    this.userPickedTab = true;
    this.activeTab.set(tab);
  }

  tabButtonClass(tab: LiveCenterTab): Record<string, boolean> {
    const active = this.activeTab() === tab;
    return { "bg-ink text-page": active, "text-muted hover:text-ink": !active };
  }

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      return;
    }

    this.api.getSchedule(SEASON).subscribe({
      next: (schedule) => {
        this.games.set(schedule.games);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.getMyPredictions().subscribe({
      next: (rows) => this.myPredictions.set(rows),
      error: () => {}, // non-critical widget
    });
    this.api.getLegendaryPolls().subscribe({
      next: (rows) => this.openPolls.set(rows),
      error: () => {}, // non-critical widget
    });
  }

  removeFavorite(row: FavoriteRow, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.favoritePlayers.toggle(row);
  }

  leadingCandidate(poll: LegendaryPoll) {
    return [...poll.candidates].sort((a, b) => b.voteCount - a.voteCount)[0] ?? null;
  }

  leadingPercent(poll: LegendaryPoll): number {
    const leader = this.leadingCandidate(poll);
    if (!leader || poll.totalVotes === 0) return 0;
    return Math.round((leader.voteCount / poll.totalVotes) * 100);
  }

  formatClock(seconds: number | null | undefined): string {
    if (seconds == null) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  shortDateFormat(): string {
    return shortDateFormat(this.i18n.lang());
  }
}
