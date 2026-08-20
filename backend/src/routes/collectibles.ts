import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, userCollectibles, teams, users } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";

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

collectiblesRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { name, teamId, tier, pointsCost, imageUrl } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "name is required", code: "INVALID_REQUEST_BODY" });
    return;
  }
  if (typeof teamId !== "string") {
    res.status(400).json({ error: "teamId is required", code: "INVALID_REQUEST_BODY" });
    return;
  }
  if (typeof tier !== "string" || !TIERS.includes(tier as (typeof TIERS)[number])) {
    res.status(400).json({ error: `tier must be one of: ${TIERS.join(", ")}`, code: "INVALID_REQUEST_BODY" });
    return;
  }
  if (typeof pointsCost !== "number" || !Number.isInteger(pointsCost) || pointsCost <= 0) {
    res.status(400).json({ error: "pointsCost must be a positive integer", code: "INVALID_REQUEST_BODY" });
    return;
  }
  if (imageUrl !== undefined && typeof imageUrl !== "string") {
    res.status(400).json({ error: "imageUrl must be a string", code: "INVALID_REQUEST_BODY" });
    return;
  }

  const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) {
    res.status(404).json({ error: "Team not found", code: "TEAM_NOT_FOUND" });
    return;
  }

  const [collectible] = await db
    .insert(collectibles)
    .values({ name: name.trim(), teamId, tier, pointsCost, imageUrl: imageUrl?.trim() || null })
    .returning();

  res.status(201).json(collectible);
});

// Directly grant an existing collectible to a user — an admin tool for
// handing out a specific card (e.g. as a one-off reward or to fix a
// support issue), independent of the normal unlock paths (wheel/packs/
// round rewards).
collectiblesRouter.post("/grant", requireAuth, requireAdmin, async (req, res) => {
  const { email, collectibleId } = req.body ?? {};
  if (typeof email !== "string" || typeof collectibleId !== "string") {
    res.status(400).json({ error: "email and collectibleId are required", code: "INVALID_REQUEST_BODY" });
    return;
  }

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!target) {
    res.status(404).json({ error: "No user with that email", code: "USER_NOT_FOUND" });
    return;
  }

  const [collectible] = await db.select().from(collectibles).where(eq(collectibles.id, collectibleId)).limit(1);
  if (!collectible) {
    res.status(404).json({ error: "Collectible not found", code: "COLLECTIBLE_NOT_FOUND" });
    return;
  }

  const [existing] = await db
    .select({ id: userCollectibles.id })
    .from(userCollectibles)
    .where(and(eq(userCollectibles.userId, target.id), eq(userCollectibles.collectibleId, collectibleId)))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "That user already owns this card", code: "ALREADY_OWNED" });
    return;
  }

  await db.insert(userCollectibles).values({ userId: target.id, collectibleId });

  res.status(201).json({ email, collectible: { id: collectible.id, name: collectible.name } });
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
