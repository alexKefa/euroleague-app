import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, predictions, roundRewards, legendaryMilestones, ownedPacks } from "../db/schema.js";

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

// An unopened pack awarded by a round/milestone reward — same concept as a
// wheel win (routes/spin.ts): it sits in ownedPacks until the user opens it
// themselves from the Packs page, rather than instantly handing over a
// specific card. `tier` is what the pack guarantees (legendary/rare), for
// the caller's banner copy — deliberately not `PACKS[packType].label`,
// which is wheel-flavored text ("Jump Ball — ...") that wouldn't make sense
// announced from a perfect-round or milestone banner.
export interface OwnedPackReward {
  id: string;
  packType: "wheelLegendary" | "wheelPro";
  tier: "legendary" | "rare";
}

function tierForRewardPackType(packType: "wheelLegendary" | "wheelPro"): "legendary" | "rare" {
  return packType === "wheelLegendary" ? "legendary" : "rare";
}

/**
 * Finds (season, round) pairs where every game in the round is final and the
 * user has at least GREAT_ROUND_THRESHOLD correct picks in it (an unpicked
 * game just doesn't count as correct, same as before — it doesn't require
 * having predicted literally every game) — then grants a card for each such
 * round not already rewarded: a legendary for a literally perfect round, a
 * rare for a "great" one (short of perfect).
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
export async function checkAndGrantRoundRewards(userId: string): Promise<OwnedPackReward[]> {
  // Single query, computing correctness directly in SQL rather than
  // pulling rows into Node to diff: a naive "complete round with no
  // round_rewards row yet" check (tried first) still matches every
  // historical round the user never even played — nothing ever grants for
  // those (0 correct), so they'd resurface as "pending" and get
  // reprocessed on *every single call, forever*, for every user, once
  // enough seasons/rounds pile up historically. Folding the >=
  // GREAT_ROUND_THRESHOLD check into the query's own HAVING clause means
  // Postgres only ever returns rounds that actually qualify — typically
  // zero — instead of every round-nobody-touched. Cuts this from 2+
  // sequential round trips (old: fetch every game ever + every past claim,
  // then in the qualifying case a 3rd query for this user's picks) down to
  // 1 in the common case, since correct_count/total_games are computed
  // here too — no separate games/picks fetch needed at all to decide
  // packType. Against a remote DB, round-trip count matters far more than
  // query complexity (see CLAUDE.md's note on this), and this runs on
  // nearly every Predictions/Store/Packs/Inventory page load.
  const qualifyingRounds = await db.execute<{ season: string; round: number; correct_count: number; total_games: number }>(sql`
    select g.season, g.round,
      count(*) filter (
        where g.status = 'final' and g.home_score is not null and g.away_score is not null and g.home_score <> g.away_score
          and pr.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
      )::int as correct_count,
      count(*)::int as total_games
    from games g
    left join predictions pr on pr.game_id = g.id and pr.user_id = ${userId}
    where g.round is not null
    group by g.season, g.round
    having bool_and(g.status = 'final')
      and count(*) filter (
        where g.status = 'final' and g.home_score is not null and g.away_score is not null and g.home_score <> g.away_score
          and pr.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
      ) >= ${GREAT_ROUND_THRESHOLD}
      and not exists (
        select 1 from round_rewards rr
        where rr.user_id = ${userId} and rr.season = g.season and rr.round = g.round
      )
  `);

  for (const { season, round, correct_count, total_games } of qualifyingRounds) {
    // Perfect (every game right) still grants a legendary pack, unchanged
    // in spirit. "Great" (short of perfect but at/above
    // GREAT_ROUND_THRESHOLD, already guaranteed by the query above) grants
    // a rare pack instead — a much more frequent, still purely
    // accuracy-gated reward (see LEGENDARY_MILESTONE_INTERVAL's comment
    // for why "predictions matter more" needed a lever besides points).
    // Both grant an *unopened pack* (wheelLegendary/wheelPro), not a
    // specific card directly — same concept as a wheel win (2026-08-26
    // pass), so every non-purchase reward channel behaves the same way: it
    // lands in "My Packs" for the user to open themselves, rather than
    // some channels instantly granting a card and others making you open
    // a pack.
    const packType: "wheelLegendary" | "wheelPro" = correct_count === total_games ? "wheelLegendary" : "wheelPro";

    const [claim] = await db
      .insert(roundRewards)
      .values({ userId, season, round, collectibleId: null })
      .onConflictDoNothing({ target: [roundRewards.userId, roundRewards.season, roundRewards.round] })
      .returning();
    if (!claim) continue; // a concurrent request already claimed this round

    const [pack] = await db.insert(ownedPacks).values({ userId, packType }).returning();
    await db.update(roundRewards).set({ ownedPackId: pack.id }).where(eq(roundRewards.id, claim.id));
  }

  const unseen = await db
    .select({ pack: ownedPacks })
    .from(roundRewards)
    .innerJoin(ownedPacks, eq(roundRewards.ownedPackId, ownedPacks.id))
    .where(and(eq(roundRewards.userId, userId), isNull(roundRewards.seenAt)));

  return unseen.map(({ pack }) => ({
    id: pack.id,
    packType: pack.packType as "wheelLegendary" | "wheelPro",
    tier: tierForRewardPackType(pack.packType as "wheelLegendary" | "wheelPro"),
  }));
}

/** Marks every currently-unseen round reward this user has as seen — called once the "Perfect round!"/"Great round!" banner has actually been shown. */
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
export async function checkAndGrantLegendaryMilestones(userId: string): Promise<OwnedPackReward[]> {
  // One round trip for both numbers (scalar subqueries), not two sequential
  // queries — same lever as getUserPoints (services/points.ts) and
  // checkAndGrantRoundRewards above: against a remote DB, round-trip count
  // is what's expensive, not query complexity.
  const [{ correct, claimed_count }] = await db.execute<{ correct: number; claimed_count: number }>(sql`
    select
      (
        select count(*)::int
        from ${predictions} p
        join ${games} g on p.game_id = g.id
        where p.user_id = ${userId}
          and g.status = 'final'
          and g.home_score is not null
          and g.away_score is not null
          and g.home_score <> g.away_score
          and p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
      ) as correct,
      (select count(*)::int from ${legendaryMilestones} where user_id = ${userId}) as claimed_count
  `);
  const eligibleMilestones = Math.floor(correct / LEGENDARY_MILESTONE_INTERVAL);

  if (eligibleMilestones > claimed_count) {
    for (let milestoneNumber = claimed_count + 1; milestoneNumber <= eligibleMilestones; milestoneNumber++) {
      const [claim] = await db
        .insert(legendaryMilestones)
        .values({ userId, milestoneNumber, collectibleId: null })
        .onConflictDoNothing({ target: [legendaryMilestones.userId, legendaryMilestones.milestoneNumber] })
        .returning();
      if (!claim) continue; // a concurrent request already claimed this one

      // Same "unopened pack, not a direct card" concept as
      // checkAndGrantRoundRewards — see that function's comment.
      const [pack] = await db.insert(ownedPacks).values({ userId, packType: "wheelLegendary" }).returning();
      await db.update(legendaryMilestones).set({ ownedPackId: pack.id }).where(eq(legendaryMilestones.id, claim.id));
    }
  }

  const unseen = await db
    .select({ pack: ownedPacks })
    .from(legendaryMilestones)
    .innerJoin(ownedPacks, eq(legendaryMilestones.ownedPackId, ownedPacks.id))
    .where(and(eq(legendaryMilestones.userId, userId), isNull(legendaryMilestones.seenAt)));

  return unseen.map(({ pack }) => ({
    id: pack.id,
    packType: "wheelLegendary" as const,
    tier: "legendary" as const,
  }));
}

/** Marks every currently-unseen legendary milestone this user has as seen — called once its banner has actually been shown. */
export async function markLegendaryMilestonesSeen(userId: string): Promise<void> {
  await db
    .update(legendaryMilestones)
    .set({ seenAt: new Date() })
    .where(and(eq(legendaryMilestones.userId, userId), isNull(legendaryMilestones.seenAt)));
}
