import { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { userCollectibles, pointAdjustments, packOpenings, packOpeningResults, ownedPacks, pityCounters } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { getUserPoints } from "../services/points.js";
import { PACKS, PackType, RolledSlot, PityState, rollPackForUser } from "../services/packs.js";

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

// A rolled slot's sell value if it's a duplicate, else null — computed once
// up front so it can be written straight into packOpeningResults.soldForPoints
// at insert time. Duplicates are auto-sold the instant they're rolled
// (no separate confirm step) — leaving that to a later manual action meant
// a card the player never got back to selling just forfeited its value
// with no way to reclaim it, since nothing outside the reveal screen ever
// surfaced an unsold duplicate again.
//
// Legendary duplicates are excluded on purpose (2026-08-25): legendary
// pointsCost runs up to 10,000 in the catalog (it's a "collector value"
// display number, never an actual purchase price — legendaries aren't
// purchasable), and 50% of that is a 5,000pt refund for a single duplicate
// pull. Once rollPackForUser can land a legendary duplicate at all (it can —
// see the "wheel win can land on an owned card" note in packs.ts), that
// turns Elite packs and the wheel's legendary slot into a real infinite-money
// exploit for anyone who's collected most of the legendary tier, directly
// contradicting "legendaries can't be bought with points at any price, only
// won." A duplicate legendary is just a keepsake now — no refund. Coach
// duplicates (2026-09-03) get the identical exclusion, same reasoning —
// coach's own 5,000pt collector-value pointsCost would be the same exploit.
function sellValueFor(slot: RolledSlot): number | null {
  if (slot.collectible.tier === "legendary" || slot.collectible.tier === "coach") return null;
  return slot.wasDuplicate ? Math.round(slot.collectible.pointsCost * SELL_BACK_RATE) : null;
}

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

    let slots: RolledSlot[];
    let pity: PityState;
    try {
      ({ slots, pity } = await rollPackForUser(req.userId!, packType));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }
    const newlyOwnedIds = new Set(slots.filter((s) => !s.wasDuplicate).map((s) => s.collectible.id));
    const finishByCollectibleId = new Map(slots.filter((s) => !s.wasDuplicate).map((s) => [s.collectible.id, s.finish]));
    const sellValues = slots.map(sellValueFor);

    const outcome = await db.transaction(async (tx) => {
      const [opening] = await tx
        .insert(packOpenings)
        .values({ userId: req.userId!, packType, pointsCost: def.pointsCost })
        .returning();

      // One batched insert for the purchase cost plus every auto-sold
      // duplicate, instead of a round trip per row.
      const pointAdjustmentRows = [
        {
          userId: req.userId!,
          points: -def.pointsCost,
          reason: `Opened ${def.label}`,
          createdByUserId: req.userId!,
          // Spending points on a pack shouldn't lower a predictor's
          // leaderboard rank — see the column's comment in schema.ts.
          countsTowardRanking: false,
        },
        ...slots
          .map((s, i) => ({ slot: s, sellValue: sellValues[i] }))
          .filter((r) => r.sellValue !== null)
          .map(({ slot, sellValue }) => ({
            userId: req.userId!,
            points: sellValue!,
            reason: `Sold duplicate: ${slot.collectible.name}`,
            createdByUserId: req.userId!,
          })),
      ];
      await tx.insert(pointAdjustments).values(pointAdjustmentRows);

      await tx
        .insert(pityCounters)
        .values({ userId: req.userId!, commonStreak: pity.common, rareStreak: pity.rare, eliteBigSlotStreak: pity.eliteBigSlot })
        .onConflictDoUpdate({
          target: pityCounters.userId,
          set: { commonStreak: pity.common, rareStreak: pity.rare, eliteBigSlotStreak: pity.eliteBigSlot },
        });

      if (newlyOwnedIds.size > 0) {
        await tx.insert(userCollectibles).values(
          [...newlyOwnedIds].map((collectibleId) => ({
            userId: req.userId!,
            collectibleId,
            finish: finishByCollectibleId.get(collectibleId) ?? "standard",
          }))
        );
      }

      // Multi-row INSERT ... RETURNING preserves VALUES order, so
      // insertedResults[i] lines up with slots[i].
      const insertedResults = await tx
        .insert(packOpeningResults)
        .values(
          slots.map(({ collectible, wasDuplicate }, i) => ({
            packOpeningId: opening.id,
            collectibleId: collectible.id,
            wasDuplicate,
            soldForPoints: sellValues[i],
          }))
        )
        .returning();

      const results = slots.map(({ collectible, team, wasDuplicate, finish }, i) => ({
        resultId: insertedResults[i].id,
        collectible: {
          id: collectible.id,
          name: collectible.name,
          tier: collectible.tier,
          pointsCost: collectible.pointsCost,
          imageUrl: collectible.imageUrl,
          team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor },
          finish,
        },
        wasDuplicate,
        sellValue: sellValues[i],
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
    let pity: PityState;
    try {
      ({ slots, pity } = await rollPackForUser(req.userId!, packType, { forceFoil: row.forceFoil }));
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }
    const newlyOwnedIds = new Set(slots.filter((s) => !s.wasDuplicate).map((s) => s.collectible.id));
    const finishByCollectibleId = new Map(slots.filter((s) => !s.wasDuplicate).map((s) => [s.collectible.id, s.finish]));
    const sellValues = slots.map(sellValueFor);

    const outcome = await db.transaction(async (tx) => {
      // Claim-first, same pattern as roundRewards/referralRewardGranted —
      // whichever request's UPDATE actually flips a null->timestamp row
      // wins; a second concurrent open attempt sees 0 rows and bails below
      // instead of rolling (and granting) a second set of cards. The pity
      // streak from this roll is discarded along with everything else in
      // that case — it was never actually "used".
      const claimed = await tx
        .update(ownedPacks)
        .set({ openedAt: new Date() })
        .where(and(eq(ownedPacks.id, id), isNull(ownedPacks.openedAt)))
        .returning({ id: ownedPacks.id });
      if (claimed.length === 0) return null;

      const [opening] = await tx.insert(packOpenings).values({ userId: req.userId!, packType, pointsCost: 0 }).returning();

      await tx
        .insert(pityCounters)
        .values({ userId: req.userId!, commonStreak: pity.common, rareStreak: pity.rare, eliteBigSlotStreak: pity.eliteBigSlot })
        .onConflictDoUpdate({
          target: pityCounters.userId,
          set: { commonStreak: pity.common, rareStreak: pity.rare, eliteBigSlotStreak: pity.eliteBigSlot },
        });

      const dupeSaleRows = slots
        .map((s, i) => ({ slot: s, sellValue: sellValues[i] }))
        .filter((r) => r.sellValue !== null)
        .map(({ slot, sellValue }) => ({
          userId: req.userId!,
          points: sellValue!,
          reason: `Sold duplicate: ${slot.collectible.name}`,
          createdByUserId: req.userId!,
        }));

      if (dupeSaleRows.length > 0) {
        await tx.insert(pointAdjustments).values(dupeSaleRows);
      }

      if (newlyOwnedIds.size > 0) {
        await tx.insert(userCollectibles).values(
          [...newlyOwnedIds].map((collectibleId) => ({
            userId: req.userId!,
            collectibleId,
            finish: finishByCollectibleId.get(collectibleId) ?? "standard",
          }))
        );
      }

      const insertedResults = await tx
        .insert(packOpeningResults)
        .values(
          slots.map(({ collectible, wasDuplicate }, i) => ({
            packOpeningId: opening.id,
            collectibleId: collectible.id,
            wasDuplicate,
            soldForPoints: sellValues[i],
          }))
        )
        .returning();

      const results = slots.map(({ collectible, team, wasDuplicate, finish }, i) => ({
        resultId: insertedResults[i].id,
        collectible: {
          id: collectible.id,
          name: collectible.name,
          tier: collectible.tier,
          pointsCost: collectible.pointsCost,
          imageUrl: collectible.imageUrl,
          team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor },
          finish,
        },
        wasDuplicate,
        sellValue: sellValues[i],
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

