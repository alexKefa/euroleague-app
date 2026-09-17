/**
 * One-off schema change for the QR-scan-to-pack-reward pass (2026-09-13) —
 * see promoCodeRedemptions' doc comment in schema.ts. Applied by hand
 * against DATABASE_URL rather than through `db:push`, per the
 * Schema-changes workflow in CLAUDE.md (db:push's strict:true confirmation
 * prompt can't be scripted non-interactively). Purely additive (a new
 * table), no existing data touched.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS promo_code_redemptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      promo_code_id uuid NOT NULL REFERENCES promo_codes(id),
      user_id uuid NOT NULL REFERENCES users(id),
      redeemed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS promo_code_redemption_unique
      ON promo_code_redemptions (promo_code_id, user_id)
  `);
  console.log("promo_code_redemptions table + unique index ready.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
