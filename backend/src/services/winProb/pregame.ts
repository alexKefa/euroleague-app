import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { gameOdds, gameWinProb, wpModel } from "../../db/schema.js";
import { eloMatchup, getEloState } from "./elo.js";
import { clampProb } from "./model.js";

export interface WpModel {
  version: number;
  sigma: number;
  eloK: number;
  eloHome: number;
}

export interface PreGame {
  homeProb: number;
  source: "odds" | "elo";
}

export interface PreGameGame {
  id: string;
  season: string;
  homeTeamId: string;
  awayTeamId: string;
}

let modelCache: { at: number; model: WpModel | null } | null = null;

/** The active model constants (cached a minute). Null until the fit script has run. */
export async function activeModel(): Promise<WpModel | null> {
  if (modelCache && Date.now() - modelCache.at < 60_000) return modelCache.model;
  const [row] = await db
    .select({ version: wpModel.version, sigma: wpModel.sigma, eloK: wpModel.eloK, eloHome: wpModel.eloHome })
    .from(wpModel)
    .where(eq(wpModel.active, true))
    .orderBy(desc(wpModel.version))
    .limit(1);
  modelCache = { at: Date.now(), model: row ?? null };
  return modelCache.model;
}

/**
 * Pre-game home chances for many games in two queries: the frozen tip-off
 * snapshot when there is one, then the de-vigged odds, then Elo (for a final
 * game without a snapshot, Elo as it stood before that game).
 */
export async function preGameProbs(list: PreGameGame[], model: WpModel): Promise<Map<string, PreGame>> {
  const out = new Map<string, PreGame>();
  if (!list.length) return out;
  const ids = list.map((g) => g.id);
  const [snaps, odds, elo] = await Promise.all([
    db.select({ gameId: gameWinProb.gameId, p: gameWinProb.preHomeProb, source: gameWinProb.source }).from(gameWinProb).where(inArray(gameWinProb.gameId, ids)),
    db.select({ gameId: gameOdds.gameId, p: gameOdds.homeFairProb }).from(gameOdds).where(inArray(gameOdds.gameId, ids)),
    getEloState(model),
  ]);
  const snapBy = new Map(snaps.map((s) => [s.gameId, s]));
  const oddsBy = new Map(odds.map((o) => [o.gameId, o.p]));
  for (const g of list) {
    const snap = snapBy.get(g.id);
    if (snap) {
      out.set(g.id, { homeProb: clampProb(snap.p), source: snap.source === "odds" ? "odds" : "elo" });
      continue;
    }
    const o = oddsBy.get(g.id);
    if (o !== undefined) {
      out.set(g.id, { homeProb: clampProb(o), source: "odds" });
      continue;
    }
    const replayed = elo.preProbByGame.get(g.id);
    const p = replayed ?? eloMatchup(elo, g.homeTeamId, g.awayTeamId, g.season, model.eloHome);
    out.set(g.id, { homeProb: clampProb(p), source: "elo" });
  }
  return out;
}

/** Freezes the pre-game chance at tip-off (first live tick). Safe to call repeatedly. */
export async function snapshotPreGame(game: PreGameGame): Promise<PreGame | null> {
  const model = await activeModel();
  if (!model) return null;
  const pre = (await preGameProbs([game], model)).get(game.id)!;
  await db
    .insert(gameWinProb)
    .values({ gameId: game.id, preHomeProb: pre.homeProb, source: pre.source, modelVersion: model.version })
    .onConflictDoNothing();
  return pre;
}
