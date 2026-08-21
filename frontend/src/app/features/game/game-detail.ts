import { Component, OnInit, HostListener, inject, signal, computed, effect } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { EventsService } from "../../core/events.service";
import { GameDetail, GameBoxscoreLine, PlayerDetail } from "../../core/models";

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
  imports: [CommonModule, RouterLink],
  templateUrl: "./game-detail.html",
})
export class GameDetailComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  protected i18n = inject(I18nService);
  private events = inject(EventsService);

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
          game: { ...current.game, homeScore: update.homeScore, awayScore: update.awayScore, status: update.status },
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
}
