import { Router } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, pointAdjustments } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../auth/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/tokens.js";
import { createUniqueReferralCode } from "../services/referrals.js";

export const authRouter = Router();

// Credential guessing / registration spam target — keep this tight. Keyed
// by IP, so a shared network (office wifi, NAT) can still hit the ceiling;
// generous enough for normal typos, not for scripted attempts.
const credentialsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts — try again later." },
});

// Silent refresh calls happen automatically per session/tab, so this needs
// to be far more generous than the login/register limiter.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — try again later." },
});

// Exactly a Regular Season Pack's cost (services/packs.ts's "starter" pack
// — 150pts as of the 2026-08-25 album-economy pass, up from 100) — a new
// account can immediately afford one open, rather than starting completely
// empty with nothing to do until their first correct prediction resolves.
// Points, not a pre-opened pack: reuses the pack-opening flow exactly as
// designed (pick a pack, watch the reveal) instead of a second, bespoke
// "welcome pack" code path.
const WELCOME_BONUS_POINTS = 150;

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
    isAdmin: user.isAdmin,
    referralCode: user.referralCode,
  };
}

authRouter.post("/register", credentialsLimiter, async (req, res) => {
  const { email, password, favoriteTeamId, referralCode } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "email and password (min 8 chars) are required" });
    return;
  }
  if (favoriteTeamId !== undefined && typeof favoriteTeamId !== "string" && favoriteTeamId !== null) {
    res.status(400).json({ error: "favoriteTeamId must be a string or null" });
    return;
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "An account with that email already exists" });
    return;
  }

  // An unrecognized/malformed code is silently ignored rather than
  // rejecting the whole signup over it — worst case, nobody gets a
  // referral bonus, which isn't worth blocking someone's registration for.
  let referredByUserId: string | null = null;
  if (typeof referralCode === "string" && referralCode.length > 0) {
    const [referrer] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.referralCode, referralCode.toUpperCase()))
      .limit(1);
    referredByUserId = referrer?.id ?? null;
  }

  const passwordHash = await hashPassword(password);
  const newReferralCode = await createUniqueReferralCode();
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      favoriteTeamId: favoriteTeamId ?? null,
      referralCode: newReferralCode,
      referredByUserId,
    })
    .returning();

  await db.insert(pointAdjustments).values({
    userId: user.id,
    points: WELCOME_BONUS_POINTS,
    reason: "Welcome bonus",
    createdByUserId: user.id,
  });

  const accessToken = signAccessToken(user.id);
  setRefreshCookie(res, signRefreshToken(user.id));

  res.status(201).json({ user: publicUser(user), accessToken });
});

authRouter.post("/login", credentialsLimiter, async (req, res) => {
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

authRouter.post("/refresh", refreshLimiter, async (req, res) => {
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