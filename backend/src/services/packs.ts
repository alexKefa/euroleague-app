import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, teams, userCollectibles, pityCounters } from "../db/schema.js";

export type Tier = "common" | "rare" | "legendary" | "coach";
export type PackType = "starter" | "pro" | "elite" | "wheelStarter" | "wheelPro" | "wheelLegendary" | "wheelCoach";

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

// --- "Album completable in a season" pass (2026-08-25) ---
// The album (frontend/src/app/features/album/) is the full 208-common /
// 208-rare / 22-legendary catalog. Simulating the real pity mechanics
// (services/packs.ts's PITY_THRESHOLD) against that catalog size found
// collecting every rare takes ~381 dedicated rare-tier pulls on average
// (random-draw-with-pity needs ~1.8x the raw card count, not 1x) — the old
// odds below only produced ~125 rare pulls across a ~210-day season even
// from the free wheel alone, common+rare never finished. Two changes fixed
// it: every purchasable pack gained a 4th and 5th slot (still worth well
// under its points cost worst-case — see each pack's own comment — so the
// original common-heavy-exploit concern below still holds), and
// wheelStarter/wheelPro (routes/spin.ts's free daily pack) stopped
// mirroring their purchasable counterparts 1:1 and went to *guaranteed*
// rare slots instead, since a free pack has no worst-case-EV ceiling to
// protect. Re-simulated result: a 70%-accuracy predictor who also spends
// their points on Regular Season packs finishes the full album (commons +
// rares + all 22 legendaries) in ~93% of simulated seasons, averaging day
// ~178 of a ~210-day season — and the completion rate barely drops even at
// 50% prediction accuracy, since the free wheel (not predicted points) now
// carries most of the load. Predicting well still buys packs faster, it's
// just no longer the only way to finish the album.
export const PACKS: Record<PackType, PackDefinition> = {
  // Labels lean on real EuroLeague competition stages — regular season into
  // playoffs into the Final Four — so rising rarity reads as rising stakes
  // without needing separate explanation. The "starter"/"pro"/"elite" type
  // keys stay as-is; they're just internal ids (stored in pack_openings,
  // used for CSS classes/routing), not shown anywhere.
  starter: {
    type: "starter",
    label: "Regular Season Pack",
    // 100 -> 150 (2026-08-25) alongside 3 -> 5 slots — a straight 3->5 slot
    // buff at the old 100pt price is unsafe at ANY odds: even 5 guaranteed
    // commons alone sell back 5*25=125pts, already over the old cost. 150
    // keeps a real (if thin) margin: worst-case EV below is 141pts against
    // this 150pt cost.
    pointsCost: 150,
    // Original 3rd-slot exploit reasoning still applies (see the sell-back-
    // rate comment in the git history) — 92/8 on the two new slots keeps
    // worst-case EV (3*25 + 2*(25*.92 + 125*.08) = 75 + 2*33 = 141) under
    // the 150pt cost, a similar margin to the original 90-under-100.
    slots: [
      { odds: { common: 1 } },
      { odds: { common: 1 } },
      { odds: { common: 1 } },
      { odds: { common: 0.92, rare: 0.08 } },
      { odds: { common: 0.92, rare: 0.08 } },
    ],
  },
  pro: {
    type: "pro",
    label: "Playoffs Pack",
    pointsCost: 400,
    // 2 -> 5 slots, price unchanged — pro had a lot of EV headroom already
    // (worst-case was 225 against a 400 cost even at 3 slots), enough to
    // add 2 more rare-leaning slots and land at 385/400, still safely under
    // cost. 3rd slot moved from 50/50 to a guaranteed rare (it already
    // wasn't the exploit-sensitive slot pro's original 50/50 3rd slot was
    // never flagged the way starter's was, since pro's guaranteed-rare 2nd
    // slot already ate most of its margin).
    slots: [
      { odds: { common: 1 } },
      { odds: { rare: 1 } },
      { odds: { rare: 1 } },
      { odds: { common: 0.7, rare: 0.3 } },
      { odds: { common: 0.7, rare: 0.3 } },
    ],
  },
  elite: {
    type: "elite",
    label: "Final Four Pack",
    pointsCost: 1200,
    // 2 -> 4 guaranteed-rare slots (plus the legendary-chance slot), price
    // unchanged — elite had enormous EV headroom (267.5 worst-case against
    // 1200 even at 3 slots, since legendary duplicates no longer sell for
    // anything — see sellValueFor in routes/packs.ts), so the extra rare
    // slots cost nothing in exploit risk (worst-case is still only 517.5).
    // 6% legendary + 5% coach -> 17% legendary + 13% coach (2026-09-04,
    // "reconsider legendary/coach chances" pass): a user report + re-run
    // simulation (see season-simulation.ts's zero-wheel-engagement
    // scenario) found that WITHOUT the wheel — this app's daily spin was
    // never meant to be the mandatory path — a season of buying nothing
    // but Elite packs at 80% accuracy averaged only 8.8/22 legendaries and
    // essentially 0/20 coaches all season, and a real 15-pack, 0-legendary
    // streak (a ~40% chance event at the old 6%) felt exactly as bad as
    // that math predicts. Tripling+ this slot's big-hit share, combined
    // with ELITE_BIG_SLOT_PITY_THRESHOLD below and coach's own milestone
    // track (services/cards.ts), is what actually moves the needle — see
    // that file's re-simulated numbers. Legendary/coach never sell for
    // points even as a "duplicate" (sellValueFor returns null for both),
    // so shifting share away from rare here only ever LOWERS this slot's
    // points-worst-case EV, not raises it — no new exploit risk, unlike a
    // common/rare odds change would be.
    slots: [
      { odds: { common: 1 } },
      { odds: { rare: 1 } },
      { odds: { rare: 1 } },
      { odds: { rare: 1 } },
      { odds: { rare: 0.7, legendary: 0.17, coach: 0.13 } },
    ],
  },

  // Wheel-exclusive, free (pointsCost 0), never purchasable — see the
  // `purchasable` doc comment above. Weighted choice between these four on
  // each spin reuses SPIN_ODDS (58/20/14/8, 2026-09-03) from routes/spin.ts
  // verbatim, just reinterpreted as "which pack" instead of "which tier".
  //
  // wheelStarter/wheelPro *used to* mirror the real starter/pro packs'
  // slot odds exactly ("a Jump Ball win should feel like the pack it's
  // named after"). That stopped being true in the 2026-08-25 album pass:
  // a free pack has no worst-case-EV ceiling to protect the way a
  // purchased one does, and the wheel is the dominant card-supply source
  // by volume (a season of daily spins vastly outnumbers what predicted
  // points can buy), so it's the one place safe to give guaranteed rares
  // instead of just better odds at one. Only wheelLegendary stays
  // single-slot, since it's a guaranteed legendary rather than a normal
  // pack roll.
  wheelStarter: {
    type: "wheelStarter",
    label: "Jump Ball — Common Pull",
    pointsCost: 0,
    purchasable: false,
    slots: [{ odds: { common: 1 } }, { odds: { common: 1 } }, { odds: { common: 1 } }, { odds: { rare: 1 } }, { odds: { rare: 1 } }],
  },
  wheelPro: {
    type: "wheelPro",
    label: "Jump Ball — Rare Pull",
    pointsCost: 0,
    purchasable: false,
    slots: [{ odds: { common: 1 } }, { odds: { rare: 1 } }, { odds: { rare: 1 } }, { odds: { rare: 1 } }, { odds: { rare: 1 } }],
  },
  wheelLegendary: {
    type: "wheelLegendary",
    label: "Jump Ball — Legendary Pull",
    pointsCost: 0,
    purchasable: false,
    slots: [{ odds: { legendary: 1 } }],
  },
  // Coach cards (2026-09-03): a fourth Jump Ball outcome, single guaranteed
  // slot — exact structural mirror of wheelLegendary above, just for the
  // coach pool instead. See rollPackForUser's forceNewCoach for the
  // "always a new one until all 20 are owned" guarantee.
  wheelCoach: {
    type: "wheelCoach",
    label: "Jump Ball — Coach Pull",
    pointsCost: 0,
    purchasable: false,
    slots: [{ odds: { coach: 1 } }],
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

export type Finish = "standard" | "foil";

// Cosmetic-only, legendary-only chance rolled on top of the tier itself —
// see the finish column's comment in schema.ts. 12% keeps a foil feeling
// genuinely special (roughly 1 in 8 fresh legendaries) without diluting
// the moment a legendary drop already is on its own.
const FOIL_CHANCE = 0.12;

export interface RolledSlot extends CollectibleRow {
  wasDuplicate: boolean;
  finish: Finish;
}

export interface PityState {
  common: number;
  rare: number;
  // Consecutive Elite-pack opens whose "big slot" (see BIG_SLOT_TIERS
  // below) rolled rare instead of legendary/coach — see
  // ELITE_BIG_SLOT_PITY_THRESHOLD. 0 for any pack type that never rolls a
  // big slot at all (the value is simply carried through unchanged).
  eliteBigSlot: number;
}

// Consecutive-duplicate streak (per tier) that forces the next roll of that
// tier to a card the user doesn't yet own, instead of a fully random pick.
// Modeled against the real catalog (208 common / 208 rare) and pack odds —
// see the design-canvas economy simulation this was picked from — 4/2
// meaningfully shortens the "10 packs, zero new cards" tail without making
// pack contents feel predetermined. Legendary has no entry: it's handled
// unconditionally below instead of via a streak (see forceNewLegendary).
export const PITY_THRESHOLD: { common: number; rare: number } = { common: 4, rare: 2 };

// A "big slot" is any slot whose odds carry BOTH legendary and coach
// (currently just Elite's 5th slot) — detected structurally rather than by
// pack type, so a future pack with a similarly-shaped slot gets this pity
// for free. 6 consecutive rare landings on that slot (2026-09-04, see the
// Elite-pack comment in PACKS above for the report that prompted this) means
// roughly a 1-in-8 chance of tripping it at the new 30% combined
// legendary+coach share — a real backstop against a demoralizing streak
// without making every pack's big slot feel predetermined, same spirit as
// PITY_THRESHOLD above. Re-verify against season-simulation.ts if this ever
// needs retuning.
export const ELITE_BIG_SLOT_PITY_THRESHOLD = 6;

function isBigSlot(slot: PackSlot): boolean {
  return slot.odds.legendary !== undefined && slot.odds.coach !== undefined;
}

function rollCard(pool: CollectibleRow[]): CollectibleRow {
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Rare/common only — legendary is handled unconditionally, not via streak. */
function isPityTier(tier: Tier): tier is "common" | "rare" {
  return tier === "common" || tier === "rare";
}

// Shared by both ways a pack actually gets opened — a straight purchase
// (routes/packs.ts POST /:type/open) and opening a pack won earlier from
// the wheel (routes/packs.ts POST /owned/:id/open). Fetches the catalog +
// what the user already owns, rolls the pack (applying the pity streaks
// above), and marks each slot wasDuplicate against the *pre-roll* ownership
// set plus anything rolled earlier in this same pack (so a pack can't call
// two copies of a card it just rolled both "new"). Returns the updated
// pity streaks too — the caller is responsible for persisting them (same
// transaction as the rest of the pack outcome, see routes/packs.ts) so
// they can never drift out of sync with what was actually rolled.
//
// One round trip (a left join scoped to this user) instead of two separate
// queries — each round trip to this (remote) DB costs real, mostly-fixed
// latency no matter how the queries are issued (measured directly:
// Promise.all doesn't give genuine concurrency across separate `db.select()`
// calls here), so fewer statements is the only real lever.
export async function rollPackForUser(
  userId: string,
  packType: PackType,
  // Admin-only debug knob (routes/spin.ts's POST /cheat-foil) — see
  // ownedPacks.forceFoil's comment in schema.ts. Never set for a real grant.
  opts?: { forceFoil?: boolean }
): Promise<{ slots: RolledSlot[]; pity: PityState }> {
  const rows = await db
    .select({ collectible: collectibles, team: teams, ownedCollectibleId: userCollectibles.collectibleId })
    .from(collectibles)
    .innerJoin(teams, eq(collectibles.teamId, teams.id))
    .leftJoin(userCollectibles, and(eq(userCollectibles.collectibleId, collectibles.id), eq(userCollectibles.userId, userId)));

  const byTier: Record<Tier, CollectibleRow[]> = { common: [], rare: [], legendary: [], coach: [] };
  const preOwnedIds = new Set<string>();
  for (const { collectible, team, ownedCollectibleId } of rows) {
    byTier[collectible.tier as Tier].push({ collectible, team });
    if (ownedCollectibleId) preOwnedIds.add(collectible.id);
  }
  for (const tier of Object.keys(byTier) as Tier[]) {
    if (byTier[tier].length === 0) {
      throw new Error(`No ${tier} cards in the catalog to roll`);
    }
  }

  const [pityRow] = await db.select().from(pityCounters).where(eq(pityCounters.userId, userId)).limit(1);
  const streak: PityState = {
    common: pityRow?.commonStreak ?? 0,
    rare: pityRow?.rareStreak ?? 0,
    eliteBigSlot: pityRow?.eliteBigSlotStreak ?? 0,
  };

  const newlyOwnedIds = new Set<string>();
  const slots: RolledSlot[] = PACKS[packType].slots.map((slot) => {
    let tier: Tier;
    if (isBigSlot(slot)) {
      if (streak.eliteBigSlot >= ELITE_BIG_SLOT_PITY_THRESHOLD) {
        // Force onto legendary or coach — weighted by their relative share
        // within this slot's own odds, not a flat coin flip, so a pity
        // trigger still respects legendary being the rarer of the two.
        const legendaryOdds = slot.odds.legendary ?? 0;
        const coachOdds = slot.odds.coach ?? 0;
        tier = Math.random() < legendaryOdds / (legendaryOdds + coachOdds) ? "legendary" : "coach";
      } else {
        tier = rollTier(slot);
      }
      streak.eliteBigSlot = tier === "legendary" || tier === "coach" ? 0 : streak.eliteBigSlot + 1;
    } else {
      tier = rollTier(slot);
    }
    const pool = byTier[tier];

    // Legendary always lands on a card the user doesn't own yet, no streak
    // needed — restores the "a legendary always grants a NEW one" behavior
    // documented for the free wheel (economy-report.ts), which a legendary
    // roll here could silently violate once every pack type (including
    // wheelLegendary) started sharing this same roll path. Falls back to a
    // normal roll only once the whole legendary tier is actually owned —
    // sellValueFor (routes/packs.ts) makes that fallback dupe worth nothing,
    // so there's no exploit in landing on one.
    const forceNewLegendary = tier === "legendary";
    // Coach cards (2026-09-03) get the identical unconditional-forced-new
    // treatment as legendary, not a pity streak — 20 total, "equally
    // special" by design, same reasoning as forceNewLegendary above.
    const forceNewCoach = tier === "coach";
    const forcePity = isPityTier(tier) && streak[tier] >= PITY_THRESHOLD[tier];

    let picked: CollectibleRow;
    if (forceNewLegendary || forceNewCoach || forcePity) {
      const missing = pool.filter((c) => !preOwnedIds.has(c.collectible.id) && !newlyOwnedIds.has(c.collectible.id));
      // If the tier is somehow fully owned already, there's nothing left to
      // force — fall back to a normal roll (it'll just read as a dupe).
      picked = missing.length > 0 ? rollCard(missing) : rollCard(pool);
    } else {
      picked = rollCard(pool);
    }

    const wasDuplicate = preOwnedIds.has(picked.collectible.id) || newlyOwnedIds.has(picked.collectible.id);
    if (isPityTier(tier)) streak[tier] = wasDuplicate ? streak[tier] + 1 : 0;
    if (!wasDuplicate) newlyOwnedIds.add(picked.collectible.id);

    // Only ever rolled for a legendary's first acquisition — a duplicate
    // pull never inserts a new userCollectibles row (see the
    // newlyOwnedIds-only insert in routes/packs.ts), so there'd be nowhere
    // to persist a re-roll anyway.
    const finish: Finish =
      tier === "legendary" && !wasDuplicate && (opts?.forceFoil || Math.random() < FOIL_CHANCE) ? "foil" : "standard";

    return { ...picked, wasDuplicate, finish };
  });

  return { slots, pity: streak };
}
