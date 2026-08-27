import { eq, and, or, isNull, gt, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { promoCodes, ownedPacks, pointAdjustments } from "../db/schema.js";

export interface PromoRedemptionResult {
  packType: string;
  bonusPoints: number;
}

/**
 * Called with a brand-new user's id at registration (routes/auth.ts) — the
 * only place a promo code ever applies, same one-shot-at-signup shape as
 * users.referralCode. Returns null for any invalid/expired/exhausted/
 * inactive code, which the caller treats the same way as an unrecognized
 * referral code: silently ignored rather than failing the signup.
 *
 * The UPDATE's WHERE clause re-checks active/expiry/redemption-cap against
 * whatever the row's *current* committed state is, and Postgres row-locks
 * during the UPDATE itself — so two concurrent registrations racing for the
 * last redemption on a capped code can't both succeed. Whichever commits
 * first bumps redemptionCount; the second's WHERE then sees the
 * already-incremented count and matches zero rows, same claim-first pattern
 * as roundRewards/referralRewardGranted elsewhere in this codebase.
 */
export async function redeemPromoCode(rawCode: string, userId: string): Promise<PromoRedemptionResult | null> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;

  const [claimed] = await db
    .update(promoCodes)
    .set({ redemptionCount: sql`${promoCodes.redemptionCount} + 1` })
    .where(
      and(
        eq(promoCodes.code, code),
        eq(promoCodes.active, true),
        or(isNull(promoCodes.expiresAt), gt(promoCodes.expiresAt, new Date())),
        or(isNull(promoCodes.maxRedemptions), lt(promoCodes.redemptionCount, promoCodes.maxRedemptions))
      )
    )
    .returning({ packType: promoCodes.packType, bonusPoints: promoCodes.bonusPoints });

  if (!claimed) return null;

  await db.insert(ownedPacks).values({ userId, packType: claimed.packType, openedAt: null });

  if (claimed.bonusPoints > 0) {
    await db.insert(pointAdjustments).values({
      userId,
      points: claimed.bonusPoints,
      reason: "Promo code bonus",
      createdByUserId: userId,
    });
  }

  return claimed;
}
