import "dotenv/config";
import { getCurrentSeason } from "../services/season.js";
import { syncScheduleTimes } from "./scheduleSync.js";

const season = process.argv[2] ?? (await getCurrentSeason());
if (!season) {
  console.error("No season found.");
  process.exit(1);
}

syncScheduleTimes(season)
  .then(({ checked, changed, added, removed }) => {
    console.log(
      `Checked ${checked} feed game(s) for ${season}: ${changed.length} corrected (tipoff or home/away), ${added.length} added, ${removed.length} removed.`
    );
    for (const c of changed) console.log(`  corrected ${c.gameCode} ${c.home}-${c.away} -> ${c.tipoffAt}`);
    for (const g of added) console.log(`  added R${g.round} ${g.gameCode} ${g.home}-${g.away}`);
    for (const g of removed) console.log(`  removed R${g.round} ${g.gameCode}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Schedule sync failed:", err);
    process.exit(1);
  });
