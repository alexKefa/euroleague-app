/**
 * Create (or update) a promo code — redeemable either at registration (e.g.
 * a link dropped in a YouTube video description, getclutchapp.com/register
 * ?promo=CODE) or, since 2026-09-13, by an already-logged-in user via
 * POST /api/promo-codes/redeem (e.g. a QR flyer at a live event, which
 * should point at getclutchapp.com/claim?promo=CODE instead — see
 * features/claim/claim.ts). See services/promoCodes.ts for the redemption
 * logic and routes/auth.ts / routes/promoCodes.ts for where each is wired
 * up.
 *
 * Usage:
 *   npm run promo:create -- <code> <packType> [bonusPoints] [maxRedemptions] [expiresInDays]
 *
 * Examples:
 *   npm run promo:create -- YOUTUBE2026 wheelPro 0 500 30
 *     -> code YOUTUBE2026, an unopened wheelPro pack (guaranteed rare(s)),
 *        no extra points, capped at 500 redemptions, expires in 30 days.
 *   npm run promo:create -- YOUTUBE2026 wheelPro
 *     -> same pack, no points, uncapped, no expiry.
 *
 * Re-running with the same code updates that row (pack/points/caps/expiry)
 * rather than creating a duplicate — the code column is unique.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { promoCodes } from "../db/schema.js";
import { PACKS, PackType } from "../services/packs.js";

async function main() {
  const [code, packType, bonusPointsArg, maxRedemptionsArg, expiresInDaysArg] = process.argv.slice(2);

  if (!code || !packType) {
    console.error("Usage: npm run promo:create -- <code> <packType> [bonusPoints] [maxRedemptions] [expiresInDays]");
    console.error(`packType must be one of: ${Object.keys(PACKS).join(", ")}`);
    process.exit(1);
  }
  if (!(packType in PACKS)) {
    console.error(`Unknown packType "${packType}". Must be one of: ${Object.keys(PACKS).join(", ")}`);
    process.exit(1);
  }

  const bonusPoints = bonusPointsArg ? Number(bonusPointsArg) : 0;
  const maxRedemptions = maxRedemptionsArg ? Number(maxRedemptionsArg) : null;
  const expiresAt = expiresInDaysArg
    ? new Date(Date.now() + Number(expiresInDaysArg) * 24 * 60 * 60 * 1000)
    : null;

  const normalizedCode = code.trim().toUpperCase();

  const [existing] = await db.select({ id: promoCodes.id }).from(promoCodes).where(eq(promoCodes.code, normalizedCode)).limit(1);

  const values = {
    code: normalizedCode,
    packType: packType as PackType,
    bonusPoints,
    maxRedemptions,
    expiresAt,
    active: true,
  };

  if (existing) {
    await db.update(promoCodes).set(values).where(eq(promoCodes.id, existing.id));
    console.log(`Updated promo code ${normalizedCode}.`);
  } else {
    await db.insert(promoCodes).values(values);
    console.log(`Created promo code ${normalizedCode}.`);
  }

  console.log({
    packType,
    bonusPoints,
    maxRedemptions: maxRedemptions ?? "uncapped",
    expiresAt: expiresAt?.toISOString() ?? "never",
    // Two different landing spots for the same code, depending on channel:
    // /register for cold traffic that doesn't have an account yet (a video
    // description), /claim for something meant to work for existing users
    // too (a QR flyer at a live event) — see features/claim/claim.ts.
    registerLink: `https://getclutchapp.com/register?promo=${normalizedCode}`,
    claimLink: `https://getclutchapp.com/claim?promo=${normalizedCode}`,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
