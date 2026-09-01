import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { createUniqueUsername } from "../services/username.js";

// One-off migration companion to the users.username column
// (db/schema.ts) — no migrations are checked in for this project (see
// CLAUDE.md), so the column is added/backfilled/locked down here by hand
// against the live DB rather than via drizzle-kit. Safe to re-run: the
// ADD COLUMN and constraint statements are no-ops once applied, and the
// backfill only ever touches rows that are still null.
async function main(): Promise<void> {
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS username text`);

  const rows = await db.execute<{ id: string }>(sql`SELECT id FROM users WHERE username IS NULL`);
  for (const row of rows) {
    const username = await createUniqueUsername();
    await db.execute(sql`UPDATE users SET username = ${username} WHERE id = ${row.id}`);
    console.log(`  ${row.id} -> ${username}`);
  }

  await db.execute(sql`ALTER TABLE users ALTER COLUMN username SET NOT NULL`);
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_username_unique') THEN
        ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
      END IF;
    END $$;
  `);

  console.log(`Backfilled ${rows.length} user(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("backfill-usernames failed:", err);
  process.exit(1);
});
