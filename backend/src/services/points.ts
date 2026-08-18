import { eq, sql } from "drizzle-orm";
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
 */
export async function getUserPoints(userId: string): Promise<number> {
  const [rows, [{ bonus }]] = await Promise.all([
    db
      .select({ prediction: predictions, game: games })
      .from(predictions)
      .innerJoin(games, eq(predictions.gameId, games.id))
      .where(eq(predictions.userId, userId)),
    db
      .select({ bonus: sql<number>`coalesce(sum(${pointAdjustments.points}), 0)::int` })
      .from(pointAdjustments)
      .where(eq(pointAdjustments.userId, userId)),
  ]);

  let correct = 0;
  for (const { prediction, game } of rows) {
    const winnerTeamId = computeWinnerTeamId(game);
    if (winnerTeamId !== null && winnerTeamId === prediction.predictedWinnerTeamId) correct++;
  }

  return correct * POINTS_PER_CORRECT + bonus;
}
