import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, predictions, games, pointAdjustments } from "../db/schema.js";
import { computeWinnerTeamId } from "./points.js";

// Excludes 0/O and 1/I/L — a code meant to be read aloud or typed by hand
// shouldn't hinge on telling those apart.
const CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/** A code not already in use — collisions are astronomically unlikely at this length, but check anyway. */
export async function createUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code)).limit(1);
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique referral code");
}

// Matches a "Playoffs Pack" (services/packs.ts's "pro" tier) — bigger than
// the flat 100-point registration bonus on purpose: this one takes a real
// referred friend actually engaging (see the trigger check below), not
// just an email address.
const REFERRAL_REWARD_POINTS = 400;

/**
 * Call with the *referred* user's id (i.e. from whatever request is already
 * in that user's own session — same opportunistic-check pattern as
 * checkAndGrantRoundRewards). If they were referred, haven't already
 * triggered their referrer's reward, and have at least one resolved
 * correct prediction, grants the referrer REFERRAL_REWARD_POINTS and
 * flips referralRewardGranted so it can never fire twice for the same
 * referred user.
 */
export async function checkAndGrantReferralReward(referredUserId: string): Promise<void> {
  const [referred] = await db
    .select({ referredByUserId: users.referredByUserId, referralRewardGranted: users.referralRewardGranted })
    .from(users)
    .where(eq(users.id, referredUserId))
    .limit(1);

  if (!referred?.referredByUserId || referred.referralRewardGranted) return;

  const rows = await db
    .select({ prediction: predictions, game: games })
    .from(predictions)
    .innerJoin(games, eq(predictions.gameId, games.id))
    .where(and(eq(predictions.userId, referredUserId), isNotNull(games.round)));

  const hasCorrectPick = rows.some(({ prediction, game }) => {
    const winnerTeamId = computeWinnerTeamId(game);
    return winnerTeamId !== null && winnerTeamId === prediction.predictedWinnerTeamId;
  });
  if (!hasCorrectPick) return;

  // Flip the guard first, in the same spirit as round-rewards' claim-first
  // pattern — if two requests from the referred user's session race here,
  // whichever's UPDATE actually changes a row (via the WHERE clause below)
  // is the one that proceeds; the other sees 0 rows affected and stops.
  const [claimed] = await db
    .update(users)
    .set({ referralRewardGranted: true })
    .where(and(eq(users.id, referredUserId), eq(users.referralRewardGranted, false)))
    .returning({ id: users.id });
  if (!claimed) return;

  await db.insert(pointAdjustments).values({
    userId: referred.referredByUserId,
    points: REFERRAL_REWARD_POINTS,
    reason: "Referral bonus",
    createdByUserId: referredUserId,
  });
}
