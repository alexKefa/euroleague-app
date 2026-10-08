import "dotenv/config";
import { getCurrentSeason } from "../services/season.js";
import { syncScheduleTimes } from "./scheduleSync.js";

const season = process.argv[2] ?? (await getCurrentSeason());
if (!season) {
  console.error("No season found.");
  process.exit(1);
}

syncScheduleTimes(season)
  .then(({ checked, changed }) => {
    console.log(`Checked ${checked} upcoming game(s) for ${season}; ${changed.length} game(s) corrected (tipoff or home/away).`);
    for (const c of changed) console.log(`  game ${c.gameCode} ${c.home}-${c.away} -> ${c.tipoffAt}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Schedule sync failed:", err);
    process.exit(1);
  });
