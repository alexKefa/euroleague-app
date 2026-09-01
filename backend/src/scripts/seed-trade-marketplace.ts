/**
 * Testing helper: fills the trade marketplace (/trades) with every legendary
 * in the catalog, each listed for trade by one of a handful of throwaway
 * seller accounts — so the marketplace's scrollable grid can be exercised
 * with a full, realistic-looking set of listings instead of hunting down
 * real legendaries via wheel spins first.
 *
 * Usage: npm run seed:trade-marketplace  (or: tsx src/scripts/seed-trade-marketplace.ts)
 *
 * Idempotent: re-running it just re-affirms the same accounts/listings
 * (upsert on the (userId, collectibleId) unique index) rather than
 * duplicating anything.
 */
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, collectibles, userCollectibles } from "../db/schema.js";
import { hashPassword } from "../auth/hash.js";
import { createUniqueReferralCode } from "../services/referrals.js";
import { createUniqueUsername } from "../services/username.js";

const SELLER_COUNT = 4;
const SELLER_EMAIL_DOMAIN = "trade-seed.local"; // never a real, deliverable address
const SELLER_PASSWORD = "trade-seed-password"; // throwaway — not meant to be logged into

async function ensureSeller(index: number): Promise<string> {
  const email = `seller${index + 1}@${SELLER_EMAIL_DOMAIN}`;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(users)
    .values({
      email,
      username: await createUniqueUsername(),
      passwordHash: await hashPassword(SELLER_PASSWORD),
      referralCode: await createUniqueReferralCode(),
    })
    .returning({ id: users.id });
  console.log(`created seller account ${email}`);
  return created.id;
}

async function main() {
  const legendaries = await db
    .select({ id: collectibles.id, name: collectibles.name })
    .from(collectibles)
    .where(eq(collectibles.tier, "legendary"));

  if (legendaries.length === 0) {
    console.log("No legendary collectibles found in the catalog — nothing to seed.");
    return;
  }

  const sellerIds: string[] = [];
  for (let i = 0; i < SELLER_COUNT; i++) {
    sellerIds.push(await ensureSeller(i));
  }

  // Round-robin so listings spread evenly across sellers rather than
  // dumping everything on one account.
  for (let i = 0; i < legendaries.length; i++) {
    const sellerId = sellerIds[i % sellerIds.length];
    const legendary = legendaries[i];
    await db
      .insert(userCollectibles)
      .values({ userId: sellerId, collectibleId: legendary.id, tradeable: true })
      .onConflictDoUpdate({
        target: [userCollectibles.userId, userCollectibles.collectibleId],
        set: { tradeable: true },
      });
  }

  console.log(
    `Listed ${legendaries.length} legendaries for trade across ${sellerIds.length} seller accounts (${sellerIds
      .map((_, i) => `seller${i + 1}@${SELLER_EMAIL_DOMAIN}`)
      .join(", ")}).`
  );
  console.log("Log in as any other account and open /trades to see the full marketplace.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
