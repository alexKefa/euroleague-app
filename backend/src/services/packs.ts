import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, teams, userCollectibles } from "../db/schema.js";

export type Tier = "common" | "rare" | "legendary";
export type PackType = "starter" | "pro" | "elite" | "wheelStarter" | "wheelPro" | "wheelLegendary";

export interface CollectibleRow {
  collectible: typeof collectibles.$inferSelect;
  team: typeof teams.$inferSelect;
}

interface PackSlot {
  // Odds for this slot, keyed by tier — must sum to 1.
  odds: Partial<Record<Tier, number>>;
}

interface PackDefinition {
  type: PackType;
  label: string;
  pointsCost: number;
  slots: PackSlot[];
  // false for the wheelStarter/wheelPro/wheelLegendary trio below — those
  // exist purely so the daily Jump Ball spin (routes/spin.ts) can route its
  // reward through the same rollPack()/packOpenings machinery as a real
  // purchase (batched inserts, duplicate detection, sell-back), without
  // ever being buyable from the Packs store. GET /api/packs filters on
  // this. Omitted (undefined) means purchasable, same as `true`.
  purchasable?: boolean;
}

// Legendary odds deliberately stay tiny (Elite's third slot) — the free
// daily wheel already deals legendaries at a ~10-day expected pace (see
// routes/spin.ts's WIN_CHANCE), always a *new* one, never a dupe. Packs are
// a bonus chase on top of that, not a faster replacement for it — see
// scripts/economy-report.ts for the full reasoning.
export const PACKS: Record<PackType, PackDefinition> = {
  // Labels lean on real EuroLeague competition stages — regular season into
  // playoffs into the Final Four — so rising rarity reads as rising stakes
  // without needing separate explanation. The "starter"/"pro"/"elite" type
  // keys stay as-is; they're just internal ids (stored in pack_openings,
  // used for CSS classes/routing), not shown anywhere.
  starter: {
    type: "starter",
    label: "Regular Season Pack",
    pointsCost: 100,
    slots: [{ odds: { common: 1 } }, { odds: { common: 1 } }, { odds: { common: 0.4, rare: 0.6 } }],
  },
  pro: {
    type: "pro",
    label: "Playoffs Pack",
    pointsCost: 400,
    slots: [{ odds: { common: 1 } }, { odds: { rare: 1 } }, { odds: { common: 0.5, rare: 0.5 } }],
  },
  elite: {
    type: "elite",
    label: "Final Four Pack",
    pointsCost: 1200,
    slots: [{ odds: { common: 1 } }, { odds: { rare: 1 } }, { odds: { rare: 0.97, legendary: 0.03 } }],
  },

  // Wheel-exclusive, free (pointsCost 0), never purchasable — see the
  // `purchasable` doc comment above. Weighted choice between these three on
  // each spin reuses SPIN_ODDS (65/25/10) from routes/spin.ts verbatim,
  // just reinterpreted as "which pack" instead of "which tier", so the
  // existing legendary pacing already reasoned about in
  // scripts/economy-report.ts doesn't silently shift. wheelStarter/wheelPro
  // mirror the real starter/pro packs' 3-slot odds exactly, so a Jump Ball
  // win feels like the pack it's named after, not a lesser 1-card version
  // of it — only wheelLegendary stays single-slot, since it's a guaranteed
  // legendary rather than a normal pack roll.
  wheelStarter: {
    type: "wheelStarter",
    label: "Jump Ball — Common Pull",
    pointsCost: 0,
    purchasable: false,
    slots: [{ odds: { common: 1 } }, { odds: { common: 1 } }, { odds: { common: 0.4, rare: 0.6 } }],
  },
  wheelPro: {
    type: "wheelPro",
    label: "Jump Ball — Rare Pull",
    pointsCost: 0,
    purchasable: false,
    slots: [{ odds: { common: 1 } }, { odds: { rare: 1 } }, { odds: { common: 0.5, rare: 0.5 } }],
  },
  wheelLegendary: {
    type: "wheelLegendary",
    label: "Jump Ball — Legendary Pull",
    pointsCost: 0,
    purchasable: false,
    slots: [{ odds: { legendary: 1 } }],
  },
};

function rollTier(slot: PackSlot): Tier {
  const roll = Math.random();
  let cumulative = 0;
  for (const [tier, probability] of Object.entries(slot.odds) as [Tier, number][]) {
    cumulative += probability;
    if (roll < cumulative) return tier;
  }
  // Floating-point rounding safety net — land on the slot's last listed tier.
  const tiers = Object.keys(slot.odds) as Tier[];
  return tiers[tiers.length - 1];
}

/** One random collectible per slot in the pack, tier-weighted by that slot's odds. */
export function rollPack(packType: PackType, catalogByTier: Record<Tier, CollectibleRow[]>): CollectibleRow[] {
  return PACKS[packType].slots.map((slot) => {
    const tier = rollTier(slot);
    const pool = catalogByTier[tier];
    return pool[Math.floor(Math.random() * pool.length)];
  });
}

export interface RolledSlot extends CollectibleRow {
  wasDuplicate: boolean;
}

// Shared by both ways a pack actually gets opened — a straight purchase
// (routes/packs.ts POST /:type/open) and opening a pack won earlier from
// the wheel (routes/packs.ts POST /owned/:id/open). Fetches the catalog +
// what the user already owns, rolls the pack, and marks each slot
// wasDuplicate against the *pre-roll* ownership set plus anything rolled
// earlier in this same pack (so a pack can't call two copies of a card it
// just rolled both "new").
export async function rollPackForUser(userId: string, packType: PackType): Promise<RolledSlot[]> {
  const [catalogRows, ownedRows] = await Promise.all([
    db.select({ collectible: collectibles, team: teams }).from(collectibles).innerJoin(teams, eq(collectibles.teamId, teams.id)),
    db.select({ collectibleId: userCollectibles.collectibleId }).from(userCollectibles).where(eq(userCollectibles.userId, userId)),
  ]);

  const byTier: Record<Tier, CollectibleRow[]> = { common: [], rare: [], legendary: [] };
  for (const row of catalogRows) {
    byTier[row.collectible.tier as Tier].push(row);
  }
  for (const tier of Object.keys(byTier) as Tier[]) {
    if (byTier[tier].length === 0) {
      throw new Error(`No ${tier} cards in the catalog to roll`);
    }
  }

  const rolled = rollPack(packType, byTier);
  const ownedIds = new Set(ownedRows.map((o) => o.collectibleId));
  const newlyOwnedIds = new Set<string>();
  return rolled.map(({ collectible, team }) => {
    const wasDuplicate = ownedIds.has(collectible.id) || newlyOwnedIds.has(collectible.id);
    if (!wasDuplicate) newlyOwnedIds.add(collectible.id);
    return { collectible, team, wasDuplicate };
  });
}
