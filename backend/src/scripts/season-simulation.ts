/**
 * Monte Carlo season simulator for the collectibles album — no DB, no side
 * effects, pure in-memory model of the real reward mechanics (points from
 * correct picks, points-priced packs, the daily wheel, perfect-round
 * legendaries, pity, and duplicate auto-sell). Mirrors the actual constants
 * in services/packs.ts / routes/spin.ts / routes/auth.ts as of the
 * 2026-08-25 "album completable in a season" pass — re-run this after any
 * future odds/cost change there to check it still hits a season-completable
 * target, instead of reasoning about pity/duplicate math by hand.
 *
 * Answers: can a realistic player (a given prediction accuracy, not a
 * perfect one) actually finish the album (own every collectible: 208
 * common + 208 rare + 22 legendary) across a season, and how does that
 * scale with accuracy and spending habits?
 *
 * Usage: npm run economy:simulate  (or: npx tsx src/scripts/season-simulation.ts)
 * Env overrides for quick iteration: SIM_N=500 SIM_QUICK=1 npm run economy:simulate
 */

type Tier = "common" | "rare" | "legendary";

const CATALOG_SIZE: Record<Tier, number> = { common: 208, rare: 208, legendary: 22 };
// Common/rare pointsCost, for duplicate sell-back math — mirrors
// scripts/expand-collectibles.ts. Legendary duplicates never sell (see
// sellValueFor's comment in routes/packs.ts — the catalog's legendary
// pointsCost is a display-only "collector value," not a real price), and a
// legendary roll is forced onto an unowned card until all 22 are collected
// (rollPackForUser's forceNewLegendary) — modeled directly below rather
// than via TIER_COST.
const TIER_COST: Record<"common" | "rare", number> = { common: 50, rare: 250 };
const SELL_RATE = 0.5;

const POINTS_PER_CORRECT = 10;
const REGISTRATION_BONUS = 150; // routes/auth.ts WELCOME_BONUS_POINTS
const PITY_THRESHOLD: Record<"common" | "rare", number> = { common: 4, rare: 2 }; // services/packs.ts

const ROUNDS = 38;
const GAMES_PER_ROUND = 10; // matches the live 2026-27 season (confirmed against the DB)
const SEASON_DAYS = 210; // ~Oct-Apr EuroLeague season, matches the pacing assumption in services/packs.ts's comments

// routes/spin.ts SPIN_ODDS, verbatim.
const SPIN_ODDS: Record<Tier, number> = { common: 0.63, rare: 0.23, legendary: 0.14 };

interface PackSlot {
  odds: Partial<Record<Tier, number>>;
}
interface PackDef {
  type: string;
  cost: number;
  purchasable: boolean;
  slots: PackSlot[];
}

// --- services/packs.ts PACKS, verbatim (2026-08-25 pass) ---
const PACKS: PackDef[] = [
  {
    type: "starter",
    cost: 150,
    purchasable: true,
    slots: [
      { odds: { common: 1 } },
      { odds: { common: 1 } },
      { odds: { common: 1 } },
      { odds: { common: 0.92, rare: 0.08 } },
      { odds: { common: 0.92, rare: 0.08 } },
    ],
  },
  {
    type: "pro",
    cost: 400,
    purchasable: true,
    slots: [
      { odds: { common: 1 } },
      { odds: { rare: 1 } },
      { odds: { rare: 1 } },
      { odds: { common: 0.7, rare: 0.3 } },
      { odds: { common: 0.7, rare: 0.3 } },
    ],
  },
  {
    type: "elite",
    cost: 1200,
    purchasable: true,
    slots: [
      { odds: { common: 1 } },
      { odds: { rare: 1 } },
      { odds: { rare: 1 } },
      { odds: { rare: 1 } },
      { odds: { rare: 0.94, legendary: 0.06 } },
    ],
  },
];
const WHEEL_PACKS: Record<"common" | "rare", PackDef> = {
  common: {
    type: "wheelStarter",
    cost: 0,
    purchasable: false,
    slots: [{ odds: { common: 1 } }, { odds: { common: 1 } }, { odds: { common: 1 } }, { odds: { rare: 1 } }, { odds: { rare: 1 } }],
  },
  rare: {
    type: "wheelPro",
    cost: 0,
    purchasable: false,
    slots: [{ odds: { common: 1 } }, { odds: { rare: 1 } }, { odds: { rare: 1 } }, { odds: { rare: 1 } }, { odds: { rare: 1 } }],
  },
};

interface UserState {
  owned: Record<Tier, Set<number>>;
  pity: Record<"common" | "rare", number>;
  points: number;
}

