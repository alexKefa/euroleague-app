import { db } from "../db/client.js";
import {
  tradeOfferItems,
  tradeOffers,
  leagueMembers,
  leagues,
  roundRewards,
  legendaryMilestones,
  packOpeningResults,
  packOpenings,
  ownedPacks,
  wheelSpins,
  userCollectibles,
  pityCounters,
  pointAdjustments,
  users,
} from "../db/schema.js";

// One-off "full fresh start" wipe (2026-09-02), requested explicitly after
// scripts/reset-2026-27-season-data.ts's deliberately narrower "season data
// only" pass left every user's owned cards/points/packs untouched — this is
// the broader option that was offered and declined at the time, now
// explicitly asked for instead: every user starts the 2026-27 season with
// zero cards, zero points, no packs, no trades, no leagues. Predictions and
// game data are NOT touched here — that's a separate, already-completed
// concern (see reset-2026-27-season-data.ts). Always run
// scripts/backup-db.ts immediately before this — every table here is fully
// emptied, not filtered.
//
// Deletion order follows the FK graph (children before parents):
// tradeOfferItems -> tradeOffers; leagueMembers -> leagues;
// roundRewards/legendaryMilestones -> ownedPacks; packOpeningResults ->
// packOpenings. wheelSpins/userCollectibles/pityCounters/pointAdjustments
// have no dependents.
async function wipe(name: string, fn: () => Promise<{ id: string }[]>) {
  const rows = await fn();
  console.log(`  ${name}: deleted ${rows.length}`);
}

async function main() {
  await wipe("trade_offer_items", () => db.delete(tradeOfferItems).returning({ id: tradeOfferItems.id }));
  await wipe("trade_offers", () => db.delete(tradeOffers).returning({ id: tradeOffers.id }));
  await wipe("league_members", () => db.delete(leagueMembers).returning({ id: leagueMembers.id }));
  await wipe("leagues", () => db.delete(leagues).returning({ id: leagues.id }));
  await wipe("round_rewards", () => db.delete(roundRewards).returning({ id: roundRewards.id }));
  await wipe("legendary_milestones", () => db.delete(legendaryMilestones).returning({ id: legendaryMilestones.id }));
  await wipe("pack_opening_results", () => db.delete(packOpeningResults).returning({ id: packOpeningResults.id }));
  await wipe("pack_openings", () => db.delete(packOpenings).returning({ id: packOpenings.id }));
  await wipe("owned_packs", () => db.delete(ownedPacks).returning({ id: ownedPacks.id }));
  await wipe("wheel_spins", () => db.delete(wheelSpins).returning({ id: wheelSpins.id }));
  await wipe("user_collectibles", () => db.delete(userCollectibles).returning({ id: userCollectibles.id }));
  await wipe("pity_counters", () => db.delete(pityCounters).returning({ id: pityCounters.userId }));
  await wipe("point_adjustments", () => db.delete(pointAdjustments).returning({ id: pointAdjustments.id }));

  const resetUsers = await db
    .update(users)
    .set({ showcaseCollectibleIds: [], referralRewardGranted: false })
    .returning({ id: users.id });
  console.log(`  users: reset showcaseCollectibleIds/referralRewardGranted on ${resetUsers.length}`);

  console.log("Done — collectibles/points economy fully reset. predictions and games were not touched.");
  process.exit(0);
}

main().catch((err) => {
  console.error("reset-economy-full failed:", err);
  process.exit(1);
});
