/**
 * Manual trigger for services/fantasyDailyReprice.ts's
 * applyDailyFantasyPriceChanges — the real trigger in production is the
 * daily interval in index.ts, this is only for testing/inspecting a run
 * by hand. Idempotent (see that module's own doc comment): safe to re-run,
 * a game already applied is a no-op.
 *
 * Usage: npx tsx src/scripts/run-daily-fantasy-reprice.ts
 */
import "dotenv/config";
import { getCurrentSeason } from "../services/season.js";
import { applyDailyFantasyPriceChanges } from "../services/fantasyDailyReprice.js";

async function main() {
  const season = await getCurrentSeason();
  if (!season) {
    console.log("No current season (no games synced yet) — nothing to reprice.");
    return;
  }
  const { playersUpdated, coachesUpdated } = await applyDailyFantasyPriceChanges(season);
  console.log(`Season ${season}: repriced ${playersUpdated} player(s), ${coachesUpdated} coach(es).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("run-daily-fantasy-reprice failed:", err);
    process.exit(1);
  });
