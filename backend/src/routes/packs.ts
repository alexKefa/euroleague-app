import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, teams, userCollectibles, pointAdjustments, packOpenings, packOpeningResults } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { getUserPoints } from "../services/points.js";
import { PACKS, PackType, Tier, CollectibleRow, rollPack } from "../services/packs.js";

export const packsRouter = Router();

// Cards you already own can still drop from a pack (unlike direct redeem or
// the wheel, which both exclude owned cards) — a duplicate can be cashed in
// immediately for points instead. See packOpeningResults in schema.ts.
const SELL_BACK_RATE = 0.5;

packsRouter.get("/", (_req, res) => {
  res.json(
    Object.values(PACKS).map((p) => ({ type: p.type, label: p.label, pointsCost: p.pointsCost, slots: p.slots.length }))
  );
});

packsRouter.post("/:type/open", requireAuth, async (req, res) => {
  try {
    const packType = req.params.type as PackType;
    const def = PACKS[packType];
    if (!def) {
      res.status(400).json({ error: "Unknown pack type" });
      return;
    }

    const points = await getUserPoints(req.userId!);
    if (points < def.pointsCost) {
      res.status(400).json({ error: "Not enough points" });
      return;
    }

    const [catalogRows, ownedRows] = await Promise.all([
      db.select({ collectible: collectibles, team: teams }).from(collectibles).innerJoin(teams, eq(collectibles.teamId, teams.id)),
      db.select({ collectibleId: userCollectibles.collectibleId }).from(userCollectibles).where(eq(userCollectibles.userId, req.userId!)),
    ]);

    const byTier: Record<Tier, CollectibleRow[]> = { common: [], rare: [], legendary: [] };
    for (const row of catalogRows) {
      byTier[row.collectible.tier as Tier].push(row);
    }
    for (const tier of Object.keys(byTier) as Tier[]) {
      if (byTier[tier].length === 0) {
        res.status(500).json({ error: `No ${tier} cards in the catalog to roll` });
        return;
      }
    }

    const ownedIds = new Set(ownedRows.map((o) => o.collectibleId));
    const rolled = rollPack(packType, byTier);

    const outcome = await db.transaction(async (tx) => {
      const [opening] = await tx
        .insert(packOpenings)
        .values({ userId: req.userId!, packType, pointsCost: def.pointsCost })
        .returning();

      await tx.insert(pointAdjustments).values({
        userId: req.userId!,
        points: -def.pointsCost,
        reason: `Opened ${def.label}`,
        createdByUserId: req.userId!,
      });

      const results = [];
      for (const { collectible, team } of rolled) {
        const wasDuplicate = ownedIds.has(collectible.id);
        if (!wasDuplicate) {
          await tx.insert(userCollectibles).values({ userId: req.userId!, collectibleId: collectible.id });
          ownedIds.add(collectible.id); // rolling the same card twice in one pack shouldn't grant it twice
        }

        const [result] = await tx
          .insert(packOpeningResults)
          .values({ packOpeningId: opening.id, collectibleId: collectible.id, wasDuplicate })
          .returning();

        results.push({
          resultId: result.id,
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
        });
      }

      return { openingId: opening.id, packType, results };
    });

    res.status(201).json(outcome);
  } catch (err) {
    console.error("POST /api/packs/:type/open failed:", err);
    res.status(500).json({ error: "Failed to open pack" });
  }
});

packsRouter.post("/results/:id/sell", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [row] = await db
      .select({ result: packOpeningResults, opening: packOpenings, collectible: collectibles })
      .from(packOpeningResults)
      .innerJoin(packOpenings, eq(packOpeningResults.packOpeningId, packOpenings.id))
      .innerJoin(collectibles, eq(packOpeningResults.collectibleId, collectibles.id))
      .where(eq(packOpeningResults.id, id))
      .limit(1);

    if (!row || row.opening.userId !== req.userId!) {
      res.status(404).json({ error: "Pack result not found" });
      return;
    }
    if (!row.result.wasDuplicate) {
      res.status(400).json({ error: "That card wasn't a duplicate" });
      return;
    }
    if (row.result.soldForPoints !== null) {
      res.status(409).json({ error: "Already sold" });
      return;
    }

    const sellValue = Math.round(row.collectible.pointsCost * SELL_BACK_RATE);

    await db.transaction(async (tx) => {
      await tx.update(packOpeningResults).set({ soldForPoints: sellValue }).where(eq(packOpeningResults.id, id));
      await tx.insert(pointAdjustments).values({
        userId: req.userId!,
        points: sellValue,
        reason: `Sold duplicate: ${row.collectible.name}`,
        createdByUserId: req.userId!,
      });
    });

    res.json({ points: sellValue });
  } catch (err) {
    console.error("POST /api/packs/results/:id/sell failed:", err);
    res.status(500).json({ error: "Failed to sell duplicate" });
  }
});
