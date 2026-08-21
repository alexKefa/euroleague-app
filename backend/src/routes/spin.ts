import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { wheelSpins, userCollectibles, collectibles, teams, packOpenings, packOpeningResults } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { pickRandomUnownedLegendary } from "../services/cards.js";
import { PackType, Tier, CollectibleRow, rollPack } from "../services/packs.js";

export const spinRouter = Router();

// Matches packs.ts's SELL_BACK_RATE exactly — a duplicate from the wheel is
// worth the same as a duplicate from a purchased pack, same underlying
// packOpeningResults row and sell endpoint either way.
const SELL_BACK_RATE = 0.5;

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Every spin gives *something* — a flat "90% of spins give nothing" felt
// bad for a once-a-day mechanic and didn't reward showing up. These odds
// now pick which wheel-exclusive pack (services/packs.ts) gets opened
// instead of picking a tier directly — routing the reward through the same
// rollPack()/packOpenings machinery as a real purchase means a wheel spin
// can land on a card the user already owns (previously impossible; the old
// direct-grant always picked an unowned card), which is what actually
// unlocks the existing pack-duplicate sell-back for wheel spins too. The
// legendary rate stays exactly what it was, so the ~10-day-expected pace
// already reasoned about in scripts/economy-report.ts is unchanged.
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

    const [catalogRows, ownedRows] = await Promise.all([
      db.select({ collectible: collectibles, team: teams }).from(collectibles).innerJoin(teams, eq(collectibles.teamId, teams.id)),
      db.select({ collectibleId: userCollectibles.collectibleId }).from(userCollectibles).where(eq(userCollectibles.userId, req.userId!)),
    ]);

    const byTier: Record<Tier, CollectibleRow[]> = { common: [], rare: [], legendary: [] };
    for (const row of catalogRows) {
      byTier[row.collectible.tier as Tier].push(row);
    }
    if (byTier[rolledTier].length === 0) {
      res.status(500).json({ error: `No ${rolledTier} cards in the catalog to roll` });
      return;
    }

    const ownedIds = new Set(ownedRows.map((o) => o.collectibleId));
    const [{ collectible, team }] = rollPack(packType, byTier);
    const wasDuplicate = ownedIds.has(collectible.id);

    const outcome = await db.transaction(async (tx) => {
      const [opening] = await tx.insert(packOpenings).values({ userId: req.userId!, packType, pointsCost: 0 }).returning();
      await tx.insert(wheelSpins).values({ userId: req.userId!, collectibleId: collectible.id });
      if (!wasDuplicate) {
        await tx.insert(userCollectibles).values({ userId: req.userId!, collectibleId: collectible.id });
      }
      const [result] = await tx
        .insert(packOpeningResults)
        .values({ packOpeningId: opening.id, collectibleId: collectible.id, wasDuplicate })
        .returning();
      return { resultId: result.id };
    });

    res.status(201).json({
      // Same shape as a pack-opening result card (core/models.ts's
      // PackOpenResultCard on the frontend) — this reward is now a
      // pack-opening result, just always a single-slot one.
      won: {
        resultId: outcome.resultId,
        collectible: {
          id: collectible.id,
          name: collectible.name,
          tier: collectible.tier,
          pointsCost: collectible.pointsCost,
          imageUrl: collectible.imageUrl,
          team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor },
        },
        wasDuplicate,
        sellValue: wasDuplicate ? Math.round(collectible.pointsCost * SELL_BACK_RATE) : null,
      },
      nextEligibleAt: new Date(Date.now() + COOLDOWN_MS),
    });
  } catch (err) {
    console.error("POST /api/spin failed:", err);
    res.status(500).json({ error: "Failed to spin" });
  }
});

// Admin-only debug tool for testing the win visual — always grants a
// legendary directly (not routed through packOpenings; this is a shortcut
// for eyeballing the reveal, not a real economy event) and deliberately
// doesn't touch wheelSpins, so it never counts against or resets the real
// 24h cooldown.
spinRouter.post("/cheat", requireAuth, requireAdmin, async (req, res) => {
  try {
    const prize = await pickRandomUnownedLegendary(req.userId!);
    if (prize) {
      await db.insert(userCollectibles).values({ userId: req.userId!, collectibleId: prize.id });
    }
    // Same nested shape as a real spin's response — always a fresh
    // unowned legendary (pickRandomUnownedLegendary never returns an
    // already-owned card), so wasDuplicate/sellValue are always
    // false/null here and resultId is a placeholder: there's no real
    // packOpeningResults row backing this shortcut, and the "sell
    // duplicate" action is never reachable for a result that's never a
    // duplicate.
    res.status(201).json({
      won: prize ? { resultId: "cheat", collectible: prize, wasDuplicate: false, sellValue: null } : null,
      nextEligibleAt: null,
    });
  } catch (err) {
    console.error("POST /api/spin/cheat failed:", err);
    res.status(500).json({ error: "Failed to cheat-spin" });
  }
});
