import { Component, OnInit, HostListener, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { GameDetail, PlayerDetail } from "../../core/models";

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

  readonly isFinal = computed(() => this.detail()?.game.status === "final");
  // Whether "players to watch" / team comparison are drawn from a season
  // other than the game's own — happens for games in a season that hasn't
  // been played yet (see the fallback reasoning in backend/src/routes/games.ts).
  readonly usingPriorSeason = computed(() => {
    const d = this.detail();
    return !!d && d.statsSeason !== d.game.season;
  });

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