function rollTier(slot: PackSlot): Tier {
  const roll = Math.random();
  let cumulative = 0;
  for (const [tier, probability] of Object.entries(slot.odds) as [Tier, number][]) {
    cumulative += probability;
    if (roll < cumulative) return tier;
  }
  const tiers = Object.keys(slot.odds) as Tier[];
  return tiers[tiers.length - 1];
}

/** Ports rollPackForUser's pity + forced-new-legendary + duplicate logic (services/packs.ts) onto index sets instead of DB rows. */
function openPack(state: UserState, pack: PackDef): number {
  let pointsFromDupes = 0;
  const newlyOwnedThisPack = new Set<string>();

  for (const slot of pack.slots) {
    const tier = rollTier(slot);
    const total = CATALOG_SIZE[tier];

    // Legendary always forces an unowned card (forceNewLegendary) until the
    // whole tier is owned — never sold even if it somehow lands on a dupe
    // (sellValueFor returns null for legendary). Common/rare only force once
    // the pity streak trips, and only if the tier isn't already fully owned
    // (skips the O(total) missing-card scan once nothing's left to force —
    // without this, a completed tier's pity streak sits pinned at/above
    // threshold for the rest of the season, paying that scan on every roll).
    const tierFullyOwned = tier !== "legendary" && state.owned[tier].size >= total;
    const forceNew =
      tier === "legendary"
        ? state.owned.legendary.size < total
        : !tierFullyOwned && state.pity[tier] >= PITY_THRESHOLD[tier];

    let idx: number;
    if (forceNew) {
      const missing: number[] = [];
      for (let i = 0; i < total; i++) {
        if (!state.owned[tier].has(i) && !newlyOwnedThisPack.has(`${tier}:${i}`)) missing.push(i);
      }
      idx = missing.length > 0 ? missing[Math.floor(Math.random() * missing.length)] : Math.floor(Math.random() * total);
    } else {
      idx = Math.floor(Math.random() * total);
    }

    const key = `${tier}:${idx}`;
    const wasDuplicate = state.owned[tier].has(idx) || newlyOwnedThisPack.has(key);
    if (tier === "common" || tier === "rare") {
      state.pity[tier] = wasDuplicate ? state.pity[tier] + 1 : 0;
    }
    if (wasDuplicate) {
      if (tier !== "legendary") pointsFromDupes += TIER_COST[tier] * SELL_RATE;
    } else {
      state.owned[tier].add(idx);
      newlyOwnedThisPack.add(key);
    }
  }
  return pointsFromDupes;
}

/** Perfect-round reward (services/cards.ts's checkAndGrantRoundRewards): always a new legendary, or a no-op once all 22 are owned. */
function grantPerfectRoundLegendary(state: UserState): void {
  const total = CATALOG_SIZE.legendary;
  if (state.owned.legendary.size >= total) return;
  const missing: number[] = [];
  for (let i = 0; i < total; i++) {
    if (!state.owned.legendary.has(i)) missing.push(i);
  }
  state.owned.legendary.add(missing[Math.floor(Math.random() * missing.length)]);
}

type SpendPolicy = "highest-affordable" | "cheapest-first";

function spendLoop(state: UserState, policy: SpendPolicy): void {
  for (;;) {
    const affordable = PACKS.filter((p) => p.purchasable && p.cost <= state.points);
    if (affordable.length === 0) return;
    affordable.sort((a, b) => (policy === "highest-affordable" ? b.cost - a.cost : a.cost - b.cost));
    const pack = affordable[0];
    state.points -= pack.cost;
    state.points += openPack(state, pack);
  }
}

interface SimResult {
  purchasableCompleteDay: number | null;
  fullCompleteDay: number | null;
  commonCountAtEnd: number;
  rareCountAtEnd: number;
  legendaryCountAtEnd: number;
  endPoints: number;
  perfectRounds: number;
}

// Spreads the season's 38 rounds evenly across SEASON_DAYS, e.g. round 1 on
// day ~6, round 38 on day ~210 — good enough for pacing purposes without
// needing a real fixture calendar.
const ROUND_DAY = Array.from({ length: ROUNDS }, (_, i) => Math.round(((i + 1) * SEASON_DAYS) / ROUNDS));

