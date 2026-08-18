import "dotenv/config";
import { syncNews } from "./newsSync.js";

syncNews()
  .then(({ articlesUpserted, feedsFailed }) => {
    console.log(`Synced ${articlesUpserted} articles.`);
    if (feedsFailed.length > 0) {
      console.warn(`Failed to fetch: ${feedsFailed.join(", ")}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("News sync failed:", err);
    process.exit(1);
  });