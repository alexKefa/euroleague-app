/**
 * `collectibles.image_url` is a one-time snapshot of `players.photo_url`
 * taken when `expand-collectibles.ts` first inserts a card (see that
 * script and CLAUDE.md's "Jersey-style placeholders..." section) — it's
 * never re-synced afterward, by design (that's what lets a card render a
 * stable image even if a player's own `photo_url` later changes for an
 * unrelated reason). But it also means a genuinely new, real photo
 * (e.g. sync-roster-photos.ts picking up a club's freshly-released 2026-27
 * photo) never reaches an *already-existing* card on its own.
 *
 * This is the explicit "go pick those up" pass: for every collectible
 * whose `image_url` doesn't match its player's current `photo_url`
 * (matched the same way expand-collectibles.ts matches on insert — team +
 * normalized display name), overwrite it. Only touches rows where the
 * player actually has a photo to give (never blanks an existing card image
 * back to null for a player with none).
 *
 * Usage: npx tsx src/scripts/sync-collectible-images.ts [--dry-run]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, collectibles } from "../db/schema.js";

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function displayName(rawName: string): string {
  const [last, first] = rawName.split(",").map((s) => s.trim());
  const toTitle = (s: string) => s.split(/\s+/).map(titleCase).join(" ");
  return `${toTitle(first)} ${toTitle(last)}`;
}

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const allPlayers = await db.select().from(players);
  const photoByKey = new Map<string, string>();
  for (const p of allPlayers) {
    if (!p.photoUrl) continue;
    photoByKey.set(`${p.teamId}::${normalize(displayName(p.name))}`, p.photoUrl);
  }

  const allCollectibles = await db
    .select({ id: collectibles.id, name: collectibles.name, teamId: collectibles.teamId, imageUrl: collectibles.imageUrl })
    .from(collectibles);

  const toUpdate = allCollectibles
    .map((c) => ({ c, photoUrl: photoByKey.get(`${c.teamId}::${normalize(c.name)}`) }))
    .filter((row): row is { c: typeof allCollectibles[number]; photoUrl: string } => !!row.photoUrl && row.photoUrl !== row.c.imageUrl);

  console.log(`${toUpdate.length} of ${allCollectibles.length} collectible(s) need an image update.`);
  for (const row of toUpdate) {
    console.log(`  ${row.c.name}: ${row.c.imageUrl ?? "(none)"} -> ${row.photoUrl}`);
  }

  if (dryRun) {
    console.log("Dry run — no writes made.");
    return;
  }
  if (toUpdate.length === 0) return;

  const values = toUpdate.map((row) => sql`(${row.c.id}, ${row.photoUrl})`);
  await db.execute(sql`
    update collectibles
    set image_url = v.image_url
    from (values ${sql.join(values, sql`, `)}) as v(id, image_url)
    where collectibles.id = v.id::uuid
  `);
  console.log(`Updated ${toUpdate.length} collectible(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("sync-collectible-images failed:", err);
    process.exit(1);
  });
