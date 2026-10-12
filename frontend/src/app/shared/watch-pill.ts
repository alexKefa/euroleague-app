import { Component, ElementRef, HostListener, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { Router } from "@angular/router";
import { WatchlistService, Watch } from "../core/watchlist.service";
import { I18nService } from "../core/i18n.service";
import { PlayerPhotoComponent } from "./player-photo";
import { RetryImgDirective } from "./retry-img.directive";
import { TeamCodePipe } from "./team-display-code";

/**
 * Floating watch bubble (2026-10-12, "fix the UI of the pin... like a float
 * button on top throughout the app"): a round button top-right showing the
 * first pinned item, a count and a live dot; tap for a card of every pin,
 * each with its own unpin. Replaces the centred pill under the nav, which
 * covered page titles. Same WatchlistService, same 3-pin limit.
 */
@Component({
  selector: "app-watch-pill",
  standalone: true,
  imports: [CommonModule, PlayerPhotoComponent, RetryImgDirective, TeamCodePipe],
  templateUrl: "./watch-pill.html",
  styles: [
    `
      .watch-bubble {
        box-shadow: 0 0 0 2px var(--ring), 0 4px 16px rgba(0, 0, 0, 0.5);
        transition: transform 150ms ease-out;
      }
      .watch-bubble:active {
        transform: scale(0.94);
      }
      .watch-card {
        transform-origin: top right;
        animation: watch-card-in 140ms ease-out;
      }
      @keyframes watch-card-in {
        from {
          opacity: 0;
          transform: scale(0.94);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .watch-bubble,
        .watch-card {
          transition: none;
          animation: none;
        }
      }
    `,
  ],
})
export class WatchPillComponent {
  protected watchlist = inject(WatchlistService);
  protected i18n = inject(I18nService);
  private router = inject(Router);
  private host = inject(ElementRef<HTMLElement>);

  protected readonly open = signal(false);
  protected readonly first = computed(() => this.watchlist.watches()[0] ?? null);
  protected readonly anyLive = computed(() => this.watchlist.watches().some((w) => w.status === "live"));
  // The first pin's team colour rings the bubble.
  protected readonly ringColor = computed(() => {
    const w = this.first();
    if (!w) return "transparent";
    return (w.kind === "game" ? w.homeTeam.primaryColor : w.primaryColor) ?? "var(--accent-primary)";
  });

  watchKey(w: Watch): string {
    return w.kind === "game" ? `game:${w.gameId}` : `player:${w.playerId}`;
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  go(w: Watch): void {
    this.open.set(false);
    this.router.navigate(["/games", w.gameId]);
  }

  unpin(event: Event, w: Watch): void {
    event.stopPropagation();
    if (w.kind === "game") this.watchlist.unpin("game", w.gameId);
    else this.watchlist.unpin("player", w.playerId);
    if (this.watchlist.watches().length === 0) this.open.set(false);
  }

  @HostListener("document:click", ["$event"])
  onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.open.set(false);
  }
}
