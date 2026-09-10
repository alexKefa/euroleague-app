import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, playerGameStats, playerSeasonStats, topScorerPredictions } from "../db/schema.js";

// Points formula for the live "top scorer" prop pick — a sibling to
// services/points.ts, not merged into it, since that file's comments are
// specifically about the odds-weighted (game_odds) win/loss formula;
// mixing in a differently-sourced one here would make those misleading.
//
// This formula uses only this app's own data rather than The Odds API,
// whose EuroLeague player-prop coverage is unconfirmed (no ODDS_API_KEY
// configured to even test it as of this pass, 2026-09-10) — an internal
// proxy for "how big a long-shot was this pick", in the same spirit as
// services/points.ts's odds multiple but not the same math.
//
// Reworked 2026-09-10 to actually move *during* a live game, not just at
// pick time off a static season average — explicit ask: a player already
// sitting on a big scoring lead partway through the game is now an obvious
// call and should pay out less than picking them would have pre-tipoff;
// a player who hasn't gotten going yet (or a normally-low scorer who's
// suddenly hot) is a bigger claim about how the rest of the game plays out
// and should pay more. This does NOT make an already-placed pick's stored
// value float on its own — pointsAtPick is still captured once, at the
// exact moment a pick is made or changed, and never recomputed afterward
// (see schema.ts's doc comment on that column); what changes is that
// *re-picking* mid-game (already allowed anytime up to Q4, see
// isTopScorerPickLocked) now prices meaningfully differently than picking
// the same player pre-tipoff would have, instead of both landing on the
// same season-PPG-derived number.
//
// The mechanism: project each player's likely final point total as
// pointsSoFar + baselinePPG × (fraction of the game still remaining), then
// normalize that projection against TYPICAL_TOP_SCORER_PPG exactly like
// the old formula normalized a flat season PPG (the real max points-per-
// game seen across the 2023-24/2024-25/2025-26 seasons was 19-20.4 — 19
// picked as a realistic "what a real top scorer averages" reference, not
// an arbitrary guess). Pre-tipoff (remaining fraction = 1, no points
// scored yet) this reduces to exactly the old formula — a deliberate
// property, not a coincidence, so nothing changes for a pick made before a
// game starts.
export const TOP_SCORER_POINTS_PER_CORRECT = 10;
export const TOP_SCORER_POINTS_CAP = 40;
const MIN_SHARE = 0.15;
const TYPICAL_TOP_SCORER_PPG = 19;
// EuroLeague quarters are 10 real minutes each; overtime isn't modeled here
// (or by liveScoreSimulator.ts, which never ticks a game past quarter 4) —
// a pick this locked-at-Q4 formula would apply to during OT would just see
// remaining clamp to 0, same as a Q4 pick, which is the right degenerate
// answer anyway (isTopScorerPickLocked already forbids picking that late).
const QUARTER_SECONDS = 600;
const REGULATION_SECONDS = QUARTER_SECONDS * 4;

/**
 * 1 before tipoff (quarter null) down to 0 at the final horn — how much of
 * regulation is still ahead of a live game, from `games.quarter`/
 * `gameClockSeconds`. Missing/stale gameClockSeconds (no live feed yet
 * this tick) degrades to "start of the quarter", the conservative
 * (more-remaining) direction.
 */
function remainingGameFraction(quarter: number | null, gameClockSeconds: number | null): number {
  if (quarter === null) return 1;
  const clockLeftInQuarter = gameClockSeconds ?? QUARTER_SECONDS;
  const elapsed = (quarter - 1) * QUARTER_SECONDS + (QUARTER_SECONDS - clockLeftInQuarter);
  return Math.max(0, Math.min(1, 1 - elapsed / REGULATION_SECONDS));
}

