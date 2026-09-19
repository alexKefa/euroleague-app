import "dotenv/config";
import { syncInjuries } from "./injurySync.js";

syncInjuries()
  .then(({ matched, cleared, unmatched, unmatchedTeamSlugs, unmappedStatuses }) => {
    console.log(`Matched ${matched} injuries, cleared ${cleared} resolved ones.`);
    if (unmatched.length > 0) {
      console.warn(`Unmatched players: ${unmatched.map((u) => `${u.teamSlug}/${u.playerName}`).join(", ")}`);
    }
    if (unmatchedTeamSlugs.length > 0) {
      console.warn(`Unmatched team slugs — add to sync/injuryTeamMap.ts: ${unmatchedTeamSlugs.join(", ")}`);
    }
    if (unmappedStatuses.length > 0) {
      console.warn(`Unmapped status labels — add to sync/injurySync.ts's STATUS_MAP: ${unmappedStatuses.join(", ")}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Injury sync failed:", err);
    process.exit(1);
  });
