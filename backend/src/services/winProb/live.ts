import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { games } from "../../db/schema.js";
import { invalidateElo } from "./elo.js";
import { expectedMargin, secondsLeft, winProb } from "./model.js";
import { activeModel, snapshotPreGame } from "./pregame.js";

/**
 * Live win probability (2026-10-07). hub.broadcast calls enrichGameUpdate for
 * every "game-update", so both producers (liveGamesSync and the simulator)
 * get a homeWinProb without changes. Synchronous and never throws: the
 * pre-game chance and model load in the background; until then a neutral
 * 50% start is used. Points are kept in memory per game for the chart; after
 * a restart they restart from the next tick.
 */

export interface LivePoint {
  period: number;
  clock: number;
  s: number;
  homeScore: number;
  awayScore: number;
  homeProb: number;
}

interface LiveGame {
  mu: number;
  sigma: number;
  ready: boolean;
  loading: boolean;
  points: LivePoint[];
}

const DEFAULT_SIGMA = 12;
const live = new Map<string, LiveGame>();

function load(gameId: string, entry: LiveGame): void {
  entry.loading = true;
  (async () => {
    const [g] = await db
      .select({ id: games.id, season: games.season, homeTeamId: games.homeTeamId, awayTeamId: games.awayTeamId })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1);
    const model = await activeModel();
    if (!g || !model) return;
    const pre = await snapshotPreGame(g);
    if (!pre) return;
    entry.sigma = model.sigma;
    entry.mu = expectedMargin(pre.homeProb, model.sigma);
    entry.ready = true;
  })()
    .catch((err) => console.error(`[win-prob] live load ${gameId} failed:`, err))
    .finally(() => {
      entry.loading = false;
    });
}

export function enrichGameUpdate(data: Record<string, unknown>): void {
  try {
    const gameId = data.gameId as string | undefined;
    const home = data.homeScore as number | undefined;
    const away = data.awayScore as number | undefined;
    if (!gameId || typeof home !== "number" || typeof away !== "number") return;

    if (data.status === "final") {
      invalidateElo();
      data.homeWinProb = home > away ? 1 : home < away ? 0 : 0.5;
      return;
    }
    if (data.status !== "live") return;

    let entry = live.get(gameId);
    if (!entry) {
      entry = { mu: 0, sigma: DEFAULT_SIGMA, ready: false, loading: false, points: [] };
      live.set(gameId, entry);
    }
    if (!entry.ready && !entry.loading) load(gameId, entry);

    const period = data.quarter as number | undefined;
    const clock = data.gameClockSeconds as number | undefined;
    if (typeof period !== "number" || typeof clock !== "number") return;
    const s = secondsLeft(period, clock);
    const homeProb = winProb(home - away, s, entry.mu, entry.sigma);
    data.homeWinProb = Math.round(homeProb * 10000) / 10000;

    const last = entry.points[entry.points.length - 1];
    if (!last || last.s !== s || last.homeScore !== home || last.awayScore !== away) {
      entry.points.push({ period, clock, s, homeScore: home, awayScore: away, homeProb: data.homeWinProb as number });
    }
  } catch (err) {
    console.error("[win-prob] enrich failed:", err);
  }
}

export function getLivePoints(gameId: string): LivePoint[] {
  return live.get(gameId)?.points ?? [];
}
