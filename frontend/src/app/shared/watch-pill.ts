import { Component, inject } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router } from "@angular/router";
import { WatchlistService, Watch } from "../core/watchlist.service";
import { I18nService } from "../core/i18n.service";
import { PlayerPhotoComponent } from "./player-photo";
import { RetryImgDirective } from "./retry-img.directive";
import { TeamCodePipe } from "./team-display-code";

// Global, persistent "Live Activity"-style pill (2026-09-25) — see
// WatchlistService's own doc comment for the full design reasoning. Mounted
// once in app.component.html, so it survives route changes and scrolling
// on every page, not just game-detail.
@Component({
  selector: "app-watch-pill",
  standalone: true,
  imports: [CommonModule, PlayerPhotoComponent, RetryImgDirective, TeamCodePipe],
  templateUrl: "./watch-pill.html",
})
export class WatchPillComponent {
  protected watchlist = inject(WatchlistService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  watchKey(w: Watch): string {
    return w.kind === "game" ? `game:${w.gameId}` : `player:${w.playerId}`;
  }

  open(w: Watch): void {
    // Both variants carry gameId (a player watch's own live game) — always
    // lands on the live game page, which is the more useful destination
    // than a player's static season page while they're actively playing.
    this.router.navigate(["/games", w.gameId]);
  }

  unpin(event: Event, w: Watch): void {
    event.stopPropagation();
    if (w.kind === "game") this.watchlist.unpin("game", w.gameId);
    else this.watchlist.unpin("player", w.playerId);
  }
}
