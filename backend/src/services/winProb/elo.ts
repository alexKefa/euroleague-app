import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { games } from "../../db/schema.js";
import { eloProb } from "./model.js";

/**
 * Elo ratings replayed in memory from final results (2026-10-07), not stored:
 * ~400 games replay in microseconds and stay deterministic. The two most
 * recent seasons with results are used; ratings carry into a new season
 * regressed one third toward 1500. Cached per model version and invalidated
 * when a game goes final (live.ts).
 */

const BASE = 1500;

export interface EloGame {
  id: string;
  season: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

export interface EloState {
  ratings: Map<string, number>;
  lastSeason: string | null;
  /** Each replayed game's pre-game home chance, as Elo saw it at the time. */
  preProbByGame: Map<string, number>;
}

/** Pure replay: also used by scripts/fit-win-prob.ts to search K and H. */
export function replayElo(rows: EloGame[], k: number, homeEdge: number): EloState {
  const ratings = new Map<string, number>();
  const preProbByGame = new Map<string, number>();
  let lastSeason: string | null = null;
  for (const g of rows) {
    if (lastSeason !== null && g.season !== lastSeason) {
      for (const [team, r] of ratings) ratings.set(team, BASE + ((r - BASE) * 2) / 3);
    }
    lastSeason = g.season;
    const rh = ratings.get(g.homeTeamId) ?? BASE;
    const ra = ratings.get(g.awayTeamId) ?? BASE;
    const p = eloProb(rh, ra, homeEdge);
    preProbByGame.set(g.id, p);
    const result = g.homeScore > g.awayScore ? 1 : g.homeScore < g.awayScore ? 0 : 0.5;
    ratings.set(g.homeTeamId, rh + k * (result - p));
    ratings.set(g.awayTeamId, ra - k * (result - p));
  }
  return { ratings, lastSeason, preProbByGame };
}

export async function loadEloGames(seasons?: string[]): Promise<EloGame[]> {
  let wanted = seasons;
  if (!wanted) {
    const rows = await db.selectDistinct({ season: games.season }).from(games).where(eq(games.status, "final"));
    wanted = rows.map((r) => r.season).sort().slice(-2);
  }
  if (!wanted.length) return [];
  const rows = await db
    .select({ id: games.id, season: games.season, homeTeamId: games.homeTeamId, awayTeamId: games.awayTeamId, homeScore: games.homeScore, awayScore: games.awayScore })
    .from(games)
    .where(and(eq(games.status, "final"), inArray(games.season, wanted)))
    .orderBy(asc(games.tipoffAt));
  return rows.filter((r): r is EloGame => r.homeScore !== null && r.awayScore !== null);
}

let cache: { version: number; state: Promise<EloState> } | null = null;

export function getEloState(model: { version: number; eloK: number; eloHome: number }): Promise<EloState> {
  if (!cache || cache.version !== model.version) {
    const state = loadEloGames().then((rows) => replayElo(rows, model.eloK, model.eloHome));
    cache = { version: model.version, state };
    state.catch(() => (cache = null));
  }
  return cache.state;
}

export function invalidateElo(): void {
  cache = null;
}

/** Elo's home chance for a game not yet replayed (scheduled or live), using current ratings. */
export function eloMatchup(state: EloState, homeTeamId: string, awayTeamId: string, season: string, homeEdge: number): number {
  const regress = state.lastSeason !== null && season !== state.lastSeason;
  const rating = (team: string) => {
    const r = state.ratings.get(team) ?? BASE;
    return regress ? BASE + ((r - BASE) * 2) / 3 : r;
  };
  return eloProb(rating(homeTeamId), rating(awayTeamId), homeEdge);
}
