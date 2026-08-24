import { Injectable, computed, effect, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { API_BASE_URL } from "./api-config";
import { AuthService } from "./auth.service";

export interface GameUpdate {
  gameId: string;
  homeScore: number;
  awayScore: number;
  status: string;
  onFireIds?: string[];
  quarter?: number;
  gameClockSeconds?: number;
}

/**
 * One shared SSE connection to /api/events for the whole app. Live scores
 * are public, so this connects whether or not the user is logged in; it
 * reconnects whenever the access token changes so a userId is attached to
 * the connection once logged in, for a future per-user channel (trade
 * updates — see project memory) to reuse without opening a second stream.
 */
@Injectable({ providedIn: "root" })
export class EventsService {
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private source: EventSource | null = null;

  readonly lastGameUpdate = signal<GameUpdate | null>(null);

  // Game ids currently live. Seeded once from a REST fetch on boot, so a
  // visitor who opens the app mid-game sees it immediately rather than
  // waiting for the next SSE tick; kept current after that purely from the
  // stream, same source as lastGameUpdate above. No season param — the
  // backend already defaults to the current one, and this only needs
  // "is anything live right now", not a specific round's games.
  readonly liveGameIds = signal<Set<string>>(new Set());

  // Game ids the logged-in user has predicted (any status — see
  // predictedGameIds below), so the nav badge only fires for a live game
  // the user actually has a stake in, not every live game league-wide.
  readonly predictedGameIds = signal<Set<string>>(new Set());

  readonly hasLiveGame = computed(() => {
    const mine = this.predictedGameIds();
    for (const id of this.liveGameIds()) {
      if (mine.has(id)) return true;
    }
    return false;
  });

  constructor() {
    effect(() => {
      const token = this.auth.accessToken();
      this.connect(token);
      if (token) {
        this.refreshPredictedGames();
      } else {
        this.predictedGameIds.set(new Set());
      }
    });

    this.http.get<{ games: { id: string; status: string }[] }>(`${API_BASE_URL}/games/schedule`).subscribe({
      next: (schedule) => {
        this.liveGameIds.set(new Set(schedule.games.filter((g) => g.status === "live").map((g) => g.id)));
      },
      error: () => {}, // non-critical — the badge just starts empty and catches up via SSE
    });
  }

  private refreshPredictedGames(): void {
    this.http.get<{ gameId: string }[]>(`${API_BASE_URL}/predictions/me`).subscribe({
      next: (rows) => this.predictedGameIds.set(new Set(rows.map((r) => r.gameId))),
      error: () => {}, // non-critical — badge just stays off until the next successful fetch
    });
  }

  // Called by PredictionsComponent right after a pick is optimistically
  // added/removed, so a game predicted mid-session (after this service's
  // boot-time fetch already ran) still gets the badge once it goes live —
  // without waiting on another round trip to /predictions/me.
  markPredicted(gameId: string): void {
    this.predictedGameIds.update((ids) => new Set(ids).add(gameId));
  }

  unmarkPredicted(gameId: string): void {
    this.predictedGameIds.update((ids) => {
      const next = new Set(ids);
      next.delete(gameId);
      return next;
    });
  }

  private connect(token: string | null): void {
    this.source?.close();
    const url = `${API_BASE_URL}/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const source = new EventSource(url);
    source.addEventListener("game-update", (event) => {
      const update: GameUpdate = JSON.parse((event as MessageEvent).data);
      this.lastGameUpdate.set(update);
      this.liveGameIds.update((ids) => {
        const next = new Set(ids);
        if (update.status === "live") next.add(update.gameId);
        else next.delete(update.gameId);
        return next;
      });
    });
    this.source = source;
  }
}
