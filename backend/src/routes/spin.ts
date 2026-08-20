import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { wheelSpins, userCollectibles } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { pickRandomUnownedLegendary, pickRandomUnownedByTier } from "../services/cards.js";

export const spinRouter = Router();

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Every spin now gives *something* — a flat "90% of spins give nothing"
// felt bad for a once-a-day mechanic and didn't reward showing up. The
// legendary rate stays exactly what it was (previously WIN_CHANCE, the
// only outcome besides nothing) so the ~10-day-expected pace already
// reasoned about in scripts/economy-report.ts is unchanged — the old 90%
// of "nothing" outcomes is just filled in with common/rare instead of
// wasted. Round-perfect payouts stay separately guaranteed (services/cards.ts)
// since that's a reward for a real achievement, not a gacha pull.
export const SPIN_ODDS = { common: 0.65, rare: 0.25, legendary: 0.1 } as const;
export const LEGENDARY_CHANCE = SPIN_ODDS.legendary;

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

    // Fall back to common (by far the biggest pool — 208 cards) if the
    // rolled tier happens to be fully owned, rather than handing back
    // nothing — the whole point of this mechanic is that every spin gives
    // *something*. Only a user who's completed the entire catalog ever
    // sees a true null here.
    const rolledTier = rollSpinTier();
    const prize =
      (await pickRandomUnownedByTier(req.userId!, rolledTier)) ??
      (rolledTier === "common" ? null : await pickRandomUnownedByTier(req.userId!, "common"));

    await db.transaction(async (tx) => {
      await tx.insert(wheelSpins).values({ userId: req.userId!, collectibleId: prize?.id ?? null });
      if (prize) {
        await tx.insert(userCollectibles).values({ userId: req.userId!, collectibleId: prize.id });
      }
    });

    res.status(201).json({ won: prize, nextEligibleAt: new Date(Date.now() + COOLDOWN_MS) });
  } catch (err) {
    console.error("POST /api/spin failed:", err);
    res.status(500).json({ error: "Failed to spin" });
  }
});

// Admin-only debug tool for testing the win visual — always grants a
// legendary (if one is left to grant) and deliberately doesn't touch
// wheelSpins, so it never counts against or resets the real 24h cooldown.
spinRouter.post("/cheat", requireAuth, requireAdmin, async (req, res) => {
  try {
    const prize = await pickRandomUnownedLegendary(req.userId!);
    if (prize) {
      await db.insert(userCollectibles).values({ userId: req.userId!, collectibleId: prize.id });
    }
    res.status(201).json({ won: prize, nextEligibleAt: null });
  } catch (err) {
    console.error("POST /api/spin/cheat failed:", err);
    res.status(500).json({ error: "Failed to cheat-spin" });
  }
});
