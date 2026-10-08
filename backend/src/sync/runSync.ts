import "dotenv/config";
import { syncStandings } from "./syncStandings.js";
import { getCurrentSeason } from "../services/season.js";

// `npm run sync:standings [2026-27]` — defaults to the current season.
const season = process.argv[2] ?? (await getCurrentSeason());
if (!season) {
  console.error("No current season found");
  process.exit(1);
}

syncStandings(season)
  .then(({ round, updated, unknownCodes }) => {
    console.log(`Standings ${season} through round ${round}: updated ${updated} team(s)${unknownCodes.length ? `, unknown codes: ${unknownCodes.join(", ")}` : ""}.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Standings sync failed:", err);
    process.exit(1);
  });
