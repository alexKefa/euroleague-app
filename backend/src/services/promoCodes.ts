import { eq, and, or, isNull, gt, lt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { promoCodes, promoCodeRedemptions, ownedPacks, pointAdjustments } from "../db/schema.js";

export interface PromoRedemptionResult {
  packType: string;
  quantity: number;
  bonusPoints: number;
}

/**
 * Called with a brand-new user's id at registration (routes/auth.ts) — the
 * original way a promo code applies, same one-shot-at-signup shape as
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
    .returning({
      id: promoCodes.id,
      packType: promoCodes.packType,
      quantity: promoCodes.quantity,
      bonusPoints: promoCodes.bonusPoints,
    });

  if (!claimed) return null;

  await db.insert(ownedPacks).values(
    Array.from({ length: claimed.quantity }, () => ({ userId, packType: claimed.packType, openedAt: null }))
  );

  // Records the redemption for this brand-new account too — see
  // promoCodeRedemptions' own doc comment (schema.ts): without this, the
  // same user could immediately turn around and hit POST
  // /promo-codes/redeem with the exact code they just used at signup and
  // double-dip the reward. onConflictDoNothing is purely defensive here —
  // a fresh user id can't actually collide.
  await db.insert(promoCodeRedemptions).values({ promoCodeId: claimed.id, userId }).onConflictDoNothing();

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

export type PromoRedemptionOutcome = PromoRedemptionResult | { alreadyClaimed: true } | null;

/**
 * The second redemption path (2026-09-13) — an already-registered user
 * hitting POST /api/promo-codes/redeem (routes/promoCodes.ts), e.g. from a
 * QR code scanned at a live event. Unlike redeemPromoCode above, this has
 * to guard per-user reuse explicitly, since nothing here is naturally
 * one-shot the way "applies once, at signup" already was.
 *
 * Claim-first: promoCodeRedemptions is inserted BEFORE the redemption-cap
 * check, via onConflictDoNothing against its (promoCodeId, userId) unique
 * index — same pattern as checkAndGrantRoundRewards (services/cards.ts). If
 * that insert lands no row, this exact user already redeemed this exact
 * code, full stop — returns { alreadyClaimed: true } without touching the
 * cap or granting anything twice. Only once the per-user claim is secured
 * does it attempt the same active/expiry/maxRedemptions-respecting UPDATE
 * redeemPromoCode uses; if that fails (the code expired/got capped in the
 * gap between the two steps), the just-inserted claim row is deleted again
 * so this user isn't permanently locked out of a code that could still be
 * made valid again later (e.g. its cap or expiry raised).
 */
export async function redeemPromoCodeForUser(rawCode: string, userId: string): Promise<PromoRedemptionOutcome> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return null;

  const [promo] = await db.select({ id: promoCodes.id }).from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
  if (!promo) return null;

  const [claim] = await db
    .insert(promoCodeRedemptions)
    .values({ promoCodeId: promo.id, userId })
    .onConflictDoNothing({ target: [promoCodeRedemptions.promoCodeId, promoCodeRedemptions.userId] })
    .returning();
  if (!claim) return { alreadyClaimed: true };

  const [claimed] = await db
    .update(promoCodes)
    .set({ redemptionCount: sql`${promoCodes.redemptionCount} + 1` })
    .where(
      and(
        eq(promoCodes.id, promo.id),
        eq(promoCodes.active, true),
        or(isNull(promoCodes.expiresAt), gt(promoCodes.expiresAt, new Date())),
        or(isNull(promoCodes.maxRedemptions), lt(promoCodes.redemptionCount, promoCodes.maxRedemptions))
      )
    )
    .returning({ packType: promoCodes.packType, quantity: promoCodes.quantity, bonusPoints: promoCodes.bonusPoints });

  if (!claimed) {
    await db.delete(promoCodeRedemptions).where(eq(promoCodeRedemptions.id, claim.id));
    return null;
  }

  await db.insert(ownedPacks).values(
    Array.from({ length: claimed.quantity }, () => ({ userId, packType: claimed.packType, openedAt: null }))
  );

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
