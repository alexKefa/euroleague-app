import { eq, and, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, userCollectibles, teams, games, predictions, roundRewards, legendaryMilestones } from "../db/schema.js";
import { computeWinnerTeamId } from "./points.js";

// A round with this many correct picks (out of GAMES_PER_ROUND, but short of
// literally perfect) grants a bonus rare — see the branch in
// checkAndGrantRoundRewards below.
const GREAT_ROUND_THRESHOLD = 8;

// Every this-many cumulative correct predictions (career-wide, not
// per-round) grants a guaranteed-new legendary — see
// checkAndGrantLegendaryMilestones. Picked via scripts/season-simulation.ts:
// at a realistic (85%, i.e. misses ~1 day in 7) daily wheel engagement rate,
// legendary was the tightest bottleneck on finishing the album regardless of
// prediction accuracy (commons/rares already finish reliably from the wheel
// alone) — 60 pushes full-album completion from ~78% up to ~91-99% across
// the 50-80% accuracy range, while still scaling meaningfully with accuracy
// (a 70%-accuracy predictor earns roughly 4x as many milestones over a
// season as a 50%-accuracy one), unlike raw points-per-correct scaling
// (tested up to 2.5x with barely any effect — the wheel's sheer daily
// volume dwarfs anything points can buy by ~30-40x, so a linear points bump
// alone can't make prediction skill matter more without inflating the point
// scale into something disproportionate to the rest of the economy).
export const LEGENDARY_MILESTONE_INTERVAL = 60;

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
 * Finds (season, round) pairs where every game in the round is final and the
 * user predicted every one of them — then grants a card for each such round
 * not already rewarded: a legendary for a literally perfect round, a rare
 * for a "great" one (>= GREAT_ROUND_THRESHOLD correct but short of perfect).
 * Round numbers reset every season (e.g. "round 1" exists in both 2025-26
 * and 2026-27), so completeness and idempotency are both scoped by season,
 * not round alone. The round_rewards unique index (userId, season, round) is
 * used as a claim/mutex via onConflictDoNothing so two concurrent calls
 * (e.g. dashboard + predictions page loading at once) can't double-grant the
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

        const correctCount = roundGames.reduce((count, g) => {
          const pick = pickByGame.get(g.id);
          if (!pick) return count;
          const winnerTeamId = computeWinnerTeamId(g);
          return winnerTeamId !== null && winnerTeamId === pick.predictedWinnerTeamId ? count + 1 : count;
        }, 0);

        // Perfect (every game right) still grants a legendary, unchanged.
        // "Great" (short of perfect but at/above GREAT_ROUND_THRESHOLD)
        // grants a rare instead — a much more frequent, still purely
        // accuracy-gated reward (see LEGENDARY_MILESTONE_INTERVAL's comment
        // for why "predictions matter more" needed a lever besides points).
        // Anything below that threshold earns nothing and isn't claimed
        // here, same as before this pass.
        let tier: "legendary" | "rare" | null = null;
        if (correctCount === roundGames.length) tier = "legendary";
        else if (correctCount >= GREAT_ROUND_THRESHOLD) tier = "rare";
        if (tier === null) continue;

        const [claim] = await db
          .insert(roundRewards)
          .values({ userId, season, round, collectibleId: null })
          .onConflictDoNothing({ target: [roundRewards.userId, roundRewards.season, roundRewards.round] })
          .returning();
        if (!claim) continue; // a concurrent request already claimed this round

        const prize = await pickRandomUnownedByTier(userId, tier);
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

/**
 * Grants a guaranteed-new legendary for every LEGENDARY_MILESTONE_INTERVAL
 * cumulative correct predictions a user has ever made — a career counter,
 * not scoped to a round or season. milestoneNumber (1st, 2nd, ...) is the
 * claim key: legendary_milestones' unique (userId, milestoneNumber) index is
 * used as a mutex via onConflictDoNothing exactly like roundRewards, so two
 * concurrent calls can't double-grant the same milestone, and looping "try
 * to claim the next milestone number, stop once a claim fails" naturally
 * catches a user up if they cross more than one milestone between calls
 * (e.g. after not opening the app for a while) without over- or
 * under-granting.
 *
 * Same "return every unseen grant, not just this call's" shape as
 * checkAndGrantRoundRewards, for the same reason — see that function's doc
 * comment.
 */
export async function checkAndGrantLegendaryMilestones(userId: string): Promise<CollectibleWithTeam[]> {
  const [correctRow] = await db.execute<{ correct: number }>(sql`
    select count(*)::int as correct
    from ${predictions} p
    join ${games} g on p.game_id = g.id
    where p.user_id = ${userId}
      and g.status = 'final'
      and g.home_score is not null
      and g.away_score is not null
      and g.home_score <> g.away_score
      and p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
  `);
  const eligibleMilestones = Math.floor((correctRow?.correct ?? 0) / LEGENDARY_MILESTONE_INTERVAL);

  if (eligibleMilestones > 0) {
    const [{ claimedCount }] = await db
      .select({ claimedCount: sql<number>`count(*)::int` })
      .from(legendaryMilestones)
      .where(eq(legendaryMilestones.userId, userId));

    for (let milestoneNumber = claimedCount + 1; milestoneNumber <= eligibleMilestones; milestoneNumber++) {
      const [claim] = await db
        .insert(legendaryMilestones)
        .values({ userId, milestoneNumber, collectibleId: null })
        .onConflictDoNothing({ target: [legendaryMilestones.userId, legendaryMilestones.milestoneNumber] })
        .returning();
      if (!claim) continue; // a concurrent request already claimed this one

      const prize = await pickRandomUnownedLegendary(userId);
      if (prize) {
        await db.insert(userCollectibles).values({ userId, collectibleId: prize.id });
        await db.update(legendaryMilestones).set({ collectibleId: prize.id }).where(eq(legendaryMilestones.id, claim.id));
      }
    }
  }

  const unseen = await db
    .select({ collectible: collectibles, team: teams })
    .from(legendaryMilestones)
    .innerJoin(collectibles, eq(legendaryMilestones.collectibleId, collectibles.id))
    .innerJoin(teams, eq(collectibles.teamId, teams.id))
    .where(and(eq(legendaryMilestones.userId, userId), isNull(legendaryMilestones.seenAt)));

  return unseen.map(({ collectible, team }) => ({
    id: collectible.id,
    name: collectible.name,
    tier: collectible.tier,
    pointsCost: collectible.pointsCost,
    imageUrl: collectible.imageUrl,
    team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor },
  }));
}

/** Marks every currently-unseen legendary milestone this user has as seen — called once its banner has actually been shown. */
export async function markLegendaryMilestonesSeen(userId: string): Promise<void> {
  await db
    .update(legendaryMilestones)
    .set({ seenAt: new Date() })
    .where(and(eq(legendaryMilestones.userId, userId), isNull(legendaryMilestones.seenAt)));
}
