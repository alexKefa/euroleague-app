import { eq, and, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, userCollectibles, teams, games, predictions, roundRewards } from "../db/schema.js";
import { computeWinnerTeamId } from "./points.js";

// Matches the shape GET /collectibles returns — the frontend's Collectible
// model expects a joined `team` object, not just teamId, and both spin
// routes hand this straight back as the win payload.
export interface CollectibleWithTeam {
  id: string;
  name: string;
  tier: string;
  pointsCost: number;
  imageUrl: string | null;
  team: { id: string; code: string; name: string; primaryColor: string | null };
}

/** A random collectible of the given tier the user doesn't already own, or null if they own them all. */
export async function pickRandomUnownedByTier(
  userId: string,
  tier: "common" | "rare" | "legendary"
): Promise<CollectibleWithTeam | null> {
  const [owned, ofTier] = await Promise.all([
    db
      .select({ collectibleId: userCollectibles.collectibleId })
      .from(userCollectibles)
      .where(eq(userCollectibles.userId, userId)),
    db
      .select({ collectible: collectibles, team: teams })
      .from(collectibles)
      .innerJoin(teams, eq(collectibles.teamId, teams.id))
      .where(eq(collectibles.tier, tier)),
  ]);

  const ownedIds = new Set(owned.map((o) => o.collectibleId));
  const candidates = ofTier.filter(({ collectible }) => !ownedIds.has(collectible.id));
  if (candidates.length === 0) return null;

  const { collectible, team } = candidates[Math.floor(Math.random() * candidates.length)];
  return {
    id: collectible.id,
    name: collectible.name,
    tier: collectible.tier,
    pointsCost: collectible.pointsCost,
    imageUrl: collectible.imageUrl,
    team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor },
  };
}

/** A random legendary collectible the user doesn't already own, or null if they own them all. */
export async function pickRandomUnownedLegendary(userId: string): Promise<CollectibleWithTeam | null> {
  return pickRandomUnownedByTier(userId, "legendary");
}

/**
 * Finds (season, round) pairs where every game is final, the user predicted
 * every one of them, and every prediction was correct — then grants a
 * legendary card for each such round not already rewarded. Round numbers
 * reset every season (e.g. "round 1" exists in both 2025-26 and 2026-27),
 * so completeness and idempotency are both scoped by season, not round
 * alone. The round_rewards unique index (userId, season, round) is used as
 * a claim/mutex via onConflictDoNothing so two concurrent calls (e.g.
 * dashboard + predictions page loading at once) can't double-grant the
 * same round.
 *
 * Returns every reward this user has that's granted but not yet seen —
 * not just ones granted by *this* call. Several unrelated pages
 * (inventory/store/packs) call the endpoint this feeds purely to read
 * `points`; if this returned only same-call grants, whichever of those
 * pages happened to load first would silently consume the one-shot
 * notification before the user ever saw the "Perfect round!" banner on
 * Predictions — which is exactly what happened the first time this was
 * tested. The caller marks rewards seen (markRoundRewardsSeen) once
 * they've actually been displayed.
 */
export async function checkAndGrantRoundRewards(userId: string): Promise<CollectibleWithTeam[]> {
  // `already` doesn't actually depend on `allGames`/`completeRounds` — only
  // on userId — so fetch both up front instead of gating it behind the
  // completeRounds check below, which just added a needless sequential
  // round trip in the (near-universal, once any season exists) case where
  // completeRounds is non-empty anyway.
  const [allGames, already] = await Promise.all([
    db.select().from(games).where(isNotNull(games.round)),
    db.select({ season: roundRewards.season, round: roundRewards.round }).from(roundRewards).where(eq(roundRewards.userId, userId)),
  ]);

  const bySeasonRound = new Map<string, (typeof allGames)[number][]>();
  for (const g of allGames) {
    const key = `${g.season} ${g.round}`;
    const arr = bySeasonRound.get(key) ?? [];
    arr.push(g);
    bySeasonRound.set(key, arr);
  }

  const completeRounds = [...bySeasonRound.entries()].filter(([, gs]) => gs.every((g) => g.status === "final"));

  if (completeRounds.length > 0) {
    const alreadyRounds = new Set(already.map((r) => `${r.season} ${r.round}`));

    const pendingRounds = completeRounds.filter(([key]) => !alreadyRounds.has(key));

    if (pendingRounds.length > 0) {
      // One query for this user's picks across every pending round's games,
      // instead of one query per round — the old per-round loop re-queried
      // predictions on every iteration, so a request could fire dozens of
      // sequential round-trips (one per completed round in the league so
      // far) purely to find nothing to grant.
      const allPendingGameIds = pendingRounds.flatMap(([, gs]) => gs.map((g) => g.id));
      const userPicks = await db
        .select()
        .from(predictions)
        .where(and(eq(predictions.userId, userId), inArray(predictions.gameId, allPendingGameIds)));
      const pickByGame = new Map(userPicks.map((p) => [p.gameId, p]));

      for (const [, roundGames] of pendingRounds) {
        const season = roundGames[0].season;
        const round = roundGames[0].round!;

        const perfect = roundGames.every((g) => {
          const pick = pickByGame.get(g.id);
          if (!pick) return false;
          const winnerTeamId = computeWinnerTeamId(g);
          return winnerTeamId !== null && winnerTeamId === pick.predictedWinnerTeamId;
        });
        if (!perfect) continue;

        const [claim] = await db
          .insert(roundRewards)
          .values({ userId, season, round, collectibleId: null })
          .onConflictDoNothing({ target: [roundRewards.userId, roundRewards.season, roundRewards.round] })
          .returning();
        if (!claim) continue; // a concurrent request already claimed this round

        const prize = await pickRandomUnownedLegendary(userId);
        if (prize) {
          await db.insert(userCollectibles).values({ userId, collectibleId: prize.id });
          await db.update(roundRewards).set({ collectibleId: prize.id }).where(eq(roundRewards.id, claim.id));
        }
      }
    }
  }

  const unseen = await db
    .select({ collectible: collectibles, team: teams })
    .from(roundRewards)
    .innerJoin(collectibles, eq(roundRewards.collectibleId, collectibles.id))
    .innerJoin(teams, eq(collectibles.teamId, teams.id))
    .where(and(eq(roundRewards.userId, userId), isNull(roundRewards.seenAt)));

  return unseen.map(({ collectible, team }) => ({
    id: collectible.id,
    name: collectible.name,
    tier: collectible.tier,
    pointsCost: collectible.pointsCost,
    imageUrl: collectible.imageUrl,
    team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor },
  }));
}

/** Marks every currently-unseen round reward this user has as seen — called once the "Perfect round!" banner has actually been shown. */
export async function markRoundRewardsSeen(userId: string): Promise<void> {
  await db
    .update(roundRewards)
    .set({ seenAt: new Date() })
    .where(and(eq(roundRewards.userId, userId), isNull(roundRewards.seenAt)));
}
