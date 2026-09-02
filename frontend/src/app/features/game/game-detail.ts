import { Component, OnInit, HostListener, inject, signal, computed, effect } from "@angular/core";
import { CommonModule } from "@angular/common";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { EventsService } from "../../core/events.service";
import { AuthService } from "../../core/auth.service";
import { GameDetail, GameBoxscoreLine, PlayerDetail } from "../../core/models";
import { NavIconComponent } from "../../shared/nav-icon";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { StatLegendComponent, StatLegendEntry } from "../../shared/stat-legend";
import { SkeletonComponent } from "../../shared/skeleton";
import { LiveCourtComponent } from "../../shared/live-court";
import { PlayerPhotoComponent } from "../../shared/player-photo";

interface TeamTotals {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
}

function sumStat(lines: GameBoxscoreLine[], key: keyof GameBoxscoreLine): number {
  return lines.reduce((total, line) => {
    const value = line[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function totalsFor(lines: GameBoxscoreLine[]): TeamTotals {
  return {
    points: sumStat(lines, "points"),
    rebounds: sumStat(lines, "rebounds"),
    assists: sumStat(lines, "assists"),
    steals: sumStat(lines, "steals"),
    blocks: sumStat(lines, "blocks"),
    turnovers: sumStat(lines, "turnovers"),
  };
}

@Component({
  selector: "app-game-detail",
  standalone: true,
  imports: [CommonModule, RouterLink, NavIconComponent, RetryImgDirective, StatLegendComponent, SkeletonComponent, LiveCourtComponent, PlayerPhotoComponent],
  templateUrl: "./game-detail.html",
})
export class GameDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  protected i18n = inject(I18nService);
  private events = inject(EventsService);
  protected auth = inject(AuthService);
  private sanitizer = inject(DomSanitizer);

  // Experimental: admin-set YouTube highlight embed. Mirrors store.ts's
  // imageSavingId/imageErrors pattern, simplified to a single game instead
  // of a per-id map since this page only ever shows one.
  readonly highlightSaving = signal(false);
  readonly highlightError = signal<string | null>(null);

  highlightEmbedUrl(videoId: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.youtube-nocookie.com/embed/${videoId}`);
  }

  setHighlight(videoId: string): void {
    const current = this.detail();
    if (!current || this.highlightSaving()) return;
    this.highlightSaving.set(true);
    this.highlightError.set(null);

    this.api.updateGameHighlight(current.game.id, videoId.trim()).subscribe({
      next: () => {
        this.highlightSaving.set(false);
        this.detail.set({ ...current, game: { ...current.game, highlightVideoId: videoId.trim() || null } });
      },
      error: (err) => {
        this.highlightSaving.set(false);
        this.highlightError.set(err?.error?.error ?? "Failed to save — is the backend running?");
      },
    });
  }

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly detail = signal<GameDetail | null>(null);

  // Player names throughout this page open an in-place preview instead of
  // navigating to the full player page — the point is staying on this
  // game's context (clicking through several players shouldn't mean losing
  // your place, or "back" landing on the dashboard instead of this game).
  readonly selectedPlayerId = signal<string | null>(null);
  readonly playerPreview = signal<PlayerDetail | null>(null);
  readonly playerPreviewLoading = signal(false);

  // Player ids currently on a scoring streak, per the live-score simulator's
  // heuristic (see realtime/liveScoreSimulator.ts) — used to badge them in
  // the top performers / box score lists below while the game is live.
  readonly onFireIds = signal<string[]>([]);

  // Which side gets the live court's ambient glow — cross-references
  // onFireIds against the box score's per-player rows (only source that
  // ties a player id back to home/away) rather than a new signal from the
  // SSE payload.
  readonly hotSide = computed<"home" | "away" | "both" | null>(() => {
    const ids = this.onFireIds();
    const box = this.detail()?.boxscore;
    if (!box || ids.length === 0) return null;
    const homeHot = box.home.some((p) => ids.includes(p.player.id));
    const awayHot = box.away.some((p) => ids.includes(p.player.id));
    if (homeHot && awayHot) return "both";
    if (homeHot) return "home";
    if (awayHot) return "away";
    return null;
  });

  private readonly boxScoreLegendKeys: { code: string; key: string }[] = [
    { code: "MIN", key: "game.legendMIN" },
    { code: "PTS", key: "game.legendPTS" },
    { code: "REB", key: "game.legendREB" },
    { code: "AST", key: "game.legendAST" },
    { code: "PIR", key: "game.legendPIR" },
  ];

  readonly boxScoreLegend = computed<StatLegendEntry[]>(() =>
    this.boxScoreLegendKeys.map((k) => ({ code: k.code, label: this.i18n.t(k.key) }))
  );

  readonly isFinal = computed(() => this.detail()?.game.status === "final");
  readonly isLive = computed(() => this.detail()?.game.status === "live");
  // Team-level stat line under the box score — summed client-side from the
  // same per-player box score rows rather than a separate backend query,
  // since the box score already has everything needed.
  readonly teamTotals = computed(() => {
    const box = this.detail()?.boxscore;
    if (!box) return null;
    return { home: totalsFor(box.home), away: totalsFor(box.away) };
  });
  // Whether "players to watch" / team comparison are drawn from a season
  // other than the game's own — happens for games in a season that hasn't
  // been played yet (see the fallback reasoning in backend/src/routes/games.ts).
  readonly usingPriorSeason = computed(() => {
    const d = this.detail();
    return !!d && d.statsSeason !== d.game.season;
  });

  constructor() {
    // Only track `lastGameUpdate()` here — reading `detail()` via its
    // tracked getter and then writing back to it in the same effect would
    // make the effect depend on its own output, so every write schedules
    // another run (new object reference each time) with no way to settle.
    // `.update()`'s read of the current value isn't tracked, so it's safe.
    effect(() => {
      const update = this.events.lastGameUpdate();
      if (!update) return;

      let isThisGame = false;
      this.detail.update((current) => {
        if (!current || update.gameId !== current.game.id) return current;
        isThisGame = true;
        return {
          ...current,
          game: {
            ...current.game,
            homeScore: update.homeScore,
            awayScore: update.awayScore,
            status: update.status,
            quarter: update.quarter ?? current.game.quarter,
            gameClockSeconds: update.gameClockSeconds ?? current.game.gameClockSeconds,
          },
        };
      });
      if (!isThisGame) return;

      this.onFireIds.set(update.onFireIds ?? []);
      // The score/status patch above is instant; box score / top performers
      // / double-doubles are DB-backed (the simulator writes them alongside
      // the score on every tick — see games.ts), so re-fetch to pick those
      // up too. This subscribe callback runs outside the effect's tracked
      // scope, so setting `detail` here again doesn't re-trigger this effect.
      this.api.getGame(update.gameId).subscribe({ next: (d) => this.detail.set(d) });
    });
  }

  ngOnInit(): void {
    const gameId = this.route.snapshot.paramMap.get("id");
    if (!gameId) {
      this.loading.set(false);
      this.error.set(this.i18n.t("game.gameNotFound"));
      return;
    }

    this.api.getGame(gameId).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error ?? this.i18n.t("game.failedToLoad"));
        this.loading.set(false);
      },
    });
  }

  gameResult(): "home" | "away" | null {
    const g = this.detail()?.game;
    if (!g || g.status !== "final") return null;
    return g.homeScore! > g.awayScore! ? "home" : "away";
  }

  openPlayer(playerId: string): void {
    this.selectedPlayerId.set(playerId);
    this.playerPreview.set(null);
    this.playerPreviewLoading.set(true);

    this.api.getPlayer(playerId).subscribe({
      next: (detail) => {
        this.playerPreview.set(detail);
        this.playerPreviewLoading.set(false);
      },
      error: () => this.playerPreviewLoading.set(false),
    });
  }

  closePlayer(): void {
    this.selectedPlayerId.set(null);
    this.playerPreview.set(null);
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.closePlayer();
  }

  fmtPct(value: number | null | undefined): string {
    return value !== null && value !== undefined ? `${value.toFixed(1)}%` : "—";
  }

  fmtNum(value: number | null | undefined): string {
    return value !== null && value !== undefined ? value.toFixed(1) : "—";
  }

  formatClock(seconds: number | null | undefined): string {
    if (seconds == null) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
}
