import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, userCollectibles, teams, pointAdjustments } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { getUserPoints } from "../services/points.js";

export const collectiblesRouter = Router();

const TIERS = ["common", "rare", "legendary"] as const;

collectiblesRouter.get("/", async (_req, res) => {
  try {
    const rows = await db
      .select({ collectible: collectibles, team: teams })
      .from(collectibles)
      .innerJoin(teams, eq(collectibles.teamId, teams.id));

    const payload = rows.map(({ collectible, team }) => ({
      id: collectible.id,
      name: collectible.name,
      tier: collectible.tier,
      pointsCost: collectible.pointsCost,
      imageUrl: collectible.imageUrl,
      team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor },
    }));

    res.json(payload);
  } catch (err) {
    console.error("GET /api/collectibles failed:", err);
    res.status(500).json({ error: "Failed to load collectibles" });
  }
});

collectiblesRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select({ collectibleId: userCollectibles.collectibleId, unlockedAt: userCollectibles.unlockedAt })
      .from(userCollectibles)
      .where(eq(userCollectibles.userId, req.userId!));

    res.json(rows);
  } catch (err) {
    console.error("GET /api/collectibles/me failed:", err);
    res.status(500).json({ error: "Failed to load your collection" });
  }
});

collectiblesRouter.post("/:id/redeem", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [collectible] = await db.select().from(collectibles).where(eq(collectibles.id, id)).limit(1);
    if (!collectible) {
      res.status(404).json({ error: "Collectible not found" });
      return;
    }

    const [existing] = await db
      .select({ id: userCollectibles.id })
      .from(userCollectibles)
      .where(and(eq(userCollectibles.userId, req.userId!), eq(userCollectibles.collectibleId, id)))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "You already unlocked this one" });
      return;
    }

    const points = await getUserPoints(req.userId!);
    if (points < collectible.pointsCost) {
      res.status(400).json({ error: "Not enough points" });
      return;
    }

    const [unlock] = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(userCollectibles)
        .values({ userId: req.userId!, collectibleId: id })
        .returning();
      await tx.insert(pointAdjustments).values({
        userId: req.userId!,
        points: -collectible.pointsCost,
        reason: `Redeemed: ${collectible.name}`,
        createdByUserId: req.userId!,
      });
      return inserted;
    });

    res.status(201).json(unlock);
  } catch (err) {
    console.error("POST /api/collectibles/:id/redeem failed:", err);
    res.status(500).json({ error: "Failed to redeem collectible" });
  }
});

collectiblesRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { name, teamId, tier, pointsCost, imageUrl } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (typeof teamId !== "string") {
    res.status(400).json({ error: "teamId is required" });
    return;
  }
  if (typeof tier !== "string" || !TIERS.includes(tier as (typeof TIERS)[number])) {
    res.status(400).json({ error: `tier must be one of: ${TIERS.join(", ")}` });
    return;
  }
  if (typeof pointsCost !== "number" || !Number.isInteger(pointsCost) || pointsCost <= 0) {
    res.status(400).json({ error: "pointsCost must be a positive integer" });
    return;
  }
  if (imageUrl !== undefined && typeof imageUrl !== "string") {
    res.status(400).json({ error: "imageUrl must be a string" });
    return;
  }

  const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const [collectible] = await db
    .insert(collectibles)
    .values({ name: name.trim(), teamId, tier, pointsCost, imageUrl: imageUrl?.trim() || null })
    .returning();

  res.status(201).json(collectible);
});

collectiblesRouter.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { imageUrl } = req.body ?? {};
  if (imageUrl !== undefined && typeof imageUrl !== "string") {
    res.status(400).json({ error: "imageUrl must be a string" });
    return;
  }

  const [collectible] = await db
    .update(collectibles)
    .set({ imageUrl: imageUrl?.trim() || null })
    .where(eq(collectibles.id, id))
    .returning();

  if (!collectible) {
    res.status(404).json({ error: "Collectible not found" });
    return;
  }

  res.json(collectible);
});
