/**
 * Create (or update) a promo code redeemable at registration — e.g. a link
 * dropped in a YouTube video description (clutchapp.up.railway.app/register
 * ?promo=CODE). See services/promoCodes.ts for the redemption logic and
 * routes/auth.ts for where it's wired into /register.
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
    registerLink: `https://clutchapp.up.railway.app/register?promo=${normalizedCode}`,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
