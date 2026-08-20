/**
 * Points-economy balance report: is the predictions points system
 * (gain via correct picks, spend via the collectibles store) sustainable?
 *
 * Usage: npm run economy:report  (or: tsx src/scripts/economy-report.ts)
 *
 * The model, in one line:
 *   pointsPerRound = gamesPerRound × participation × accuracy × POINTS_PER_CORRECT
 *
 * Everything below plugs live numbers from the DB (games/round, rounds/season,
 * actual catalog costs) into that formula across a few accuracy scenarios,
 * since real per-user accuracy data doesn't exist yet at meaningful volume
 * (see the "resolved predictions" count printed below).
 */
import "dotenv/config";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, collectibles, predictions } from "../db/schema.js";
import { POINTS_PER_CORRECT } from "../services/points.js";
import { LEGENDARY_CHANCE, COOLDOWN_MS } from "../routes/spin.js";

const ACCURACY_SCENARIOS = [0.5, 0.6, 0.7]; // coin-flip, decent, sharp
const PARTICIPATION = 1.0; // fraction of each round's games a user actually predicts

async function main() {
  const [seasonRow] = await db
    .select({ season: games.season })
    .from(games)
    .where(isNotNull(games.round))
    .orderBy(sql`${games.season} desc`)
    .limit(1);
  const season = seasonRow?.season ?? null;

  const roundCounts = season
    ? await db
        .select({ round: games.round, n: sql<number>`count(*)::int` })
        .from(games)
        .where(and(eq(games.season, season), isNotNull(games.round)))
        .groupBy(games.round)
    : [];
  const roundsPerSeason = roundCounts.length;
  const avgGamesPerRound = roundsPerSeason
    ? roundCounts.reduce((sum, r) => sum + r.n, 0) / roundsPerSeason
    : 0;

  const catalog = await db
    .select({ tier: collectibles.tier, cost: collectibles.pointsCost })
    .from(collectibles);
  const byTier = { common: [] as number[], rare: [] as number[], legendary: [] as number[] };
  for (const { tier, cost } of catalog) {
    (byTier[tier as keyof typeof byTier] ?? []).push(cost);
  }
  const sinkTotal = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const purchasableSink = sinkTotal(byTier.common) + sinkTotal(byTier.rare);
  const legendaryCount = byTier.legendary.length;

  const [resolvedRow] = await db
    .select({ resolved: sql<number>`count(*)::int` })
    .from(predictions)
    .innerJoin(games, eq(predictions.gameId, games.id))
    .where(eq(games.status, "final"));
  const resolvedCount = resolvedRow?.resolved ?? 0;

  console.log("=== Points economy report ===\n");
  console.log(`Season: ${season ?? "n/a"} — ${roundsPerSeason} rounds, ~${avgGamesPerRound.toFixed(1)} games/round`);
  console.log(`Resolved predictions in DB: ${resolvedCount} (too few to trust empirical accuracy — using modeled scenarios)`);
  console.log(
    `Catalog: ${byTier.common.length} common @ ${byTier.common[0] ?? "-"}pts, ` +
      `${byTier.rare.length} rare @ ${byTier.rare[0] ?? "-"}pts, ` +
      `${legendaryCount} legendary (not purchasable — wheel/perfect-round only)`
  );
  console.log(`Purchasable sink (every common + every rare): ${purchasableSink}pts\n`);

  console.log("--- Income vs. sink, by assumed accuracy (100% participation) ---");
  console.log("accuracy | pts/round | season income | rounds to buy out common+rare catalog");
  for (const accuracy of ACCURACY_SCENARIOS) {
    const pointsPerRound = avgGamesPerRound * PARTICIPATION * accuracy * POINTS_PER_CORRECT;
    const seasonIncome = pointsPerRound * roundsPerSeason;
    const roundsToBuyOut = pointsPerRound > 0 ? purchasableSink / pointsPerRound : Infinity;
    const verdict =
      roundsToBuyOut < roundsPerSeason * 0.5
        ? "FAST — catalog exhausted well before season end"
        : roundsToBuyOut <= roundsPerSeason
          ? "sustainable across a season"
          : "SLOW — takes multiple seasons";
    console.log(
      `${(accuracy * 100).toFixed(0)}%      | ${pointsPerRound.toFixed(1).padStart(9)} | ` +
        `${seasonIncome.toFixed(0).padStart(13)} | ${roundsToBuyOut.toFixed(1).padStart(6)} rounds (${verdict})`
    );
  }

  console.log("\n--- Legendary path (wheel + perfect round) ---");
  const expectedDaysPerLegendary = (COOLDOWN_MS / 86_400_000) / LEGENDARY_CHANCE;
  console.log(
    `Free spin: every spin gives something now (common/rare/legendary), but the legendary rate is ` +
      `still just ${(LEGENDARY_CHANCE * 100).toFixed(0)}%, ${COOLDOWN_MS / 3_600_000}h cooldown. ` +
      `A legendary always grants a NEW one (never a dupe), so expected time per legendary ≈ ${expectedDaysPerLegendary.toFixed(1)} days.`
  );
  console.log(
    `With ${legendaryCount} legendaries in the catalog, expected time to collect all of them via spin alone ≈ ` +
      `${(expectedDaysPerLegendary * legendaryCount).toFixed(0)} days (~${((expectedDaysPerLegendary * legendaryCount) / 7).toFixed(1)} weeks), ` +
      `faster if perfect-round bonuses land too. This path costs no points at all.`
  );

  console.log("\n--- Structural finding ---");
  console.log(
    "Points have a hard ceiling on what they can buy: once a user owns every common + rare " +
      `(${purchasableSink}pts total), every further point is dead currency — legendaries can't be ` +
      "bought with points at any price, only won. There's currently no renewable points sink " +
      "(e.g. spending points on extra spins, re-rolls, or catalog restocks), so accumulation is " +
      "unbounded past that point. Not urgent today (catalog is small and takes a full season+ to " +
      "exhaust at realistic accuracy), but worth planning for if the catalog stops growing faster " +
      "than users' points income."
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Economy report failed:", err);
  process.exit(1);
});
