import { sql } from "drizzle-orm";
import { games, quarterPredictions } from "../db/schema.js";
import { getLiveFeedAgeMs } from "../sync/liveGamesSync.js";
import { getSimulatedGameId } from "../realtime/liveScoreSimulator.js";

/**
 * Live quarter picks (2026-10-01, TODO.md #3): pick who wins the next
 * quarter of a game.
 *
 * - Only the next quarter is open: before tipoff Q1, during Q1 Q2, ... A
 *   quarter locks the moment it starts. No overtime picks.
 * - Correct = QUARTER_PICK_POINTS, wrong = 0, a tied quarter = 0 (push).
 * - Spendable only, never on the leaderboard: summed in getUserPoints
 *   (services/points.ts) via quarterPickPointsSql, nowhere in leaderboard.ts.
 * - The feed runs ~20-40s behind TV, so the first seconds of a quarter can
 *   leak (accepted for v1). Picks pause whenever a live game's feed is more
 *   than FEED_STALE_MS old, so a stalled feed can't keep a quarter open.
 */
export const QUARTER_PICK_POINTS = 5;
export const FEED_STALE_MS = 60_000;

type GameRow = typeof games.$inferSelect;

export type QuarterLockReason = "final" | "lastQuarter" | "stale" | null;

export interface OpenQuarterState {
  openQuarter: number | null;
  // Why nothing is open, when nothing is.
  reason: QuarterLockReason;
}

export function openQuarterFor(game: GameRow, now = Date.now()): OpenQuarterState {
  if (game.status === "final") return { openQuarter: null, reason: "final" };
  if (game.status === "scheduled") {
    // Q1 is open until the scheduled tipoff; a late start just closes it early.
    return new Date(game.tipoffAt).getTime() > now ? { openQuarter: 1, reason: null } : { openQuarter: null, reason: "stale" };
  }
  // Live.
  const current = game.quarter ?? 1;
  if (current >= 4) return { openQuarter: null, reason: "lastQuarter" };
  const fresh = game.id === getSimulatedGameId() || (getLiveFeedAgeMs(game.id) ?? Infinity) <= FEED_STALE_MS;
  if (!fresh) return { openQuarter: null, reason: "stale" };
  return { openQuarter: current + 1, reason: null };
}

export type QuarterPickResult = "won" | "lost" | "push" | null;

/** A pick's result, once its quarter is over (null while it's still to play / in play). */
export function quarterPickResult(game: GameRow, quarter: number, pickedTeamId: string): QuarterPickResult {
  const complete = game.status === "final" || (game.status === "live" && (game.quarter ?? 0) > quarter);
  const home = game.homeScoreByQuarter?.[quarter - 1];
  const away = game.awayScoreByQuarter?.[quarter - 1];
  if (!complete || home === undefined || away === undefined) return null;
  if (home === away) return "push";
  const winner = home > away ? game.homeTeamId : game.awayTeamId;
  return winner === pickedTeamId ? "won" : "lost";
}

/**
 * SQL scalar: a user's quarter-pick points, same rule as quarterPickResult —
 * a quarter counts once the game is final, or live and past that quarter.
 * One subquery so getUserPoints stays a single statement.
 */
export function quarterPickPointsSql(userId: string) {
  return sql`coalesce((
    select count(*) * ${QUARTER_PICK_POINTS}
    from ${quarterPredictions} qp
    join ${games} g on g.id = qp.game_id
    where qp.user_id = ${userId}
      and (g.status = 'final' or (g.status = 'live' and coalesce(g.quarter, 0) > qp.quarter))
      and jsonb_array_length(coalesce(g.home_score_by_quarter, '[]'::jsonb)) >= qp.quarter
      and jsonb_array_length(coalesce(g.away_score_by_quarter, '[]'::jsonb)) >= qp.quarter
      and (g.home_score_by_quarter ->> (qp.quarter - 1))::int <> (g.away_score_by_quarter ->> (qp.quarter - 1))::int
      and qp.picked_team_id = case
        when (g.home_score_by_quarter ->> (qp.quarter - 1))::int > (g.away_score_by_quarter ->> (qp.quarter - 1))::int
        then g.home_team_id else g.away_team_id end
  ), 0)`;
}
