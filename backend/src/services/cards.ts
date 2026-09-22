import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  games,
  predictions,
  roundRewards,
  legendaryMilestones,
  coachMilestones,
  rareMilestones,
  fantasyMilestones,
  ownedPacks,
  topScorerPredictions,
  playerGameStats,
  fantasyRoundPoints,
  collectibles,
  userCollectibles,
  teams,
} from "../db/schema.js";

// A round with this many correct picks (out of GAMES_PER_ROUND, but short of
// literally perfect) grants a bonus rare — see the branch in
// checkAndGrantRoundRewards below.
const GREAT_ROUND_THRESHOLD = 8;

// Every this-many cumulative correct picks (career-wide, not per-round)
// grants a guaranteed-new legendary — see checkAndGrantLegendaryMilestones.
// Picked via scripts/season-simulation.ts: at a realistic (85%, i.e. misses
// ~1 day in 7) daily wheel engagement rate, legendary was the tightest
// bottleneck on finishing the album regardless of prediction accuracy
// (commons/rares already finish reliably from the wheel alone) — 60 pushes
// full-album completion from ~78% up to ~91-99% across the 50-80% accuracy
// range, while still scaling meaningfully with accuracy (a 70%-accuracy
// predictor earns roughly 4x as many milestones over a season as a
// 50%-accuracy one), unlike raw points-per-correct scaling (tested up to
// 2.5x with barely any effect — the wheel's sheer daily volume dwarfs
// anything points can buy by ~30-40x, so a linear points bump alone can't
// make prediction skill matter more without inflating the point scale into
// something disproportionate to the rest of the economy).
//
// "Fix everything" pass (2026-09-21): "cumulative correct picks" now counts
// correct top-scorer predictions too, not just win/loss — see
// topScorerCorrectCountSql below. Previously a strong top-scorer predictor
// got zero milestone credit for that skill despite it being a real,
// separate pick feeding the same points pool (flagged directly: "make sure
// this works, take into account points from predicting either games or top
// scorers, fantasy..."). Re-simulated at 50% wheel engagement (a realistic,
// not-fully-engaged player) alongside the new FANTASY_MILESTONE_INTERVAL
// below: full-album completion rose from 5/13/23/31/43/68% to
// 38/69/84/93/98/99% across 50-80% win/loss accuracy, with no regression at
// 85%/100% engagement (still ~100% everywhere) or the cheapest-first
// spending policy.
//
// Retuned again the same week, 2026-09-22, alongside the legendary catalog
// doubling from 20 to 40 (see replace-legendary-catalog.ts — "replace our
// legendary cards with the brand name players of each team," 2 per team
// instead of 1). Doubling the pool with no other change collapsed 50%-
// engagement completion right back to 0-4% across every accuracy — the
// same bottleneck as before this file's history describes, just worse.
// 60 -> 25 (roughly proportional to the pool doubling, then a small extra
// nudge down after checking the numbers), combined with
// FANTASY_MILESTONE_INTERVAL 6 -> 3 and a legendary-odds bump on the wheel/
// Elite pack (routes/spin.ts, services/packs.ts — both took the increase
// out of coach's share specifically, since coach isn't in the album and so
// is a free lever that doesn't cost any commons/rares/legendary supply),
// restored 50%-engagement completion to 37/72/89/96/99/100% — matching or
// exceeding the original 22-card numbers at every accuracy level, with
// commons/rares completion completely unaffected (the odds increase never
// touched common's/rare's share) and 85%/100%/cheapest-first still ~100%
// everywhere. The 0%-engagement floor (never touches the wheel) also
// improved in relative terms: legendary count there is now 22-33/40 (55-
// 81%) vs the original 2.9-8.9/22 (13-40%) — the tighter, career-wide
// milestones don't depend on wheel engagement at all, so tightening them
// helps this floor specifically. Coach supply dropped moderately as the
// tradeoff (not album-tracked, so this was an acceptable one-way cost).
// Re-run economy:simulate after any future change to either interval or
// either odds table.
//
// 25 -> 18 (2026-09-22, same "explore retuning" pass that added the rare
// milestone below): once rares stopped being the bottleneck, legendary
// became the trailing tier at 25 (29.7/40, 74%, vs rares' 270/289 at 93%
// under the new rare milestone at zero wheel engagement) — direct user
// choice to tighten this back in step rather than let legendary lag
// behind. See RARE_MILESTONE_INTERVAL's own comment for the combined
// re-simulated numbers with both changes together.
export const LEGENDARY_MILESTONE_INTERVAL = 18;

