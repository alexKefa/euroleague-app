import { Injectable, effect, inject, signal } from "@angular/core";
import { API_BASE_URL } from "./api-config";
import { AuthService } from "./auth.service";

export interface GameUpdate {
  gameId: string;
  homeScore: number;
  awayScore: number;
  status: string;
  onFireIds?: string[];
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
  private source: EventSource | null = null;

  readonly lastGameUpdate = signal<GameUpdate | null>(null);

  constructor() {
    effect(() => {
      const token = this.auth.accessToken();
      this.connect(token);
    });
  }

  private connect(token: string | null): void {
    this.source?.close();
    const url = `${API_BASE_URL}/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    const source = new EventSource(url);
    source.addEventListener("game-update", (event) => {
      this.lastGameUpdate.set(JSON.parse((event as MessageEvent).data));
    });
    this.source = source;
  }
}
