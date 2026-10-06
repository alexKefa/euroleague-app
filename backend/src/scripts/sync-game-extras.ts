// Backfill shots, play-by-play and lineup stints for every final game of a
// season (sync/gameExtrasSync.ts). Production does this on its own, a few
// games an hour; this is for doing it in one go, or for dev (where
// DISABLE_BACKGROUND_JOBS stops the hourly job).
//
//   npm run sync:game-extras            # current season
//   npm run sync:game-extras -- 2025-26
import "dotenv/config";
import { getCurrentSeason } from "../services/season.js";
import { syncMissingGameExtras } from "../sync/gameExtrasSync.js";

const season = process.argv[2] ?? (await getCurrentSeason());
if (!season) throw new Error("No season given and no current season found");

const { synced, empty, failed } = await syncMissingGameExtras(season, 1000);
console.log(`${season}: synced ${synced} game(s), feed empty for ${empty}, failed ${failed}`);
process.exit(0);
