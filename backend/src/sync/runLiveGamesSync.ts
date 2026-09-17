import "dotenv/config";
import { syncLiveGames } from "./liveGamesSync.js";

syncLiveGames()
  .then(({ checked, wentLive, wentFinal }) => {
    console.log(`Checked ${checked} in-window game(s): ${wentLive} went live, ${wentFinal} went final.`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Live games sync failed:", err);
    process.exit(1);
  });
