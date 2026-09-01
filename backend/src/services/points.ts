import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { predictions, games, gameOdds, pointAdjustments } from "../db/schema.js";

export const POINTS_PER_CORRECT = 10;

/** Winner is only knowable once the game is final. */
export function computeWinnerTeamId(game: typeof games.$inferSelect): string | null {
  if (game.status !== "final" || game.homeScore === null || game.awayScore === null) return null;
  if (game.homeScore === game.awayScore) return null; // shouldn't happen in basketball, but don't crash if it does
  return game.homeScore > game.awayScore ? game.homeTeamId : game.awayTeamId;
}

// Odds-weighted scoring (2026-08-31 floor-not-penalty redesign; 2026-09-01
// replaced entirely with a single direct-odds-multiple formula — see
// below). Every correct pick is worth POINTS_PER_CORRECT times the picked
// team's own fair odds (1/fairProb) — "pay roughly what the market itself
// would," not a curve built around an arbitrary boost constant. There's no
// favorite/underdog branch at all: a heavy favorite's fair odds sit close
// to 1.0 so it scores close to the flat rate, a real underdog's fair odds
// are much higher so it scores much more, and one formula covers both
// continuously with no jump anywhere in between.
//
// This intentionally replaces the previous "floor favorites at exactly the
// flat rate" design from the same week: that was built to fix a symmetric
// curve that scaled favorites *down*, and flooring was the fix for that
// specific problem. Once the underdog side became a direct odds multiple
// (tried first as `fairOdds / 2`, still anchored to flat-10-for-favorites),
// real numbers made clear that halving compressed real underdogs too much
// (a ~39%-implied pick was only netting ~13, not the ~25 a direct multiply
// gives) — and keeping favorites pinned at flat 10 while steepening the
// underdog side to match would require a hard jump right at the coin-flip
// line (a 51% favorite scoring 10 while a 49% underdog on the same game
// scores 20), a real cliff that rewards picking whichever side is marked
// ever-so-slightly the underdog. Dropping the favorite floor entirely
// avoids that cliff, at the cost of favorites no longer being exactly flat
// — a correct pick on a 55% favorite now scores ~18, not 10. Since most
// correct picks land on favorites, this raises the *average* payout per
// correct pick more than the old underdog-only bonus did —
// season-simulation.ts doesn't model any odds bonus yet (only flat
// POINTS_PER_CORRECT), so there's no simulated number confirming this
// against pack-cost/badge-threshold pacing; re-run it (after teaching it to
// model this) if real-world points start completing the album noticeably
// faster than the documented ~140-155 median day. ODDS_POINTS_CAP keeps a
// real long-shot from scaling unbounded (uncapped, a 5%-implied underdog
// would net 200pts).
const ODDS_POINTS_CAP = 40;
const MIN_FAIR_PROB = 0.05;

/**
 * Points for a single correct pick. `fairProb` is the picked team's
 * de-vigged implied win probability from game_odds (see schema.ts) —
 * null when no odds snapshot exists for that game (API down, quota
 * exhausted, game outside the sync window, or the feature not configured
 * at all via ODDS_API_KEY), in which case this degrades to the original
 * flat rate rather than blocking scoring on external data availability.
 */
export function pointsForCorrectPick(fairProb: number | null): number {
  if (fairProb === null) return POINTS_PER_CORRECT;
  const p = Math.max(MIN_FAIR_PROB, Math.min(1, fairProb));
  const raw = POINTS_PER_CORRECT / p; // POINTS_PER_CORRECT * fairOdds
  return Math.min(ODDS_POINTS_CAP, Math.max(POINTS_PER_CORRECT, Math.round(raw)));
}

// Same formula, inlined as a raw-SQL expression for the aggregate queries
// in getUserPoints() below and services/leaderboard.ts's
// getLeaderboardEntries() — those score potentially hundreds of picks at
// once via a single grouped query rather than pulling every row into JS
// (see this file's/leaderboard.ts's existing "fewer round trips" reasoning),
// so the formula has to live in SQL there too. `pickedFairProb` is a raw
// SQL fragment resolving to the *picked* team's home/away fair prob (or
// NULL if no game_odds row) for that specific prediction row — see the two
// call sites for how it's built from a join.
//
// Every bare numeric literal here is explicitly ::float8-cast — without at
// least one typed operand nearby, Postgres can't resolve two "unknown"-
// typed parameters multiplied/added together on their own ("operator is
// not unique: unknown * unknown"), which bit the very first version of
// this function. The whole expression is cast to ::numeric before round()
// (not left as float8) — Postgres's single-argument round(double
// precision) rounds half-to-even (and is exposed to float rounding noise
// right at a x.5 boundary), which silently disagreed with JS's
// Math.round's round-half-up at an exact clamp boundary until this was
// caught by testing both paths against the same input.
export function pointsSqlExpr(pickedFairProb: ReturnType<typeof sql>) {
  // No game_odds row (coalesce to 1) degrades to the flat rate exactly like
  // pointsForCorrectPick's `fairProb === null` branch does — POINTS_PER_CORRECT
  // / 1 = POINTS_PER_CORRECT. Clamped to [MIN_FAIR_PROB, 1] otherwise.
  const clampedP = sql`least(1::float8, greatest(${MIN_FAIR_PROB}::float8, coalesce(${pickedFairProb}, 1::float8)))`;
  const raw = sql`${POINTS_PER_CORRECT}::float8 / (${clampedP})`;
  return sql<number>`least(${ODDS_POINTS_CAP}, greatest(${POINTS_PER_CORRECT}, round((${raw})::numeric)))::int`;
}

/**
 * A user's current spendable points: resolved correct picks plus any
 * manual adjustments (grants from an admin, or negative rows recorded when
 * redeeming a store item). Recomputed on every call — see predictions.ts
 * for why points aren't stored as a balance.
 *
 * One round trip instead of two independent queries — each round trip to
 * this (remote) DB costs real, mostly-fixed latency regardless of whether
 * queries are awaited sequentially or fired via Promise.all (measured
 * directly: 4 queries via Promise.all took as long as 4 sequential ones —
 * this driver/pool doesn't give genuine concurrency across separate
 * `db.select()` calls), so the only real lever is fewer statements, not
 * reordering them. The correct-pick condition here mirrors
 * computeWinnerTeamId() exactly (final, both scores present, no tie) — keep
 * the two in sync if that logic ever changes.
 */
export async function getUserPoints(userId: string): Promise<number> {
  const pickedFairProb = sql`case when p.predicted_winner_team_id = g.home_team_id then go.home_fair_prob else go.away_fair_prob end`;

  const [row] = await db.execute<{ correct_points: number; bonus: number }>(sql`
    select
      coalesce((
        select sum(${pointsSqlExpr(pickedFairProb)}) from ${predictions} p
        join ${games} g on p.game_id = g.id
        left join ${gameOdds} go on go.game_id = g.id
        where p.user_id = ${userId}
          and g.status = 'final'
          and g.home_score is not null
          and g.away_score is not null
          and g.home_score <> g.away_score
          and p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
      ), 0)::int as correct_points,
      coalesce((select sum(points) from ${pointAdjustments} where user_id = ${userId}), 0)::int as bonus
  `);

  return row.correct_points + row.bonus;
}
