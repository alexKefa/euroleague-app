/**
 * Backfills `players.photo_url` from the club-roster endpoint
 * (sync-py/roster_sync.py's own source) rather than waiting on real 2026-27
 * game stats. That script's Python side already captures this on every run
 * now (2026-09-16) — see its own doc comment — but this machine's
 * sync-py/venv doesn't run locally (same broken-on-macOS gap
 * backfill-player-photos.ts and backfill-career-stats.ts already worked
 * around), so this is the TS/fetch equivalent to apply the same backfill
 * immediately without depending on that venv.
 *
 * Only 5 of ~330 current players had a real 2026-27 photo here as of
 * 2026-09-16 (checked live) — clubs are registering theirs gradually, not
 * all at once — so this is meant to be safe to re-run periodically (e.g.
 * whenever `roster_sync.py` itself can't be run) to pick up newly-added
 * ones, not a one-off. Always overwrites with whatever the feed has now
 * (a 2026-27 photo supersedes an older stale one, e.g. from
 * backfill-player-photos.ts's 2025-26 source) — but only for players the
 * feed actually has an image for; everyone else's existing photo_url
 * (real or null) is left untouched, same COALESCE-equivalent guard
 * roster_sync.py's SQL now uses.
 *
 * Also checks each roster's Coach entry the same way (2026-09-16) and
 * writes straight onto that team's coach collectible's `image_url` —
 * coaches have no `players` row to put a photo on at all (see CLAUDE.md's
 * Coach cards section), so `collectibles` is the only place a coach photo
 * can actually land.
 *
 * Core logic lives in services/imageSync.ts (2026-09-18) — this script is
 * now a thin CLI wrapper around syncRosterPhotos(), shared with the admin
 * "Sync images" button (routes/admin.ts's POST /admin/sync-images).
 *
 * Usage: npx tsx src/scripts/sync-roster-photos.ts [--dry-run] [--team=CODE]
 */
import "dotenv/config";
import { syncRosterPhotos } from "../services/imageSync.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const teamCode = process.argv.find((a) => a.startsWith("--team="))?.split("=")[1];

  const result = await syncRosterPhotos({ teamCode, dryRun });
  console.log(`Found ${result.playersFound} real player photo(s) and ${result.coachesFound} coach photo(s) across ${result.teamsChecked} team(s).`);
  console.log(`${result.playerUpdates.length} player(s) need updating.`);
  for (const p of result.playerUpdates) {
    console.log(`  ${p.code}: ${p.from ?? "(none)"} -> ${p.to}`);
  }
  console.log(`${result.coachCardUpdates.length} coach card(s) need updating.`);
  for (const c of result.coachCardUpdates) {
    console.log(`  ${c.name}: ${c.from ?? "(none)"} -> ${c.to}`);
  }

  if (dryRun) {
    console.log("Dry run — no writes made.");
    return;
  }
  if (result.playerUpdates.length > 0) console.log(`Updated ${result.playerUpdates.length} players' photo_url.`);
  if (result.coachCardUpdates.length > 0) console.log(`Updated ${result.coachCardUpdates.length} coach card(s)' image_url.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("sync-roster-photos failed:", err);
    process.exit(1);
  });
