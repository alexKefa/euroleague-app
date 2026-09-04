import { db } from "../db/client.js";
import {
  collectibles,
  players,
  userCollectibles,
  wheelSpins,
  packOpeningResults,
  tradeOfferItems,
  tradeOffers,
  roundRewards,
  legendaryMilestones,
} from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";

// One-off (2026-09-04): collectibles.teamId is a snapshot taken when each
// card was minted (expand-collectibles.ts), matched by player name — never
// re-synced afterward. fix-collectible-teams.ts (2026-09-02) only corrected
// cards for players who TRANSFERRED to a different real 2026-27 team, by
// re-resolving against players.teamId. It never touched players who left
// the league/roster entirely, because `players.active` (roster_sync.py
// marking a player who drops off every current-season roster fetch, see
// schema.ts's comment on players.teamId) didn't exist yet at the time —
// it was added afterward, in the "stop departed players lingering on their
// old team's roster page" pass. Found via user report: Biberovic and De
// Colo still showing under Fenerbahce in Store/Inventory despite roster
// syncs correctly marking them inactive days ago. Same
// normalizePlayerName matching as routes/collectibles.ts, applied here
// against every `players.active = false` row instead of just the two
// reported ones — 46 players / 92 collectible rows league-wide.
//
// Unlike remove-collectibles-without-team.ts's MCO cleanup (which only
// ever aborted if it found a reference, since ownership had already been
// wiped by reset-economy-full.ts by that point), 25 of these 92 rows are
// genuinely owned today and 27 have real pack_opening_results history —
// deleting the collectible therefore means deleting those referencing rows
// too, not just aborting. Explicitly confirmed with the user: no
// compensation (no sell-back credit, no replacement pack), including for
// the one owned legendary (Glynn Watson) even though that drops the
// catalog's real legendary count to 21 against the 22 everywhere else in
// this app assumes — see the CLAUDE.md economy-calibration notes if that
// ever needs revisiting. wheel_spins/round_rewards/legendary_milestones'
// collectibleId columns and trade_offers/trade_offer_items are asserted
// empty rather than silently cascaded, since a real hit there would be
// unexpected and worth investigating rather than blindly deleting.
function normalizePlayerName(name: string): string {
  const commaIdx = name.indexOf(",");
  const reordered = commaIdx === -1 ? name : `${name.slice(commaIdx + 1)} ${name.slice(0, commaIdx)}`;
  return reordered.toLowerCase().replace(/\s+/g, " ").trim();
}

async function main() {
  const allPlayers = await db.select({ name: players.name, active: players.active, teamId: players.teamId }).from(players);
  const allCollectibles = await db.select({ id: collectibles.id, name: collectibles.name, tier: collectibles.tier, teamId: collectibles.teamId }).from(collectibles);

  const collByKey = new Map<string, typeof allCollectibles>();
  for (const c of allCollectibles) {
    const key = `${c.teamId}|${normalizePlayerName(c.name)}`;
    const arr = collByKey.get(key) ?? [];
    arr.push(c);
    collByKey.set(key, arr);
  }

  const stale: typeof allCollectibles = [];
  for (const p of allPlayers) {
    if (p.active) continue;
    const matches = collByKey.get(`${p.teamId}|${normalizePlayerName(p.name)}`);
    if (matches) stale.push(...matches);
  }

  if (stale.length === 0) {
    console.log("No stale collectibles for inactive players — nothing to do.");
    process.exit(0);
  }

  const ids = stale.map((r) => r.id);
  console.log(`Retiring ${ids.length} collectible(s) still pinned to an inactive player's old team:`);
  stale.forEach((r) => console.log(`  ${r.name} (${r.tier})`));

  const assertEmpty = async (label: string, fn: () => Promise<unknown[]>) => {
    const found = await fn();
    if (found.length > 0) {
      throw new Error(`${found.length} unexpected row(s) in ${label} reference a retired collectible — aborting`);
    }
  };
  await assertEmpty("wheel_spins", () => db.select().from(wheelSpins).where(inArray(wheelSpins.collectibleId, ids)));
  await assertEmpty("round_rewards", () => db.select().from(roundRewards).where(inArray(roundRewards.collectibleId, ids)));
  await assertEmpty("legendary_milestones", () => db.select().from(legendaryMilestones).where(inArray(legendaryMilestones.collectibleId, ids)));
  await assertEmpty("trade_offer_items", () => db.select().from(tradeOfferItems).where(inArray(tradeOfferItems.collectibleId, ids)));
  await assertEmpty("trade_offers", () => db.select().from(tradeOffers).where(inArray(tradeOffers.requestedCollectibleId, ids)));

  const ownedRows = await db.select({ userId: userCollectibles.userId, collectibleId: userCollectibles.collectibleId }).from(userCollectibles).where(inArray(userCollectibles.collectibleId, ids));
  const historyRows = await db.select({ id: packOpeningResults.id }).from(packOpeningResults).where(inArray(packOpeningResults.collectibleId, ids));
  console.log(`  ${ownedRows.length} owned row(s) and ${historyRows.length} pack_opening_results row(s) will be deleted with no compensation (confirmed with user).`);

  await db.delete(userCollectibles).where(inArray(userCollectibles.collectibleId, ids));
  await db.delete(packOpeningResults).where(inArray(packOpeningResults.collectibleId, ids));
  await db.delete(collectibles).where(inArray(collectibles.id, ids));

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("retire-inactive-player-collectibles failed:", err);
  process.exit(1);
});
