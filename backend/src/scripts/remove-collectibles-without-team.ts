import { db } from "../db/client.js";
import { collectibles, teams, userCollectibles, wheelSpins, packOpeningResults, tradeOfferItems, tradeOffers, roundRewards, legendaryMilestones } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";

// One-off (2026-09-02), follow-up to fix-collectible-teams.ts: 6 of the 437
// collectibles still point at AS Monaco (not in the 2026-27 competition —
// see routes/teams.ts) because those 3 players (Nemanja Nedovic, Nikola
// Mirotic, Alpha Diallo) aren't on any 2026-27 roster in our synced data at
// all, so there was no current team to correct them to. Rather than leave
// stale "MCO" cards visible in the Store, this removes them outright — safe
// only because reset-economy-full.ts already wiped every table that could
// reference a collectible id (verified again here before deleting).
async function main() {
  const [mco] = await db.select().from(teams).where(eq(teams.code, "MCO"));
  if (!mco) {
    console.log("No MCO team row — nothing to do.");
    process.exit(0);
  }

  const rows = await db.select({ id: collectibles.id, name: collectibles.name, tier: collectibles.tier }).from(collectibles).where(eq(collectibles.teamId, mco.id));
  if (rows.length === 0) {
    console.log("No collectibles on MCO — nothing to do.");
    process.exit(0);
  }
  const ids = rows.map((r) => r.id);

  const referencedBy = async (label: string, fn: () => Promise<unknown[]>) => {
    const found = await fn();
    if (found.length > 0) {
      throw new Error(`${found.length} row(s) in ${label} still reference an MCO collectible — aborting, refusing to delete`);
    }
  };
  await referencedBy("user_collectibles", () => db.select().from(userCollectibles).where(inArray(userCollectibles.collectibleId, ids)));
  await referencedBy("wheel_spins", () => db.select().from(wheelSpins).where(inArray(wheelSpins.collectibleId, ids)));
  await referencedBy("pack_opening_results", () => db.select().from(packOpeningResults).where(inArray(packOpeningResults.collectibleId, ids)));
  await referencedBy("trade_offer_items", () => db.select().from(tradeOfferItems).where(inArray(tradeOfferItems.collectibleId, ids)));
  await referencedBy("trade_offers", () => db.select().from(tradeOffers).where(inArray(tradeOffers.requestedCollectibleId, ids)));
  await referencedBy("round_rewards", () => db.select().from(roundRewards).where(inArray(roundRewards.collectibleId, ids)));
  await referencedBy("legendary_milestones", () => db.select().from(legendaryMilestones).where(inArray(legendaryMilestones.collectibleId, ids)));

  console.log(`Deleting ${ids.length} collectible(s) still tied to AS Monaco:`);
  rows.forEach((r) => console.log(`  ${r.name} (${r.tier})`));

  await db.delete(collectibles).where(inArray(collectibles.id, ids));
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("remove-collectibles-without-team failed:", err);
  process.exit(1);
});