function simulateUser(accuracy: number, spinEngagement: number, policy: SpendPolicy): SimResult {
  const state: UserState = {
    owned: { common: new Set(), rare: new Set(), legendary: new Set() },
    pity: { common: 0, rare: 0 },
    points: REGISTRATION_BONUS,
  };
  let perfectRounds = 0;
  let purchasableCompleteDay: number | null = null;
  let fullCompleteDay: number | null = null;
  let nextRound = 0;

  const isPurchasableComplete = () => state.owned.common.size === CATALOG_SIZE.common && state.owned.rare.size === CATALOG_SIZE.rare;
  const isFullComplete = () => isPurchasableComplete() && state.owned.legendary.size === CATALOG_SIZE.legendary;

  for (let day = 1; day <= SEASON_DAYS; day++) {
    if (nextRound < ROUNDS && ROUND_DAY[nextRound] === day) {
      let correctThisRound = 0;
      for (let g = 0; g < GAMES_PER_ROUND; g++) {
        if (Math.random() < accuracy) {
          correctThisRound++;
          state.points += POINTS_PER_CORRECT;
        }
      }
      if (correctThisRound === GAMES_PER_ROUND) {
        perfectRounds++;
        grantPerfectRoundLegendary(state);
      }
      nextRound++;
      spendLoop(state, policy);
    }

    if (Math.random() < spinEngagement) {
      const roll = Math.random();
      const tier: Tier = roll < SPIN_ODDS.legendary ? "legendary" : roll < SPIN_ODDS.legendary + SPIN_ODDS.rare ? "rare" : "common";
      if (tier === "legendary") {
        grantPerfectRoundLegendary(state); // same "always new" grant, different trigger
      } else {
        state.points += openPack(state, WHEEL_PACKS[tier]);
      }
      spendLoop(state, policy);
    }

    if (purchasableCompleteDay === null && isPurchasableComplete()) purchasableCompleteDay = day;
    if (fullCompleteDay === null && isFullComplete()) fullCompleteDay = day;
  }

  return {
    purchasableCompleteDay,
    fullCompleteDay,
    commonCountAtEnd: state.owned.common.size,
    rareCountAtEnd: state.owned.rare.size,
    legendaryCountAtEnd: state.owned.legendary.size,
    endPoints: state.points,
    perfectRounds,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function runScenario(accuracy: number, spinEngagement: number, policy: SpendPolicy, n: number): void {
  const results: SimResult[] = [];
  for (let i = 0; i < n; i++) {
    results.push(simulateUser(accuracy, spinEngagement, policy));
  }

  const purchasableDays = results.map((r) => r.purchasableCompleteDay).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const fullDays = results.map((r) => r.fullCompleteDay).filter((d): d is number => d !== null).sort((a, b) => a - b);
  const pctPurchasable = (purchasableDays.length / n) * 100;
  const pctFull = (fullDays.length / n) * 100;
  const avgLegendaryAtEnd = results.reduce((s, r) => s + r.legendaryCountAtEnd, 0) / n;
  const avgEndPoints = results.reduce((s, r) => s + r.endPoints, 0) / n;
  const avgPerfectRounds = results.reduce((s, r) => s + r.perfectRounds, 0) / n;

  console.log(
    `accuracy ${(accuracy * 100).toFixed(0).padStart(3)}%  spin engagement ${(spinEngagement * 100).toFixed(0).padStart(3)}%  (${policy})` +
      ` | full album done: ${pctFull.toFixed(0).padStart(3)}%` +
      ` (median day ${String(percentile(fullDays, 0.5)).padStart(3)}/${SEASON_DAYS})` +
      ` | commons+rares only: ${pctPurchasable.toFixed(0).padStart(3)}%` +
      ` (median day ${String(percentile(purchasableDays, 0.5)).padStart(3)})` +
      ` | avg legendaries: ${avgLegendaryAtEnd.toFixed(1).padStart(4)}/22` +
      ` | avg perfect rounds: ${avgPerfectRounds.toFixed(2)}` +
      ` | avg idle pts: ${avgEndPoints.toFixed(0)}`
  );
}

const N = Number(process.env.SIM_N ?? 3000);
const ACCURACIES = process.env.SIM_QUICK ? [0.75] : [0.5, 0.6, 0.65, 0.7, 0.75, 0.8];

console.log(`=== Season simulation: ${N} simulated users, ${ROUNDS} rounds x ${GAMES_PER_ROUND} games over ${SEASON_DAYS} days ===\n`);

console.log("--- Daily wheel spin, 100% engagement (spins every single day), highest-affordable pack spending ---");
for (const acc of ACCURACIES) runScenario(acc, 1.0, "highest-affordable", N);

console.log("\n--- Daily wheel spin, 85% engagement (misses ~1 in 7 days), highest-affordable pack spending ---");
for (const acc of ACCURACIES) runScenario(acc, 0.85, "highest-affordable", N);

console.log("\n--- Daily wheel spin, 100% engagement, cheapest-first pack spending (spends impulsively, never saves for Elite) ---");
for (const acc of ACCURACIES) runScenario(acc, 1.0, "cheapest-first", N);
