import { Router } from "express";
import rateLimit from "express-rate-limit";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, pointAdjustments, teamSeasonStats } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../auth/hash.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/tokens.js";
import { createUniqueReferralCode } from "../services/referrals.js";
import { createUniqueUsername, isUsernameTaken, isValidUsername } from "../services/username.js";
import { redeemPromoCode } from "../services/promoCodes.js";
import { getCurrentSeason } from "../services/season.js";

export const authRouter = Router();

// Picks a random team from the current competition (team_season_stats only
// ever has a row for a team actually in getCurrentSeason() — same scoping
// GET /teams uses to keep an out-of-competition team like AS Monaco from
// being assignable) so a registration with no team picked still gets a
// personalized reskin instead of sitting on the default blue indefinitely.
async function randomFavoriteTeamId(): Promise<string | null> {
  const season = await getCurrentSeason();
  if (!season) return null;
  const [row] = await db
    .select({ teamId: teamSeasonStats.teamId })
    .from(teamSeasonStats)
    .where(eq(teamSeasonStats.season, season))
    .orderBy(sql`random()`)
    .limit(1);
  return row?.teamId ?? null;
}

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
    username: user.username,
    favoriteTeamId: user.favoriteTeamId,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    referralCode: user.referralCode,
  };
}

authRouter.post("/register", credentialsLimiter, async (req, res) => {
  const { email, password, username, favoriteTeamId, referralCode, promoCode } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "email and password (min 8 chars) are required" });
    return;
  }
  if (favoriteTeamId !== undefined && typeof favoriteTeamId !== "string" && favoriteTeamId !== null) {
    res.status(400).json({ error: "favoriteTeamId must be a string or null" });
    return;
  }
  // Optional — a blank/omitted username falls back to createUniqueUsername()
  // below, same generated handle pre-username accounts always got.
  const trimmedUsername = typeof username === "string" ? username.trim() : "";
  if (trimmedUsername.length > 0 && !isValidUsername(trimmedUsername)) {
    res.status(400).json({
      error: "Username must be 3-20 characters: letters, numbers, and underscores only",
      code: "INVALID_USERNAME",
    });
    return;
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "An account with that email already exists", code: "EMAIL_TAKEN" });
    return;
  }

  if (trimmedUsername.length > 0 && (await isUsernameTaken(trimmedUsername))) {
    res.status(409).json({ error: "That username is already taken", code: "USERNAME_TAKEN" });
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
  const newUsername = trimmedUsername.length > 0 ? trimmedUsername : await createUniqueUsername();
  // A skipped team picker used to leave favoriteTeamId permanently null —
  // default to a random current-competition team instead, so every account
  // gets the personalized reskin from day one rather than the generic blue.
  const resolvedFavoriteTeamId = favoriteTeamId ?? (await randomFavoriteTeamId());
  const [user] = await db
    .insert(users)
    .values({
      email,
      username: newUsername,
      passwordHash,
      favoriteTeamId: resolvedFavoriteTeamId,
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

  // Same "silently ignore an invalid code rather than fail the signup"
  // philosophy as referralCode above — worst case, no promo bonus, which
  // isn't worth blocking registration over. `promo` in the response lets
  // the frontend show a confirmation when it *did* apply.
  let promo = null;
  if (typeof promoCode === "string" && promoCode.length > 0) {
    promo = await redeemPromoCode(promoCode, user.id);
  }

  const accessToken = signAccessToken(user.id);
  setRefreshCookie(res, signRefreshToken(user.id));

  res.status(201).json({ user: publicUser(user), accessToken, promo });
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