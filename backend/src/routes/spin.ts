import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { wheelSpins, ownedPacks } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { PACKS, PackType } from "../services/packs.js";

export const spinRouter = Router();

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Every spin gives *something* — a flat "90% of spins give nothing" felt
// bad for a once-a-day mechanic and didn't reward showing up. These odds
// pick which wheel-exclusive pack (services/packs.ts) the spin grants —
// unopened, into owned_packs — rather than a tier to roll on the spot; the
// user opens it later from the Packs page's inventory, whenever they want.
//
// 65/25/10 -> 63/23/14 (2026-08-25, "album completable in a season" pass):
// simulating the real pity mechanics against the 208-common/208-rare/
// 22-legendary catalog showed legendary was the last bottleneck once
// wheelStarter/wheelPro were made rare-heavy (see the slots comment in
// services/packs.ts) — commons and rares were reliably finishing by ~day
// 165-190 of a ~210-day season, but legendary's old 10%/day rate only
// expects ~21 pulls across a season against 22 needed, so plenty of runs
// fell 1-2 short right at the finish line. Bumping to 14% (~29 expected
// pulls/season) fixed that without making legendary feel routine — see
// scripts/economy-report.ts's LEGENDARY_CHANCE-derived pacing math, which
// updates automatically from this constant.
// 63/23/14 -> 58/20/14/8 (2026-09-03, coach cards added): legendary is the
// tightest completion bottleneck (see the 2026-08-25 pass above) — an
// earlier attempt at this change shaved legendary 14->11 to make room for
// coach and re-simulating showed a real regression (85%-engagement,
// 50-65% accuracy full-album completion dropped from the documented
// ~91-98%/day~160-181 down to 57-70%/day~179-185). Reverted legendary back
// to its exact original 14% and took coach's 8% out of common+rare instead
// (63->58, 23->20) — both tiers already reliably hit 100% completion well
// before season end regardless (see the "commons+rares only" column below),
// so a few points off their wheel share costs comparatively little.
export const SPIN_ODDS = { common: 0.58, rare: 0.2, legendary: 0.14, coach: 0.08 } as const;
export const LEGENDARY_CHANCE = SPIN_ODDS.legendary;
export const COACH_CHANCE = SPIN_ODDS.coach;

const WHEEL_PACK_BY_TIER: Record<keyof typeof SPIN_ODDS, PackType> = {
  common: "wheelStarter",
  rare: "wheelPro",
  legendary: "wheelLegendary",
  coach: "wheelCoach",
};

function rollSpinTier(): "common" | "rare" | "legendary" | "coach" {
  const roll = Math.random();
  if (roll < SPIN_ODDS.coach) return "coach";
  if (roll < SPIN_ODDS.coach + SPIN_ODDS.legendary) return "legendary";
  if (roll < SPIN_ODDS.coach + SPIN_ODDS.legendary + SPIN_ODDS.rare) return "rare";
  return "common";
}

async function getSpinStatus(userId: string) {
  const [last] = await db
    .select({ spunAt: wheelSpins.spunAt })
    .from(wheelSpins)
    .where(eq(wheelSpins.userId, userId))
    .orderBy(desc(wheelSpins.spunAt))
    .limit(1);

  if (!last) return { canSpin: true, nextEligibleAt: null };

  const nextEligibleAt = new Date(new Date(last.spunAt).getTime() + COOLDOWN_MS);
  const canSpin = Date.now() >= nextEligibleAt.getTime();
  return { canSpin, nextEligibleAt: canSpin ? null : nextEligibleAt };
}

spinRouter.get("/", requireAuth, async (req, res) => {
  try {
    res.json(await getSpinStatus(req.userId!));
  } catch (err) {
    console.error("GET /api/spin failed:", err);
    res.status(500).json({ error: "Failed to load spin status" });
  }
});

spinRouter.post("/", requireAuth, async (req, res) => {
  try {
    const status = await getSpinStatus(req.userId!);
    if (!status.canSpin) {
      res.status(429).json({ error: "Come back later for your next spin", nextEligibleAt: status.nextEligibleAt });
      return;
    }

    const rolledTier = rollSpinTier();
    const packType = WHEEL_PACK_BY_TIER[rolledTier];

    const [wonPack] = await db.transaction(async (tx) => {
      await tx.insert(wheelSpins).values({ userId: req.userId! });
      return tx.insert(ownedPacks).values({ userId: req.userId!, packType }).returning();
    });

    res.status(201).json({
      // No card yet — the pack sits unopened in the user's inventory
      // (GET /api/packs/owned) until they open it themselves from the
      // Packs page via POST /api/packs/owned/:id/open.
      wonPack: { id: wonPack.id, packType, label: PACKS[packType].label, tier: rolledTier },
      nextEligibleAt: new Date(Date.now() + COOLDOWN_MS),
    });
  } catch (err) {
    console.error("POST /api/spin failed:", err);
    res.status(500).json({ error: "Failed to spin" });
  }
});

// Admin-only debug tool for testing the win visual — grants a legendary
// pack straight into the inventory, bypassing the odds roll, and
// deliberately doesn't touch wheelSpins, so it never counts against or
// resets the real 24h cooldown. Still opened through the normal My Packs
// flow, so this exercises the real open path too, not just the win banner.
spinRouter.post("/cheat", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [wonPack] = await db.insert(ownedPacks).values({ userId: req.userId!, packType: "wheelLegendary" }).returning();
    res.status(201).json({
      wonPack: { id: wonPack.id, packType: "wheelLegendary", label: PACKS.wheelLegendary.label, tier: "legendary" },
      nextEligibleAt: null,
    });
  } catch (err) {
    console.error("POST /api/spin/cheat failed:", err);
    res.status(500).json({ error: "Failed to cheat-spin" });
  }
});

// Same debug tool as /cheat above, for the coach pool instead — otherwise
// verifying the jade card visual means waiting on an 8% wheel / 5.5%
// elite-pack-slot chance.
spinRouter.post("/cheat-coach", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [wonPack] = await db.insert(ownedPacks).values({ userId: req.userId!, packType: "wheelCoach" }).returning();
    res.status(201).json({
      wonPack: { id: wonPack.id, packType: "wheelCoach", label: PACKS.wheelCoach.label, tier: "coach" },
      nextEligibleAt: null,
    });
  } catch (err) {
    console.error("POST /api/spin/cheat-coach failed:", err);
    res.status(500).json({ error: "Failed to cheat-spin coach" });
  }
});

// Same debug tool as /cheat above, plus forceFoil — otherwise a foil is
// still just a FOIL_CHANCE coin flip on open, same as any real legendary
// pull, which defeats the point of a button meant to reliably show the
// foil visual/verify foil-dependent features (trades, inventory, etc.).
spinRouter.post("/cheat-foil", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [wonPack] = await db
      .insert(ownedPacks)
      .values({ userId: req.userId!, packType: "wheelLegendary", forceFoil: true })
      .returning();
    res.status(201).json({
      wonPack: { id: wonPack.id, packType: "wheelLegendary", label: PACKS.wheelLegendary.label, tier: "legendary" },
      nextEligibleAt: null,
    });
  } catch (err) {
    console.error("POST /api/spin/cheat-foil failed:", err);
    res.status(500).json({ error: "Failed to cheat-spin foil" });
  }
});
