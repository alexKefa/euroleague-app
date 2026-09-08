import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, playerGameStats } from "../db/schema.js";

// Points formula for the live "top scorer" prop pick — a sibling to
// services/points.ts, not merged into it, since that file's comments are
// specifically about the odds-weighted (game_odds) win/loss formula;
// mixing in a differently-sourced one here would make those misleading.
//
// This formula uses only this app's own data (playerSeasonStats.pointsPerGame)
// rather than The Odds API, whose EuroLeague player-prop coverage is
// unconfirmed — an internal proxy for "how big a long-shot was this pick",
// in the same spirit as services/points.ts's odds multiple but not the same
// math: a player's own season PPG, normalized against TYPICAL_TOP_SCORER_PPG
// (the real max points-per-game seen across the 2023-24/2024-25/2025-26
// seasons was 19-20.4 — 19 picked as a realistic "what a real top scorer
// averages" reference, not an arbitrary guess), stands in for fairProb.
export const TOP_SCORER_POINTS_PER_CORRECT = 10;
export const TOP_SCORER_POINTS_CAP = 40;
const MIN_SHARE = 0.15;
const TYPICAL_TOP_SCORER_PPG = 19;

/**
 * A player with no playerSeasonStats row yet (new import, or — as of the
 * 2026-27 season transition — simply no games played yet this season, see
 * CLAUDE.md's "Season transition" notes) degrades to the flat rate, same
 * "missing data isn't a scoring dependency" philosophy as pointsForCorrectPick.
 */
export function pointsForCorrectTopScorerPick(pointsPerGame: number | null): number {
  if (pointsPerGame === null) return TOP_SCORER_POINTS_PER_CORRECT;
  const share = Math.max(MIN_SHARE, Math.min(1, pointsPerGame / TYPICAL_TOP_SCORER_PPG));
  const raw = TOP_SCORER_POINTS_PER_CORRECT / share;
  return Math.min(TOP_SCORER_POINTS_CAP, Math.max(TOP_SCORER_POINTS_PER_CORRECT, Math.round(raw)));
}

/**
 * Only knowable once the game is final — a live in-progress leader can
 * still change, so this deliberately does NOT resolve while status is
 * merely "live" even though a pick itself is allowed to be made/changed
 * while live (see routes/topScorerPredictions.ts).
 *
 * Tie policy: if two or more players share the game's max points, this
 * returns null — no winner declared, mirroring computeWinnerTeamId's tie
 * behavior in services/points.ts exactly. Unlike a tied final score
 * ("shouldn't happen in basketball"), a shared game-high point total
 * between two players is a real, expected case — the caller/UI should
 * show this as "no clear top scorer", not treat a null result as a bug.
 */
export async function computeTopScorerPlayerId(gameId: string): Promise<string | null> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game || game.status !== "final") return null;

  const lines = await db
    .select({ playerId: playerGameStats.playerId, points: playerGameStats.points })
    .from(playerGameStats)
    .where(and(eq(playerGameStats.gameId, gameId), isNotNull(playerGameStats.points)));

  if (lines.length === 0) return null;

  const maxPoints = Math.max(...lines.map((l) => l.points!));
  const topScorers = lines.filter((l) => l.points === maxPoints);
  return topScorers.length === 1 ? topScorers[0].playerId : null;
}
