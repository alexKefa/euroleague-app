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

// Odds-weighted scoring (2026-08-31, floor-not-penalty redesign same day).
// A correctly-picked underdog pays a bonus on top of the original flat
// rate — the less likely the market thought it was, the bigger the bonus —
// but a correctly-picked favorite is never worth *less* than the original
// flat POINTS_PER_CORRECT. This was a deliberate reversal of the first cut
// of this formula, which scaled the favorite side *down* toward ~1pt for
// a heavy favorite: real prediction behavior isn't symmetric the way that
// version assumed — people correctly pick favorites far more often than
// they correctly pick underdogs (that's what makes them favorites), so in
// practice most correct picks would've landed on the low end of that
// range, dragging the realistic average payout well below 10 rather than
// keeping it "roughly unchanged" as intended, and making the whole points
// economy (badges, pack costs) noticeably harder to earn into than before
// odds-weighting existed at all. Flooring the favorite side at the
// original flat rate fixes that directly: every correct pick is still
// worth at least what it always was, odds only ever add upside for a
// correctly-called upset. The underdog side is clamped at MIN_FAIR_PROB so
// a near-lock underdog doesn't blow past ~24pts on a rounding fluke in the
// odds data; the favorite side needs no equivalent clamp since it's just
// the flat rate regardless of how big a favorite it was.
const UNDERDOG_BOOST = 1.5;
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
  if (fairProb === null || fairProb > 0.5) return POINTS_PER_CORRECT;
  const p = Math.max(MIN_FAIR_PROB, Math.min(0.5, fairProb));
  const raw = POINTS_PER_CORRECT * (1 + (UNDERDOG_BOOST * (0.5 - p)) / 0.5);
  return Math.max(POINTS_PER_CORRECT, Math.round(raw));
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
// Math.round's round-half-up at the exact fairProb=0.05/0.95 clamp
// boundary (23 vs 24) until this was caught by testing both paths against
// the same input.
export function pointsSqlExpr(pickedFairProb: ReturnType<typeof sql>) {
  // Clamped to [MIN_FAIR_PROB, 0.5] — anything above 0.5 (a favorite pick)
  // never even reaches the bonus formula, it's just the flat rate.
  const clampedP = sql`least(0.5::float8, greatest(${MIN_FAIR_PROB}::float8, coalesce(${pickedFairProb}, 0.5::float8)))`;
  const underdogBranch = sql`${POINTS_PER_CORRECT}::float8 * (1::float8 + (${UNDERDOG_BOOST}::float8 * (0.5::float8 - (${clampedP}))) / 0.5::float8)`;
  return sql<number>`case when coalesce(${pickedFairProb}, 0.5::float8) > 0.5 then ${POINTS_PER_CORRECT}::int else greatest(${POINTS_PER_CORRECT}, round((${underdogBranch})::numeric))::int end`;
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
