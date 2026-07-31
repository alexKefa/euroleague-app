import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";

export const usersRouter = Router();

function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    favoriteTeamId: user.favoriteTeamId,
    avatarUrl: user.avatarUrl,
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