import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  collectibles,
  userCollectibles,
  packOpenings,
  packOpeningResults,
  tradeOffers,
  tradeOfferItems,
  wheelSpins,
  roundRewards,
  legendaryMilestones,
  coachMilestones,
  legendaryPolls,
  users,
} from "../db/schema.js";

// One-off (2026-09-16): the whole `collectibles` catalog was seeded from
// 2025-26 rosters/photos (expand-collectibles.ts's original run) and never
// fully re-derived for 2026-27 — stale team assignments, departed players,
// and (the immediate trigger) stale 2025-26 photos baked into `image_url`.
// Explicit ask: wipe the entire catalog and rebuild fresh from the current
// 2026-27 `players` table, not just patch individual stale rows the way
// fix-collectible-teams.ts/retire-inactive-player-collectibles.ts did.
//
// Deliberately narrower than reset-economy-full.ts (2026-09-02's "full
// fresh start"): this only clears what's structurally tied to a specific
// `collectibles.id` (owned cards, pack-opening history, trades, and the
// legacy/optional collectibleId columns on wheel_spins/round_rewards/
// legendary_milestones/coach_milestones/legendary_polls) — it does NOT
// touch point_adjustments, pity_counters, leagues, or referral state,
// since points/leagues aren't what's stale here and wiping them wasn't
// asked for. NOT NULL FKs (user_collectibles, pack_opening_results,
// trade_offer_items, trade_offers.requestedCollectibleId) are deleted
// outright; nullable/legacy ones are just nulled so their own row's
// history survives. Always run scripts/backup-db.ts immediately before
// this — run 2026-09-16 right before this script.
async function wipe(name: string, fn: () => Promise<{ id: string }[]>) {
  const rows = await fn();
  console.log(`  ${name}: deleted ${rows.length}`);
}

async function main() {
  await wipe("pack_opening_results", () => db.delete(packOpeningResults).returning({ id: packOpeningResults.id }));
  await wipe("pack_openings", () => db.delete(packOpenings).returning({ id: packOpenings.id }));
  await wipe("trade_offer_items", () => db.delete(tradeOfferItems).returning({ id: tradeOfferItems.id }));
  await wipe("trade_offers", () => db.delete(tradeOffers).returning({ id: tradeOffers.id }));
  await wipe("user_collectibles", () => db.delete(userCollectibles).returning({ id: userCollectibles.id }));

  const nulledWheelSpins = await db.update(wheelSpins).set({ collectibleId: null }).returning({ id: wheelSpins.id });
  console.log(`  wheel_spins: nulled collectibleId on ${nulledWheelSpins.length}`);
  const nulledRoundRewards = await db.update(roundRewards).set({ collectibleId: null }).returning({ id: roundRewards.id });
  console.log(`  round_rewards: nulled collectibleId on ${nulledRoundRewards.length}`);
  const nulledLegendaryMilestones = await db
    .update(legendaryMilestones)
    .set({ collectibleId: null })
    .returning({ id: legendaryMilestones.id });
  console.log(`  legendary_milestones: nulled collectibleId on ${nulledLegendaryMilestones.length}`);
  const nulledCoachMilestones = await db
    .update(coachMilestones)
    .set({ collectibleId: null })
    .returning({ id: coachMilestones.id });
  console.log(`  coach_milestones: nulled collectibleId on ${nulledCoachMilestones.length}`);
  const nulledPolls = await db.update(legendaryPolls).set({ winnerCollectibleId: null }).returning({ id: legendaryPolls.id });
  console.log(`  legendary_polls: nulled winnerCollectibleId on ${nulledPolls.length}`);

  const resetUsers = await db.update(users).set({ showcaseCollectibleIds: [] }).returning({ id: users.id });
  console.log(`  users: reset showcaseCollectibleIds on ${resetUsers.length}`);

  const deletedCollectibles = await db.delete(collectibles).returning({ id: collectibles.id });
  console.log(`  collectibles: deleted ${deletedCollectibles.length}`);

  const remaining = await db.execute(sql`select count(*) as c from collectibles`);
  console.log(`Done — ${(remaining as any)[0].c} collectible(s) remain (expect 0).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("wipe-collectibles-catalog failed:", err);
  process.exit(1);
});
