import { collectibles, teams } from "../db/schema.js";

export type Tier = "common" | "rare" | "legendary";
export type PackType = "starter" | "pro" | "elite";

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
