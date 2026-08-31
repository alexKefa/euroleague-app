import "dotenv/config";
import { syncOdds } from "./oddsSync.js";

syncOdds()
  .then(({ gamesMatched, gamesSkipped, unmatchedTeamNames }) => {
    console.log(`Synced odds for ${gamesMatched} games (${gamesSkipped} skipped/unmatched).`);
    if (unmatchedTeamNames.length > 0) {
      console.warn(
        `Unmatched team names from the odds API — add to sync/oddsTeamMap.ts if these recur: ${unmatchedTeamNames.join(", ")}`
      );
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Odds sync failed:", err);
    process.exit(1);
  });
