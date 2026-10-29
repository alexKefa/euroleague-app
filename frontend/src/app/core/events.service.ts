import { Injectable, computed, effect, inject, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { API_BASE_URL } from "./api-config";
import { AuthService } from "./auth.service";

export interface GameScoringEvent {
  playerId: string;
  playerName: string;
  teamSide: "home" | "away";
  points: number;
  totalPoints: number;
}

export interface GameUpdate {
  gameId: string;
  homeScore: number;
  awayScore: number;
  status: string;
  onFireIds?: string[];
  quarter?: number;
  gameClockSeconds?: number;
  // Home win chance from the backend's win-probability model (2026-10-07).
  homeWinProb?: number;
  // Derived, not a real captured play — see backend/src/realtime/hub.ts's
  // ScoringEvent doc comment. Empty on a game's first tick after this
  // client (re)connects, and always empty once status is "final".
  scoringEvents?: GameScoringEvent[];
}

export interface TradeUpdate {
  offerId: string;
  reason: "offered" | "accepted" | "declined" | "cancelled";
}

export interface BattleUpdate {
  battleId: string;
  reason: "challenged" | "accepted" | "declined" | "cancelled" | "move" | "finished";
}

// A short tab switch keeps the stream; longer than this and it closes.
const HIDDEN_GRACE_MS = 15_000;

export interface DuelUpdate {
  id: string;
  status: string;
  quarter: number;
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

  // A trade offer involving the logged-in user just changed state (see
  // routes/trades.ts's notifyTradeUpdate) — pushed only to that user's own
  // connection (sendToUser, not broadcast), so anything reacting to this
  // doesn't need to check whether the update is "theirs". Every listener
  // (TradesNotificationService's badge, TradesComponent, InventoryComponent)
  // re-fetches its own state from REST on receipt rather than trusting this
  // payload directly — it only carries enough to know *that* something
  // changed, not what.
  readonly lastTradeUpdate = signal<TradeUpdate | null>(null);

  // A card battle involving the logged-in user just changed state (see
  // routes/battles.ts's notifyBattleUpdate) — same per-user sendToUser
  // delivery and "payload only says *that* something changed, re-fetch via
  // REST" convention as lastTradeUpdate above.
  readonly lastBattleUpdate = signal<BattleUpdate | null>(null);

  // A Four Quarters duel involving the logged-in user changed (services/duels.ts
  // sends event "duel"). Same per-user, "re-fetch via REST" convention.
  readonly lastDuelUpdate = signal<DuelUpdate | null>(null);

  // Bumped each time the stream reopens after the page was hidden. The
  // stream closes while the app is off screen (see onVisibilityChange), so
  // per-user listeners refetch on this too, catching up on anything missed.
  readonly resync = signal(0);
  private token: string | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;

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
  // False until the first /predictions/me fetch for this login settles, so
  // a pick count can show a skeleton instead of a misleading 0.
  readonly predictedGameIdsLoaded = signal(false);

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
      this.token = token;
      if (!this.paused) this.connect(token);
      if (token) {
        this.refreshPredictedGames();
      } else {
        this.predictedGameIds.set(new Set());
        this.predictedGameIdsLoaded.set(false);
      }
    });

    this.http.get<{ games: { id: string; status: string }[] }>(`${API_BASE_URL}/games/schedule`).subscribe({
      next: (schedule) => {
        this.liveGameIds.set(new Set(schedule.games.filter((g) => g.status === "live").map((g) => g.id)));
      },
      error: () => {}, // non-critical — the badge just starts empty and catches up via SSE
    });

    document.addEventListener("visibilitychange", () => this.onVisibilityChange());
  }

  // An open stream is how the backend knows the app is on screen: pushes are
  // skipped for users with one (services/push.ts). So the stream closes once
  // the page has been hidden for HIDDEN_GRACE_MS (tab switch, minimised app,
  // locked phone) and reopens the moment it's visible again.
  private onVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      if (this.hiddenTimer || this.paused) return;
      this.hiddenTimer = setTimeout(() => {
        this.hiddenTimer = null;
        this.paused = true;
        this.source?.close();
        this.source = null;
      }, HIDDEN_GRACE_MS);
      return;
    }
    if (this.hiddenTimer) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
    if (this.paused) {
      this.paused = false;
      this.connect(this.token);
      this.resync.update((n) => n + 1);
    }
  }

  private refreshPredictedGames(): void {
    this.http.get<{ gameId: string }[]>(`${API_BASE_URL}/predictions/me`).subscribe({
      next: (rows) => {
        this.predictedGameIds.set(new Set(rows.map((r) => r.gameId)));
        this.predictedGameIdsLoaded.set(true);
      },
      error: () => this.predictedGameIdsLoaded.set(true), // non-critical — badge just stays off until the next successful fetch
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
    source.addEventListener("trade-update", (event) => {
      this.lastTradeUpdate.set(JSON.parse((event as MessageEvent).data));
    });
    source.addEventListener("battle-update", (event) => {
      this.lastBattleUpdate.set(JSON.parse((event as MessageEvent).data));
    });
    source.addEventListener("duel", (event) => {
      this.lastDuelUpdate.set(JSON.parse((event as MessageEvent).data));
    });
    this.source = source;
  }
}
