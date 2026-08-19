import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, userCollectibles, games, predictions, roundRewards } from "../db/schema.js";
import { computeWinnerTeamId } from "./points.js";

type Collectible = typeof collectibles.$inferSelect;

/** A random legendary collectible the user doesn't already own, or null if they own them all. */
export async function pickRandomUnownedLegendary(userId: string): Promise<Collectible | null> {
  const [owned, legendaries] = await Promise.all([
    db
      .select({ collectibleId: userCollectibles.collectibleId })
      .from(userCollectibles)
      .where(eq(userCollectibles.userId, userId)),
    db.select().from(collectibles).where(eq(collectibles.tier, "legendary")),
  ]);

  const ownedIds = new Set(owned.map((o) => o.collectibleId));
  const candidates = legendaries.filter((c) => !ownedIds.has(c.id));
  if (candidates.length === 0) return null;

  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Finds rounds where every game is final, the user predicted every one of
 * them, and every prediction was correct — then grants a legendary card for
 * each such round not already rewarded. The round_rewards unique index
 * (userId, round) is used as a claim/mutex via onConflictDoNothing so two
 * concurrent calls (e.g. dashboard + predictions page loading at once)
 * can't double-grant the same round.
 */
export async function checkAndGrantRoundRewards(userId: string): Promise<Collectible[]> {
  const allGames = await db.select().from(games).where(isNotNull(games.round));

  const byRound = new Map<number, (typeof allGames)[number][]>();
  for (const g of allGames) {
    const arr = byRound.get(g.round!) ?? [];
    arr.push(g);
    byRound.set(g.round!, arr);
  }

  const completeRounds = [...byRound.entries()].filter(([, gs]) => gs.every((g) => g.status === "final"));
  if (completeRounds.length === 0) return [];

  const already = await db
    .select({ round: roundRewards.round })
    .from(roundRewards)
    .where(eq(roundRewards.userId, userId));
  const alreadyRounds = new Set(already.map((r) => r.round));

  const granted: Collectible[] = [];

  for (const [round, roundGames] of completeRounds) {
    if (alreadyRounds.has(round)) continue;

    const gameIds = roundGames.map((g) => g.id);
    const userPicks = await db
      .select()
      .from(predictions)
      .where(and(eq(predictions.userId, userId), inArray(predictions.gameId, gameIds)));
    const pickByGame = new Map(userPicks.map((p) => [p.gameId, p]));

    const perfect = roundGames.every((g) => {
      const pick = pickByGame.get(g.id);
      if (!pick) return false;
      const winnerTeamId = computeWinnerTeamId(g);
      return winnerTeamId !== null && winnerTeamId === pick.predictedWinnerTeamId;
    });
    if (!perfect) continue;

    const [claim] = await db
      .insert(roundRewards)
      .values({ userId, round, collectibleId: null })
      .onConflictDoNothing({ target: [roundRewards.userId, roundRewards.round] })
      .returning();
    if (!claim) continue; // a concurrent request already claimed this round

    const prize = await pickRandomUnownedLegendary(userId);
    if (prize) {
      await db.insert(userCollectibles).values({ userId, collectibleId: prize.id });
      await db.update(roundRewards).set({ collectibleId: prize.id }).where(eq(roundRewards.id, claim.id));
      granted.push(prize);
    }
  }

  return granted;
}
