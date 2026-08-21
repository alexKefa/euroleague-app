import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { predictions, games, pointAdjustments } from "../db/schema.js";

export const POINTS_PER_CORRECT = 10;

/** Winner is only knowable once the game is final. */
export function computeWinnerTeamId(game: typeof games.$inferSelect): string | null {
  if (game.status !== "final" || game.homeScore === null || game.awayScore === null) return null;
  if (game.homeScore === game.awayScore) return null; // shouldn't happen in basketball, but don't crash if it does
  return game.homeScore > game.awayScore ? game.homeTeamId : game.awayTeamId;
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
  const [row] = await db.execute<{ correct: number; bonus: number }>(sql`
    select
      coalesce((
        select count(*) from ${predictions} p
        join ${games} g on p.game_id = g.id
        where p.user_id = ${userId}
          and g.status = 'final'
          and g.home_score is not null
          and g.away_score is not null
          and g.home_score <> g.away_score
          and p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
      ), 0)::int as correct,
      coalesce((select sum(points) from ${pointAdjustments} where user_id = ${userId}), 0)::int as bonus
  `);

  return row.correct * POINTS_PER_CORRECT + row.bonus;
}
