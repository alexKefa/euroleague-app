import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../auth/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/tokens.js";

export const authRouter = Router();

const REFRESH_COOKIE_NAME = "refreshToken";
// Keep this in sync with JWT_REFRESH_EXPIRES_IN in .env (default 30d).
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function setRefreshCookie(res: import("express").Response, token: string) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

function publicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    favoriteTeamId: user.favoriteTeamId,
    avatarUrl: user.avatarUrl,
  };
}

authRouter.post("/register", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "email and password (min 8 chars) are required" });
    return;
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(users).values({ email, passwordHash }).returning();

  const accessToken = signAccessToken(user.id);
  setRefreshCookie(res, signRefreshToken(user.id));

  res.status(201).json({ user: publicUser(user), accessToken });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const accessToken = signAccessToken(user.id);
  setRefreshCookie(res, signRefreshToken(user.id));

  res.json({ user: publicUser(user), accessToken });
});

authRouter.post("/refresh", async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: "Missing refresh token" });
    return;
  }

  try {
    const payload = verifyRefreshToken(token);
    const accessToken = signAccessToken(payload.sub);
    // Rotate the refresh token on each use.
    setRefreshCookie(res, signRefreshToken(payload.sub));
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
  res.status(204).send();
});