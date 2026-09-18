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
 * Core logic lives in services/imageSync.ts (2026-09-18) — this script is
 * now a thin CLI wrapper around syncCollectibleImages(), shared with the
 * admin "Sync images" button (routes/admin.ts's POST /admin/sync-images).
 *
 * Usage: npx tsx src/scripts/sync-collectible-images.ts [--dry-run]
 */
import "dotenv/config";
import { syncCollectibleImages } from "../services/imageSync.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const result = await syncCollectibleImages({ dryRun });
  console.log(`${result.collectibleUpdates.length} of ${result.totalCollectibles} collectible(s) need an image update.`);
  for (const row of result.collectibleUpdates) {
    console.log(`  ${row.name}: ${row.from ?? "(none)"} -> ${row.to}`);
  }

  if (dryRun) {
    console.log("Dry run — no writes made.");
    return;
  }
  if (result.collectibleUpdates.length > 0) console.log(`Updated ${result.collectibleUpdates.length} collectible(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("sync-collectible-images failed:", err);
    process.exit(1);
  });
