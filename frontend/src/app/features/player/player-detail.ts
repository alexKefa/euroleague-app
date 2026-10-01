import { Component, DestroyRef, OnInit, computed, inject, signal } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { PlayerDetail, PlayerShotChart, PlayerGameLogEntry, ScoutingReport, ScoutingMetricKey } from "../../core/models";
import { formatPlayerName } from "../../shared/player-name";
import { TeamCodePipe } from "../../shared/team-display-code";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { ShotChartComponent } from "./shot-chart";
import { PlayerPhotoComponent } from "../../shared/player-photo";
import { newsDateLocale, shortDateFormat } from "../../shared/news-date-format";
import { AuthService } from "../../core/auth.service";
import { FavoritePlayersService } from "../../core/favorite-players.service";
import { NavIconComponent } from "../../shared/nav-icon";
import { NavHistoryService } from "../../core/nav-history.service";

@Component({
  selector: "app-player-detail",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    RetryImgDirective,
    SkeletonComponent,
    ShotChartComponent,
    PlayerPhotoComponent,
    NavIconComponent,
    TeamCodePipe,
  ],
  templateUrl: "./player-detail.html",
})
export class PlayerDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  protected i18n = inject(I18nService);
  protected auth = inject(AuthService);
  private favoritePlayers = inject(FavoritePlayersService);
  protected navHistory = inject(NavHistoryService);

  readonly detail = signal<PlayerDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly shotChart = signal<PlayerShotChart | null>(null);
  readonly gameLog = signal<PlayerGameLogEntry[]>([]);

  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  // Overview / Scouting report tabs (2026-10-01). The tab lives in the URL
  // (?tab=scouting) so a report link can be shared.
  readonly tab = signal<"overview" | "scouting">("overview");
  readonly scouting = signal<ScoutingReport | null>(null);
  readonly scoutingLoading = signal(false);
  readonly scoutingError = signal(false);
  private playerId: string | null = null;
  protected readonly playerName = formatPlayerName;

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      this.tab.set(q.get("tab") === "scouting" ? "scouting" : "overview");
      if (this.tab() === "scouting") this.loadScouting();
    });
    // paramMap, not a snapshot: a "similar players" link lands on this same
    // route with another id, which reuses the component.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => this.load(params.get("id")));
  }

  private load(playerId: string | null): void {
    this.playerId = playerId;
    this.detail.set(null);
    this.shotChart.set(null);
    this.gameLog.set([]);
    this.scouting.set(null);
    this.scoutingFor = null;
    this.error.set(null);
    if (!playerId) {
      this.error.set(this.i18n.t("player.noPlayerSpecified"));
      this.loading.set(false);
      return;
    }
    this.loading.set(true);

    this.api.getPlayer(playerId).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.i18n.t("player.couldntLoad"));
        this.loading.set(false);
      },
    });

    this.api.getPlayerShots(playerId).subscribe({
      next: (chart) => this.shotChart.set(chart),
      error: () => {},
    });

    this.api.getPlayerGames(playerId).subscribe({
      next: (log) => this.gameLog.set(log.rows),
      error: () => {}, // non-critical section — page still works with no log
    });

    if (this.tab() === "scouting") this.loadScouting();
  }

  setTab(tab: "overview" | "scouting"): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === "scouting" ? "scouting" : null },
      queryParamsHandling: "merge",
      replaceUrl: true,
    });
  }

  // Which player's report is loading/loaded, so a response for a player
  // the user has already navigated away from is dropped.
  private scoutingFor: string | null = null;

  private loadScouting(): void {
    const id = this.playerId;
    if (!id || this.scoutingFor === id) return;
    this.scoutingFor = id;
    this.scouting.set(null);
    this.scoutingLoading.set(true);
    this.scoutingError.set(false);
    this.api.getPlayerScouting(id).subscribe({
      next: (r) => {
        if (this.scoutingFor !== id) return;
        this.scouting.set(r);
        this.scoutingLoading.set(false);
      },
      error: () => {
        if (this.scoutingFor !== id) return;
        this.scoutingError.set(true);
        this.scoutingLoading.set(false);
      },
    });
  }

  // Top 3 strengths (75th percentile and up) and weaknesses (30th and
  // below) among his position, strongest first.
  readonly strengths = computed(() =>
    (this.scouting()?.metrics ?? []).filter((m) => m.percentile >= 75).sort((a, b) => b.percentile - a.percentile).slice(0, 3)
  );
  readonly weaknesses = computed(() =>
    (this.scouting()?.metrics ?? []).filter((m) => m.percentile <= 30).sort((a, b) => a.percentile - b.percentile).slice(0, 3)
  );

  metricValue(key: ScoutingMetricKey, value: number): string {
    return key === "efficiency" ? `${value.toFixed(1)}%` : value.toFixed(1);
  }

  formDelta(last5: number, season: number): number {
    return Math.round((last5 - season) * 10) / 10;
  }

  positionPlural(position: string | null): string {
    return this.i18n.t(`player.scouting.pos.${position ?? "all"}`);
  }

  async shareScouting(): Promise<void> {
    const url = window.location.href;
    const title = this.detail() ? formatPlayerName(this.detail()!.player.name) : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: `${title} · ${this.i18n.t("player.scouting.title")}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        this.copied.set(true);
        setTimeout(() => this.copied.set(false), 2000);
      }
    } catch {
      // Share sheet dismissed.
    }
  }
  readonly copied = signal(false);

  isFavorite(playerId: string): boolean {
    return this.favoritePlayers.isFavorite(playerId);
  }

  toggleFavorite(detail: PlayerDetail): void {
    this.favoritePlayers.toggle({
      id: detail.player.id,
      name: detail.player.name,
      photoUrl: detail.player.photoUrl,
      teamId: detail.team.id,
      teamName: detail.team.name,
      teamCode: detail.team.code,
    });
  }

  isHomeGame(entry: PlayerGameLogEntry): boolean {
    return entry.game.homeTeam.id === this.detail()?.team.id;
  }

  opponentTeam(entry: PlayerGameLogEntry) {
    return this.isHomeGame(entry) ? entry.game.awayTeam : entry.game.homeTeam;
  }

  isWin(entry: PlayerGameLogEntry): boolean {
    const { homeScore, awayScore } = entry.game;
    if (homeScore === null || awayScore === null) return false;
    return this.isHomeGame(entry) ? homeScore > awayScore : awayScore > homeScore;
  }

  fmtPct(value: number | null | undefined): string {
    return value !== null && value !== undefined ? `${value.toFixed(1)}%` : "—";
  }

  fmtNum(value: number | null | undefined): string {
    return value !== null && value !== undefined ? value.toFixed(1) : "—";
  }

  // Greek month names/day-first order for the date pipe — see
  // shared/news-date-format.ts for why the locale has to be passed
  // explicitly.
  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  shortDateFormat(): string {
    return shortDateFormat(this.i18n.lang());
  }
}
