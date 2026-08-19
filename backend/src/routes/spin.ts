import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { wheelSpins, userCollectibles } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { pickRandomUnownedLegendary } from "../services/cards.js";

export const spinRouter = Router();

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Odds are deliberately low for a free daily spin — the guaranteed win on
// every spin (as long as you had an unowned legendary) made the wheel
// pointless as a rare-prize mechanic. Round-perfect payouts stay guaranteed
// (services/cards.ts) since that's a reward for a real achievement, not a
// gacha pull.
const WIN_CHANCE = 0.1;

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

    const prize = Math.random() < WIN_CHANCE ? await pickRandomUnownedLegendary(req.userId!) : null;

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
