import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, playerGameStats, topScorerPredictions } from "../db/schema.js";

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
 * Locks at the start of the 4th quarter (2026-09-08), not at `final` like
 * the rest of this file's comments originally described — a pick left open
 * all the way to the final buzzer degenerates into just reading the box
 * score once the game is basically decided, which defeats the internal-
 * proxy formula's whole point of rewarding a real long-shot call. Locking
 * at tipoff (like win/loss Predictions) was rejected too: this is
 * specifically a *live* prop, so three full quarters of picking/repicking
 * while the game is in progress is the feature, not a bug — Q4 is the
 * latest point that still leaves genuine uncertainty. `quarter` is
 * nullable and only meaningful while `status === "live"`; a `final` game
 * is always locked regardless of `quarter`.
 */
export function isTopScorerPickLocked(game: typeof games.$inferSelect): boolean {
  if (game.status === "final") return true;
  return game.status === "live" && game.quarter !== null && game.quarter >= 4;
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

// --- Wiring correct picks into the shared points economy (2026-09-09) ---
//
// Explicit decision: top-scorer points feed the *same* total as win/loss
// Predictions (getUserPoints, the leaderboard, the "Century" badge) rather
// than a separate track — this CTE is the one place the "which player was
// this game's top scorer, with computeTopScorerPlayerId's exact tie-null
// rule" logic lives as SQL, shared by services/points.ts's getUserPoints
// (single user) and services/leaderboard.ts's getLeaderboardEntries (every
// user at once via one grouped query, same "fewer round trips" reasoning
// as everywhere else in this app's economy) rather than duplicated in both.
// `points_at_pick` is summed as stored (see schema.ts's doc comment on that
// column) — a null (a pick made before this column existed; none exist in
// production as of this pass) falls back to the flat
// TOP_SCORER_POINTS_PER_CORRECT rate, same "missing data isn't a scoring
// dependency" convention as game_odds/pointsForCorrectPick.
export function topScorerTotalsCte() {
  return sql`
    per_game_max as (
      select game_id, max(points) as max_points
      from ${playerGameStats}
      where points is not null
      group by game_id
    ),
    per_game_leader as (
      -- array_agg, not max()/min() — Postgres has no default max/min
      -- aggregate for uuid (confirmed live: "function max(uuid) does not
      -- exist"), unlike every other id type this app's SQL usually groups
      -- by. Safe to index [1] only because the surrounding case already
      -- guarantees exactly one row when count(*) = 1.
      select pgm.game_id,
        case when count(*) = 1 then (array_agg(pgs.player_id))[1] else null end as top_scorer_player_id
      from per_game_max pgm
      join ${playerGameStats} pgs on pgs.game_id = pgm.game_id and pgs.points = pgm.max_points
      group by pgm.game_id
    ),
    top_scorer_totals as (
      select tsp.user_id,
        coalesce(sum(coalesce(tsp.points_at_pick, ${TOP_SCORER_POINTS_PER_CORRECT})), 0)::int as points
      from ${topScorerPredictions} tsp
      join ${games} g on g.id = tsp.game_id
      join per_game_leader pgl on pgl.game_id = tsp.game_id
      where g.status = 'final' and pgl.top_scorer_player_id = tsp.predicted_player_id
      group by tsp.user_id
    )
  `;
}

/** Single-user read of topScorerTotalsCte() — see getUserPoints/predictions.ts's /me/summary. */
export async function getUserTopScorerPoints(userId: string): Promise<number> {
  const [row] = await db.execute<{ points: number }>(sql`
    with ${topScorerTotalsCte()}
    select coalesce((select points from top_scorer_totals where user_id = ${userId}), 0)::int as points
  `);
  return row.points;
}