/**
 * `baselinePPG` is this player's season PPG, or (see getTopScorerBaselinePPG)
 * their career PPG when the season has no games for them yet, or null when
 * neither exists — same "missing data isn't a scoring dependency" fallback
 * chain as before, just now feeding a projection instead of being used
 * directly. `pointsSoFar`/`quarter`/`gameClockSeconds` should all be null/0
 * for a pick made before tipoff, which collapses this to the pre-2026-09-10
 * formula exactly (see the file-level comment above).
 */
export function pointsForCorrectTopScorerPick(params: {
  baselinePPG: number | null;
  pointsSoFar: number;
  quarter: number | null;
  gameClockSeconds: number | null;
}): number {
  const effectiveBaselinePPG = params.baselinePPG ?? TYPICAL_TOP_SCORER_PPG;
  const remaining = remainingGameFraction(params.quarter, params.gameClockSeconds);
  const projectedFinal = params.pointsSoFar + effectiveBaselinePPG * remaining;

  const share = Math.max(MIN_SHARE, Math.min(1, projectedFinal / TYPICAL_TOP_SCORER_PPG));
  const raw = TOP_SCORER_POINTS_PER_CORRECT / share;
  return Math.min(TOP_SCORER_POINTS_CAP, Math.max(TOP_SCORER_POINTS_PER_CORRECT, Math.round(raw)));
}

/**
 * Season PPG for `season`, falling back to a games-played-weighted career
 * PPG across every synced season on file (same weighting as the collectible
 * card flip's "Career" stat line, routes/collectibles.ts) when this player
 * has no row for `season` yet — a call-up, incoming transfer, or simply a
 * season that hasn't started (see CLAUDE.md's "Season transition" notes).
 * One query, not two, for the same "fewer round trips" reason as everywhere
 * else in this app's economy.
 */
export async function getTopScorerBaselinePPG(playerId: string, season: string): Promise<number | null> {
  const [row] = await db.execute<{ season_ppg: number | null; career_ppg: number | null }>(sql`
    select
      (array_agg(points_per_game) filter (where season = ${season}))[1] as season_ppg,
      sum(points_per_game * games_played) / nullif(sum(games_played), 0) as career_ppg
    from ${playerSeasonStats}
    where player_id = ${playerId}
  `);
  return row?.season_ppg ?? row?.career_ppg ?? null;
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

/**
 * Batched sibling to computeTopScorerPlayerId, for a list of games at once
 * (routes/topScorerPredictions.ts's GET /me) instead of one query per game
 * — same "fewer round trips" reasoning as topScorerTotalsCte. Applies the
 * exact same rules per game: not final -> absent from the returned map
 * (caller should treat a missing key as "not yet resolvable", same as this
 * function's single-game sibling returning null for a non-final game); no
 * box-score rows yet -> absent as well; a tie -> present with value null.
 */
export async function computeTopScorerPlayerIdsForGames(gameIds: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (gameIds.length === 0) return result;

  const finalGames = await db
    .select({ id: games.id })
    .from(games)
    .where(and(inArray(games.id, gameIds), eq(games.status, "final")));
  const finalGameIds = finalGames.map((g) => g.id);
  if (finalGameIds.length === 0) return result;

  const lines = await db
    .select({ gameId: playerGameStats.gameId, playerId: playerGameStats.playerId, points: playerGameStats.points })
    .from(playerGameStats)
    .where(and(inArray(playerGameStats.gameId, finalGameIds), isNotNull(playerGameStats.points)));

  const byGame = new Map<string, { playerId: string; points: number }[]>();
  for (const l of lines) {
    const list = byGame.get(l.gameId) ?? [];
    list.push({ playerId: l.playerId, points: l.points! });
    byGame.set(l.gameId, list);
  }

  for (const [gameId, ls] of byGame) {
    const maxPoints = Math.max(...ls.map((l) => l.points));
    const topScorers = ls.filter((l) => l.points === maxPoints);
    result.set(gameId, topScorers.length === 1 ? topScorers[0].playerId : null);
  }
  return result;
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
