// Backfill referee crews for every final game of a season
// (sync/refereeSync.ts). Production fills the current season on its own;
// this is for past seasons, or dev (no background jobs there).
//
//   npm run sync:referees            # current season
//   npm run sync:referees -- 2025-26
import "dotenv/config";
import { getCurrentSeason } from "../services/season.js";
import { syncMissingReferees } from "../sync/refereeSync.js";

const season = process.argv[2] ?? (await getCurrentSeason());
if (!season) throw new Error("No season given and no current season found");

const { synced, empty, failed } = await syncMissingReferees(season, 1000);
console.log(`${season}: synced ${synced} game(s), feed empty for ${empty}, failed ${failed}`);
process.exit(0);
