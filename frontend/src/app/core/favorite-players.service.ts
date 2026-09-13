import { Injectable, computed, effect, inject, signal } from "@angular/core";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { FavoritePlayer } from "./models";

/**
 * Shared favorite-players state — one fetch backs both the star toggle on
 * player-detail.ts and the dashboard's Live Center favorites tab, so
 * toggling a favorite there is reflected everywhere else immediately
 * without a separate refetch. Same "one shared signal, refreshed on auth
 * change" shape as TradesNotificationService.
 */
@Injectable({ providedIn: "root" })
export class FavoritePlayersService {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  readonly favorites = signal<FavoritePlayer[]>([]);
  readonly favoriteIds = computed(() => new Set(this.favorites().map((f) => f.id)));

  constructor() {
    effect(() => {
      if (this.auth.accessToken()) {
        this.refresh();
      } else {
        this.favorites.set([]);
      }
    });
  }

  refresh(): void {
    this.api.getFavoritePlayers().subscribe({
      next: (rows) => this.favorites.set(rows),
      error: () => {}, // non-critical — list just stays at its last known state
    });
  }

  isFavorite(playerId: string): boolean {
    return this.favoriteIds().has(playerId);
  }

  // Optimistic — flips local state immediately, then reconciles with the
  // server; a failed request just re-fetches to correct it rather than
  // leaving the UI stuck on a state that didn't actually take.
  toggle(player: FavoritePlayer): void {
    const wasFavorite = this.isFavorite(player.id);
    this.favorites.set(
      wasFavorite ? this.favorites().filter((f) => f.id !== player.id) : [...this.favorites(), player]
    );

    const request = wasFavorite ? this.api.unfavoritePlayer(player.id) : this.api.favoritePlayer(player.id);
    request.subscribe({ error: () => this.refresh() });
  }
}
