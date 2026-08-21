import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, userCollectibles, pointAdjustments, packOpenings, packOpeningResults, ownedPacks } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { getUserPoints } from "../services/points.js";
import { PACKS, PackType, RolledSlot, rollPackForUser } from "../services/packs.js";

export const packsRouter = Router();

// Cards you already own can still drop from a pack (unlike direct redeem or
// the wheel, which both exclude owned cards) — a duplicate can be cashed in
// immediately for points instead. See packOpeningResults in schema.ts.
const SELL_BACK_RATE = 0.5;

packsRouter.get("/", (_req, res) => {
  res.json(
    Object.values(PACKS)
      .filter((p) => p.purchasable !== false)
      .map((p) => ({ type: p.type, label: p.label, pointsCost: p.pointsCost, slots: p.slots.length }))
  );
});

packsRouter.post("/:type/open", requireAuth, async (req, res) => {
  try {
    const packType = req.params.type as PackType;
    const def = PACKS[packType];
    // Wheel-exclusive pack types (wheelStarter/wheelPro/wheelLegendary) are
    // pointsCost: 0 — without this check they'd otherwise be openable for
    // free through this endpoint directly, bypassing the wheel's 24h
    // cooldown entirely (wheelLegendary is a *guaranteed* legendary).
    if (!def || def.purchasable === false) {
      res.status(400).json({ error: "Unknown pack type" });
      return;
    }

    const points = await getUserPoints(req.userId!);
    if (points < def.pointsCost) {
      res.status(400).json({ error: "Not enough points" });
      return;
    }

    // Figuring out duplicates/newly-owned up front (inside rollPackForUser)
    // lets the writes below stay two batched multi-row inserts instead of
    // one round trip per rolled card — each round trip to the (remote)
    // database costs real latency, and that added up to several seconds for
    // a 3-slot pack when done one insert at a time.
    let slots: RolledSlot[];
    try {
      slots = await rollPackForUser(req.userId!, packType);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }
    const newlyOwnedIds = new Set(slots.filter((s) => !s.wasDuplicate).map((s) => s.collectible.id));

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

      if (newlyOwnedIds.size > 0) {
        await tx
          .insert(userCollectibles)
          .values([...newlyOwnedIds].map((collectibleId) => ({ userId: req.userId!, collectibleId })));
      }

      // Multi-row INSERT ... RETURNING preserves VALUES order, so
      // insertedResults[i] lines up with slots[i].
      const insertedResults = await tx
        .insert(packOpeningResults)
        .values(
          slots.map(({ collectible, wasDuplicate }) => ({
            packOpeningId: opening.id,
            collectibleId: collectible.id,
            wasDuplicate,
          }))
        )
        .returning();

      const results = slots.map(({ collectible, team, wasDuplicate }, i) => ({
        resultId: insertedResults[i].id,
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
      }));

      return { openingId: opening.id, packType, results };
    });

    res.status(201).json(outcome);
  } catch (err) {
    console.error("POST /api/packs/:type/open failed:", err);
    res.status(500).json({ error: "Failed to open pack" });
  }
});

// Wheel wins land here unopened (routes/spin.ts) — purchased packs never
// do, they still open immediately via POST /:type/open above.
packsRouter.get("/owned", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(ownedPacks)
      .where(and(eq(ownedPacks.userId, req.userId!), isNull(ownedPacks.openedAt)))
      .orderBy(desc(ownedPacks.acquiredAt));

    res.json(
      rows.map((r) => ({
        id: r.id,
        packType: r.packType,
        label: PACKS[r.packType as PackType]?.label ?? r.packType,
        acquiredAt: r.acquiredAt,
      }))
    );
  } catch (err) {
    console.error("GET /api/packs/owned failed:", err);
    res.status(500).json({ error: "Failed to load your packs" });
  }
});

packsRouter.post("/owned/:id/open", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db.select().from(ownedPacks).where(eq(ownedPacks.id, id)).limit(1);
    if (!row || row.userId !== req.userId!) {
      res.status(404).json({ error: "Pack not found" });
      return;
    }
    if (row.openedAt) {
      res.status(409).json({ error: "Already opened" });
      return;
    }

    const packType = row.packType as PackType;
    let slots: RolledSlot[];
    try {
      slots = await rollPackForUser(req.userId!, packType);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }
    const newlyOwnedIds = new Set(slots.filter((s) => !s.wasDuplicate).map((s) => s.collectible.id));

    const outcome = await db.transaction(async (tx) => {
      // Claim-first, same pattern as roundRewards/referralRewardGranted —
      // whichever request's UPDATE actually flips a null->timestamp row
      // wins; a second concurrent open attempt sees 0 rows and bails below
      // instead of rolling (and granting) a second set of cards.
      const claimed = await tx
        .update(ownedPacks)
        .set({ openedAt: new Date() })
        .where(and(eq(ownedPacks.id, id), isNull(ownedPacks.openedAt)))
        .returning({ id: ownedPacks.id });
      if (claimed.length === 0) return null;

      const [opening] = await tx.insert(packOpenings).values({ userId: req.userId!, packType, pointsCost: 0 }).returning();

      if (newlyOwnedIds.size > 0) {
        await tx
          .insert(userCollectibles)
          .values([...newlyOwnedIds].map((collectibleId) => ({ userId: req.userId!, collectibleId })));
      }

      const insertedResults = await tx
        .insert(packOpeningResults)
        .values(
          slots.map(({ collectible, wasDuplicate }) => ({
            packOpeningId: opening.id,
            collectibleId: collectible.id,
            wasDuplicate,
          }))
        )
        .returning();

      const results = slots.map(({ collectible, team, wasDuplicate }, i) => ({
        resultId: insertedResults[i].id,
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
      }));

      return { openingId: opening.id, packType, results };
    });

    if (!outcome) {
      res.status(409).json({ error: "Already opened" });
      return;
    }

    res.status(201).json(outcome);
  } catch (err) {
    console.error("POST /api/packs/owned/:id/open failed:", err);
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
