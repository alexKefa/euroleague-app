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
// The legendary rate stays exactly what it was, so the ~10-day-expected
// pace already reasoned about in scripts/economy-report.ts is unchanged.
export const SPIN_ODDS = { common: 0.65, rare: 0.25, legendary: 0.1 } as const;
export const LEGENDARY_CHANCE = SPIN_ODDS.legendary;

const WHEEL_PACK_BY_TIER: Record<keyof typeof SPIN_ODDS, PackType> = {
  common: "wheelStarter",
  rare: "wheelPro",
  legendary: "wheelLegendary",
};

function rollSpinTier(): "common" | "rare" | "legendary" {
  const roll = Math.random();
  if (roll < SPIN_ODDS.legendary) return "legendary";
  if (roll < SPIN_ODDS.legendary + SPIN_ODDS.rare) return "rare";
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
