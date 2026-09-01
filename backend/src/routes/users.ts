import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, userCollectibles } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";

export const usersRouter = Router();

// Shown next to a user's name on a league leaderboard (routes/leagues.ts) —
// see users.showcaseCollectibleIds's schema comment.
const MAX_SHOWCASE_CARDS = 3;

function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    favoriteTeamId: user.favoriteTeamId,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    referralCode: user.referralCode,
    showcaseCollectibleIds: user.showcaseCollectibleIds,
  };
}

usersRouter.get("/me", requireAuth, async (req, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(publicUser(user));
});

// Which owned cards this user displays next to their name on a league
// leaderboard (routes/leagues.ts) — capped and ownership-checked here, not
// pruned automatically if a showcased card is later traded away (same
// best-effort staleness as trades' wishlist column); the league leaderboard
// silently drops any id it can't resolve to a still-existing collectible.
usersRouter.put("/me/showcase", requireAuth, async (req, res) => {
  const { collectibleIds } = req.body ?? {};
  if (!Array.isArray(collectibleIds) || collectibleIds.some((id) => typeof id !== "string")) {
    res.status(400).json({ error: "collectibleIds must be an array of strings", code: "INVALID_REQUEST_BODY" });
    return;
  }

  const uniqueIds = [...new Set(collectibleIds as string[])];
  if (uniqueIds.length > MAX_SHOWCASE_CARDS) {
    res.status(400).json({
      error: `You can showcase at most ${MAX_SHOWCASE_CARDS} cards`,
      code: "TOO_MANY_SHOWCASE_CARDS",
    });
    return;
  }

  if (uniqueIds.length > 0) {
    const owned = await db
      .select({ collectibleId: userCollectibles.collectibleId })
      .from(userCollectibles)
      .where(and(eq(userCollectibles.userId, req.userId!), inArray(userCollectibles.collectibleId, uniqueIds)));
    if (owned.length !== uniqueIds.length) {
      res.status(400).json({ error: "You can only showcase cards you own", code: "CARD_NOT_OWNED" });
      return;
    }
  }

  const [user] = await db
    .update(users)
    .set({ showcaseCollectibleIds: uniqueIds })
    .where(eq(users.id, req.userId!))
    .returning();

  res.json({ showcaseCollectibleIds: user.showcaseCollectibleIds });
});

usersRouter.patch("/me", requireAuth, async (req, res) => {
  const { favoriteTeamId } = req.body ?? {};
  if (favoriteTeamId !== undefined && typeof favoriteTeamId !== "string" && favoriteTeamId !== null) {
    res.status(400).json({ error: "favoriteTeamId must be a string or null" });
    return;
  }

  const [user] = await db
    .update(users)
    .set({ favoriteTeamId: favoriteTeamId ?? null })
    .where(eq(users.id, req.userId!))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(publicUser(user));
});