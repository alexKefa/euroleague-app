import "dotenv/config";
import { syncStandings } from "./syncStandings.js";

const season = process.argv[2] ? Number(process.argv[2]) : new Date().getFullYear();

syncStandings(season)
  .then(({ teamsUpserted, statsUpserted }) => {
    console.log(`Synced ${teamsUpserted} teams, ${statsUpserted} season-stat rows for season ${season}.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Standings sync failed:", err);
    process.exit(1);
  });