// An unopened pack awarded by a round/milestone reward — same concept as a
// wheel win (routes/spin.ts): it sits in ownedPacks until the user opens it
// themselves from the Packs page, rather than instantly handing over a
// specific card. `tier` is what the pack guarantees (legendary/rare), for
// the caller's banner copy — deliberately not `PACKS[packType].label`,
// which is wheel-flavored text ("Jump Ball — ...") that wouldn't make sense
// announced from a perfect-round or milestone banner.
export interface OwnedPackReward {
  id: string;
  packType: "wheelLegendary" | "wheelPro" | "wheelCoach";
  tier: "legendary" | "rare" | "coach";
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
 * A scalar count of this user's correct top-scorer picks — mirrors
 * services/topScorerPoints.ts's topScorerTotalsCte's per_game_max/
 * per_game_leader derivation (same "which player was this game's top
 * scorer, with the exact tie-null rule" logic) but as a plain count instead
 * of a summed-points CTE, and as nested subqueries rather than a top-level
 * WITH clause so it can be interpolated directly into the scalar-subquery
 * "correct" expression both milestone functions below already use — same
 * "one round trip via scalar subqueries" shape as the win/loss count
 * sitting right next to it. "Fix everything" pass, 2026-09-21.
 */
function topScorerCorrectCountSql(userId: string) {
  return sql`(
    select count(*)::int
    from ${topScorerPredictions} tsp
    join ${games} g on g.id = tsp.game_id
    join (
      select pgm.game_id,
        case when count(*) = 1 then (array_agg(pgs.player_id))[1] else null end as top_scorer_player_id
      from (
        select game_id, max(points) as max_points
        from ${playerGameStats}
        where points is not null
        group by game_id
      ) pgm
      join ${playerGameStats} pgs on pgs.game_id = pgm.game_id and pgs.points = pgm.max_points
      group by pgm.game_id
    ) pgl on pgl.game_id = tsp.game_id
    where g.status = 'final'
      and pgl.top_scorer_player_id = tsp.predicted_player_id
      and tsp.user_id = ${userId}
  )`;
}

/**
 * Grants a guaranteed-new legendary for every LEGENDARY_MILESTONE_INTERVAL
 * cumulative correct picks (win/loss + top-scorer) a user has ever made —
 * a career counter,
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
        )
        + ${topScorerCorrectCountSql(userId)}
      )::int as correct,
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

// Career-wide grant of a guaranteed-new coach, every this-many cumulative
// correct picks (win/loss + top-scorer, since 2026-09-21 — see
// LEGENDARY_MILESTONE_INTERVAL's comment) — see coachMilestones' doc
// comment in schema.ts.
// Added 2026-09-04 alongside the Elite-pack big-slot odds/pity changes
// (services/packs.ts): before this, coach had NO acquisition path outside
// the wheel except Elite's single-slot chance, and season-simulation.ts
// showed that leaves a non-wheel player at ~0 coaches all season regardless
// of accuracy. 45 (vs legendary's 60) — coach's catalog is 20 vs
// legendary's 22, close enough that the interval difference is really
// about the two tracks not always firing in lockstep, tuned against the
// same simulation used for legendary's own interval; re-run
// economy:simulate if this ever needs revisiting.
export const COACH_MILESTONE_INTERVAL = 45;

/**
 * Exact structural mirror of checkAndGrantLegendaryMilestones — see that
 * function's doc comment for the concurrency-safe claim pattern and the
 * "return every unseen grant" shape. Grants an unopened wheelCoach pack
 * (single guaranteed-coach slot, same as a wheel coach win) instead of
 * wheelLegendary.
 */
export async function checkAndGrantCoachMilestones(userId: string): Promise<OwnedPackReward[]> {
  const [{ correct, claimed_count }] = await db.execute<{ correct: number; claimed_count: number }>(sql`
    select
      (
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
        )
        + ${topScorerCorrectCountSql(userId)}
      )::int as correct,
      (select count(*)::int from ${coachMilestones} where user_id = ${userId}) as claimed_count
  `);
  const eligibleMilestones = Math.floor(correct / COACH_MILESTONE_INTERVAL);

  if (eligibleMilestones > claimed_count) {
    for (let milestoneNumber = claimed_count + 1; milestoneNumber <= eligibleMilestones; milestoneNumber++) {
      const [claim] = await db
        .insert(coachMilestones)
        .values({ userId, milestoneNumber, collectibleId: null })
        .onConflictDoNothing({ target: [coachMilestones.userId, coachMilestones.milestoneNumber] })
        .returning();
      if (!claim) continue; // a concurrent request already claimed this one

      const [pack] = await db.insert(ownedPacks).values({ userId, packType: "wheelCoach" }).returning();
      await db.update(coachMilestones).set({ ownedPackId: pack.id }).where(eq(coachMilestones.id, claim.id));
    }
  }

  const unseen = await db
    .select({ pack: ownedPacks })
    .from(coachMilestones)
    .innerJoin(ownedPacks, eq(coachMilestones.ownedPackId, ownedPacks.id))
    .where(and(eq(coachMilestones.userId, userId), isNull(coachMilestones.seenAt)));

  return unseen.map(({ pack }) => ({
    id: pack.id,
    packType: "wheelCoach" as const,
    tier: "coach" as const,
  }));
}

/** Marks every currently-unseen coach milestone this user has as seen — called once its banner has actually been shown. */
export async function markCoachMilestonesSeen(userId: string): Promise<void> {
  await db
    .update(coachMilestones)
    .set({ seenAt: new Date() })
    .where(and(eq(coachMilestones.userId, userId), isNull(coachMilestones.seenAt)));
}

// Every this-many cumulative correct picks (win/loss + top-scorer, same
// counter as legendary/coach above) grants a guaranteed-new RARE — added
// 2026-09-22, "explore retuning" pass, direct user report: bought a mix of
// Elite/Pro packs with real predicted points and only came away with 1
// legendary and a handful of rares. Re-simulating (season-simulation.ts)
// found rares, not legendary, were the actual non-wheel bottleneck: only
// 95/289 (33%) owned on average at 80% accuracy after a full season of
// buying whatever pack was affordable, since every purchasable pack is
// common-heavy by design and duplicate saturation makes the last third of
// 289 rares exponentially harder without real pull volume — confirmed
// directly: even a player who saved every point specifically for Elite
// packs only managed ~6/season (1200pts each), and even a 5x points-income
// test only reached 45% rares before diminishing returns from duplicate
// saturation flattened out. The actual working, wheel-independent source of
// rares turned out to already be great/perfect-round rewards
// (checkAndGrantRoundRewards above) — this milestone just extends that same
// proven mechanic to fire on every correct pick instead of only within a
// round. Interval 2 was chosen to roughly match that existing rate (a great
// round needs 8+ correct in one round for 4 guaranteed rares, ~1 rare per 2
// correct picks already) rather than being invented from scratch.
// Final re-simulated numbers (3000 users/scenario, combined with tightening
// LEGENDARY_MILESTONE_INTERVAL 25->18 in the same pass — see that
// constant's own comment):
// - 100%/85% wheel engagement: still 100% full-album completion everywhere
//   (50-80% accuracy), and noticeably *faster* now (e.g. 75% accuracy/100%
//   engagement median day 137 -> 111) since the new milestones stack on
//   top of wheel income too. Zero regression.
// - 50% wheel engagement (a realistic, not-fully-engaged player): this was
//   the range most exposed to the old rare bottleneck — full completion
//   rose to 94-100% across 50-80% accuracy (previously degraded hard at
//   lower accuracy in this band).
// - 0% wheel engagement, "highest-affordable" spending: rares 95-95/289
//   -> 145-286/289 (50-99%) across 50-80% accuracy, commons 142-201/289 ->
//   148-246/289 (51-85%), legendary 22-32/40 -> 26-39/40 (66-97%) — an 80%-
//   accuracy points-only player now reaches 1% full completion and 3%
//   commons+rares-only by day 210, up from a hard 0% before across the
//   whole accuracy range.
// - 0% wheel engagement, "save-for-elite" spending (see spendLoop's own
//   comment): rares reach 153-285/289 (53-99%), legendary 27-40/40
//   (68-99%) — commons stay low (2-21/289) since this policy never buys a
//   common-guaranteed Starter/Pro pack at all, a real remaining gap for a
//   purely Elite-focused buyer specifically (not a concern for a normal
//   mixed-spending player, which is what "highest-affordable" models).
export const RARE_MILESTONE_INTERVAL = 2;

/**
 * Picks a random collectible of `tier` the user doesn't already own (or any
 * one of that tier if it's somehow fully owned — matches forceNewLegendary/
 * forceNewCoach's own fallback in rollPackForUser, services/packs.ts) and
 * inserts it straight into user_collectibles. Deliberately NOT routed
 * through rollPackForUser's full pack-opening pipeline (pity streaks, foil
 * rolls, multi-slot handling) — this only ever grants exactly one card of
 * one known tier, so that machinery is unneeded overhead. Foil is never
 * rolled here on purpose: finish is a legendary-only flourish (see
 * CollectibleFinish's doc comment), and this never grants a legendary.
 */
async function grantGuaranteedNewCollectible(userId: string, tier: "rare"): Promise<string> {
  const rows = await db
    .select({ id: collectibles.id, ownedCollectibleId: userCollectibles.collectibleId })
    .from(collectibles)
    .leftJoin(userCollectibles, and(eq(userCollectibles.collectibleId, collectibles.id), eq(userCollectibles.userId, userId)))
    .where(eq(collectibles.tier, tier));

  const owned = new Set(rows.filter((r) => r.ownedCollectibleId).map((r) => r.id));
  const missing = rows.map((r) => r.id).filter((id) => !owned.has(id));
  const pool = missing.length > 0 ? missing : rows.map((r) => r.id);
  const collectibleId = pool[Math.floor(Math.random() * pool.length)];

  // No onConflictDoNothing needed — this only ever runs once per
  // (userId, milestoneNumber), guarded by rareMilestones' own unique claim
  // above, so there's no concurrent-duplicate risk to guard against here.
  await db.insert(userCollectibles).values({ userId, collectibleId });
  return collectibleId;
}

/** One granted-rare entry for the Predictions page's milestone banner. */
export interface RareMilestoneReward {
  collectibleId: string;
  name: string;
  imageUrl: string | null;
  teamCode: string;
}

/**
 * Exact same concurrency-safe claim pattern as checkAndGrantLegendaryMilestones
 * (see that function's doc comment) — but grants the card directly instead
 * of an unopened pack, see RARE_MILESTONE_INTERVAL's own comment for why.
 */
export async function checkAndGrantRareMilestones(userId: string): Promise<RareMilestoneReward[]> {
  const [{ correct, claimed_count }] = await db.execute<{ correct: number; claimed_count: number }>(sql`
    select
      (
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
        )
        + ${topScorerCorrectCountSql(userId)}
      )::int as correct,
      (select count(*)::int from ${rareMilestones} where user_id = ${userId}) as claimed_count
  `);
  const eligibleMilestones = Math.floor(correct / RARE_MILESTONE_INTERVAL);

  if (eligibleMilestones > claimed_count) {
    for (let milestoneNumber = claimed_count + 1; milestoneNumber <= eligibleMilestones; milestoneNumber++) {
      const [claim] = await db
        .insert(rareMilestones)
        .values({ userId, milestoneNumber, collectibleId: null })
        .onConflictDoNothing({ target: [rareMilestones.userId, rareMilestones.milestoneNumber] })
        .returning();
      if (!claim) continue; // a concurrent request already claimed this one

      const collectibleId = await grantGuaranteedNewCollectible(userId, "rare");
      await db.update(rareMilestones).set({ collectibleId }).where(eq(rareMilestones.id, claim.id));
    }
  }

  const unseen = await db
    .select({ card: collectibles, teamCode: teams.code })
    .from(rareMilestones)
    .innerJoin(collectibles, eq(rareMilestones.collectibleId, collectibles.id))
    .innerJoin(teams, eq(collectibles.teamId, teams.id))
    .where(and(eq(rareMilestones.userId, userId), isNull(rareMilestones.seenAt)));

  return unseen.map(({ card, teamCode }) => ({
    collectibleId: card.id,
    name: card.name,
    imageUrl: card.imageUrl,
    teamCode,
  }));
}

/** Marks every currently-unseen rare milestone this user has as seen — called once its banner has actually been shown. */
export async function markRareMilestonesSeen(userId: string): Promise<void> {
  await db
    .update(rareMilestones)
    .set({ seenAt: new Date() })
    .where(and(eq(rareMilestones.userId, userId), isNull(rareMilestones.seenAt)));
}

// A third milestone track — "fix everything" album-completability pass,
// 2026-09-21 (see fantasyMilestones' doc comment in schema.ts and
// season-simulation.ts). Deliberately engagement-based, not skill-based:
// counts completed Fantasy Five rounds (a fantasy_round_points row exists
// for that round — see services/fantasyScoring.ts's
// checkAndGrantFantasyRoundPoints, which only inserts one once a round is
// locked/complete and scored above zero), not prediction accuracy. Picked
// via scripts/season-simulation.ts alongside the top-scorer milestone
// change above: at 50% wheel engagement, 6 pushed full-album completion
// from 5/13/23/31/43/68% to 38/69/84/93/98/99% across 50-80% win/loss
// accuracy, with no regression at 85%/100% engagement.
//
// Retuned to 3, 2026-09-22, in the same legendary-catalog-doubling pass
// LEGENDARY_MILESTONE_INTERVAL's own comment describes — see that comment
// for the full before/after numbers (both intervals were retuned together
// against the same simulation runs).
export const FANTASY_MILESTONE_INTERVAL = 3;

/**
 * Exact structural mirror of checkAndGrantLegendaryMilestones/
 * checkAndGrantCoachMilestones — see checkAndGrantLegendaryMilestones's doc
 * comment for the concurrency-safe claim pattern and the "return every
 * unseen grant" shape. Counts distinct completed rounds
 * (fantasyRoundPoints rows) instead of correct picks, and grants an
 * unopened wheelLegendary pack, same as the win/loss+top-scorer track.
 */
export async function checkAndGrantFantasyMilestones(userId: string): Promise<OwnedPackReward[]> {
  const [{ completed_rounds, claimed_count }] = await db.execute<{ completed_rounds: number; claimed_count: number }>(sql`
    select
      (select count(*)::int from ${fantasyRoundPoints} where user_id = ${userId}) as completed_rounds,
      (select count(*)::int from ${fantasyMilestones} where user_id = ${userId}) as claimed_count
  `);
  const eligibleMilestones = Math.floor(completed_rounds / FANTASY_MILESTONE_INTERVAL);

  if (eligibleMilestones > claimed_count) {
    for (let milestoneNumber = claimed_count + 1; milestoneNumber <= eligibleMilestones; milestoneNumber++) {
      const [claim] = await db
        .insert(fantasyMilestones)
        .values({ userId, milestoneNumber })
        .onConflictDoNothing({ target: [fantasyMilestones.userId, fantasyMilestones.milestoneNumber] })
        .returning();
      if (!claim) continue; // a concurrent request already claimed this one

      const [pack] = await db.insert(ownedPacks).values({ userId, packType: "wheelLegendary" }).returning();
      await db.update(fantasyMilestones).set({ ownedPackId: pack.id }).where(eq(fantasyMilestones.id, claim.id));
    }
  }

  const unseen = await db
    .select({ pack: ownedPacks })
    .from(fantasyMilestones)
    .innerJoin(ownedPacks, eq(fantasyMilestones.ownedPackId, ownedPacks.id))
    .where(and(eq(fantasyMilestones.userId, userId), isNull(fantasyMilestones.seenAt)));

  return unseen.map(({ pack }) => ({
    id: pack.id,
    packType: "wheelLegendary" as const,
    tier: "legendary" as const,
  }));
}

/** Marks every currently-unseen fantasy milestone this user has as seen — called once its banner has actually been shown. */
export async function markFantasyMilestonesSeen(userId: string): Promise<void> {
  await db
    .update(fantasyMilestones)
    .set({ seenAt: new Date() })
    .where(and(eq(fantasyMilestones.userId, userId), isNull(fantasyMilestones.seenAt)));
}
