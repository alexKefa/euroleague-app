// Backfills shots, play-by-play and lineups for a past season's final games
// (2026-10-07, win probability phase C). Run from backend/:
//   npx tsx src/scripts/backfill-pbp.ts [season=2025-26] [batch=25]
// Uses syncMissingGameExtras, which already waits between games; safe to
// stop and re-run (it only picks games with no play-by-play yet). Afterwards
// re-run scripts/fit-win-prob.ts to re-fit and print in-game calibration.
import { syncMissingGameExtras } from "../sync/gameExtrasSync.js";

async function main() {
  const season = process.argv[2] ?? "2025-26";
  const batch = Number(process.argv[3] ?? 25);
  let total = 0;
  for (;;) {
    const r = await syncMissingGameExtras(season, batch);
    total += r.synced;
    console.log(`[backfill ${season}] batch: synced ${r.synced}, empty ${r.empty}, failed ${r.failed} (total ${total})`);
    if (r.synced === 0) break; // nothing left that the feed can fill
  }
  console.log(`[backfill ${season}] done, ${total} games`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
