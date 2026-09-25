import { Injectable, effect, inject, signal } from "@angular/core";
import { EventsService } from "./events.service";

// "Watch Pill" (2026-09-25 — "a sharing-like pill component which can be
// pinned... to either watch a game on the fly or a player"). A small,
// persistent, Dynamic-Island-style pill (shared/watch-pill.ts, mounted
// globally in app.component.html) that stays visible while navigating and
// scrolling anywhere in the app, showing live score/points for whatever the
// viewer has pinned. This service owns the pinned list and keeps it live —
// the pill component itself is a pure renderer.
//
// Deliberately a per-device convenience, not synced anywhere: pins persist
// to localStorage (same "per-viewer state, never read back by Claude/shared
// across devices" convention as install-banner.ts's visit counter), not a
// server table. A live watch is inherently ephemeral (it stops mattering
// the moment the game ends), so there's no real case for syncing it across
// a viewer's devices the way a standing preference would need.

export interface GameWatch {
  kind: "game";
  gameId: string;
  homeTeam: { code: string; name: string; logoUrl: string | null; primaryColor: string | null };
  awayTeam: { code: string; name: string; logoUrl: string | null; primaryColor: string | null };
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  quarter: number | null;
}

export interface PlayerWatch {
  kind: "player";
  playerId: string;
  // The live game this player's points are being read from — kept current
  // as broadcasts arrive (see the constructor effect below), not fixed at
  // pin time, so this stays right even across a real edge case: pinning a
  // player from one live game, watching it finish, and them (implausibly)
  // being trackable in a later one is out of scope for a same-day pill —
  // gameId here just always reflects "the game this update came from".
  gameId: string;
  name: string;
  photoUrl: string | null;
  teamCode: string;
  primaryColor: string | null;
  points: number;
  status: string;
  quarter: number | null;
}

export type Watch = GameWatch | PlayerWatch;

const STORAGE_KEY = "clutch-watchlist";
// Bento-widget-style cap (see CLAUDE.md's Predictions redesign) — enough to
// glance at three live things at once as small chips, never enough to need
// its own scroll/overflow handling.
export const MAX_WATCHES = 3;

function loadFromStorage(): Watch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // private browsing / blocked storage / corrupt JSON — start empty, not broken
  }
}

@Injectable({ providedIn: "root" })
export class WatchlistService {
  private events = inject(EventsService);

  readonly watches = signal<Watch[]>(loadFromStorage());

  constructor() {
    // Keeps every pinned game/player current off the same app-wide SSE
    // stream game-detail.ts's own live view reads (EventsService.lastGameUpdate)
    // — no new backend endpoint, no polling. A pinned player's `points` comes
    // straight from a matching ScoringEvent's `totalPoints` (already the
    // real, current running total — see hub.ts's ScoringEvent doc comment),
    // not re-derived here.
    effect(() => {
      const update = this.events.lastGameUpdate();
      if (!update) return;

      this.watches.update((list) =>
        list.map((w) => {
          if (w.kind === "game") {
            if (w.gameId !== update.gameId) return w;
            return { ...w, homeScore: update.homeScore, awayScore: update.awayScore, status: update.status, quarter: update.quarter ?? w.quarter };
          }
          const scoreEvent = update.scoringEvents?.find((e) => e.playerId === w.playerId);
          if (scoreEvent) {
            return { ...w, gameId: update.gameId, points: scoreEvent.totalPoints, status: update.status, quarter: update.quarter ?? w.quarter };
          }
          if (w.gameId === update.gameId) {
            return { ...w, status: update.status, quarter: update.quarter ?? w.quarter };
          }
          return w;
        })
      );
    });

    // Persists on every change, including the initial load-from-storage run
    // (a harmless immediate re-save of what was just read).
    effect(() => {
      const list = this.watches();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      } catch {
        // Private browsing / blocked storage — pins just don't survive a reload.
      }
    });
  }

  isPinned(kind: "game" | "player", id: string): boolean {
    if (kind === "game") return this.watches().some((w) => w.kind === "game" && w.gameId === id);
    return this.watches().some((w) => w.kind === "player" && w.playerId === id);
  }

  canPinMore(): boolean {
    return this.watches().length < MAX_WATCHES;
  }

  /** Returns false (and pins nothing) once already at MAX_WATCHES. */
  pinGame(game: Omit<GameWatch, "kind">): boolean {
    if (this.isPinned("game", game.gameId)) return true;
    if (!this.canPinMore()) return false;
    this.watches.update((list) => [...list, { kind: "game", ...game }]);
    return true;
  }

  pinPlayer(player: Omit<PlayerWatch, "kind">): boolean {
    if (this.isPinned("player", player.playerId)) return true;
    if (!this.canPinMore()) return false;
    this.watches.update((list) => [...list, { kind: "player", ...player }]);
    return true;
  }

  unpin(kind: "game" | "player", id: string): void {
    this.watches.update((list) =>
      list.filter((w) => {
        if (w.kind !== kind) return true;
        return w.kind === "game" ? w.gameId !== id : w.playerId !== id;
      })
    );
  }

  toggleGame(game: Omit<GameWatch, "kind">): void {
    if (this.isPinned("game", game.gameId)) this.unpin("game", game.gameId);
    else this.pinGame(game);
  }

  togglePlayer(player: Omit<PlayerWatch, "kind">): void {
    if (this.isPinned("player", player.playerId)) this.unpin("player", player.playerId);
    else this.pinPlayer(player);
  }
}
