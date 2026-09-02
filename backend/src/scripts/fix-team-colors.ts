import { db } from "../db/client.js";
import { teams } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { TEAM_COLORS } from "../sync/teamColors.js";

// One-off (2026-09-02): teams.primary_color/secondary_color were originally
// picked as subtle theme-accent colors (glows, borders), so several are
// noticeably wrong now that the player-photo/collectible jersey redesign
// renders them as solid, literal team colors — see the corrected
// sync/teamColors.ts (and standings_sync.py's matching TEAM_COLORS) for the
// full reasoning per team. standings_sync.py's own upsert uses
// `COALESCE(teams.primary_color, EXCLUDED.primary_color)`, so it only ever
// fills in a NULL column — re-running that sync would NOT apply these
// corrections to already-populated rows. This does the direct UPDATE
// instead, once, for exactly the codes whose colors changed today.
async function main() {
  let updated = 0;
  for (const [code, { primary, secondary }] of Object.entries(TEAM_COLORS)) {
    if (code === "DEFAULT") continue;
    const result = await db
      .update(teams)
      .set({ primaryColor: primary, secondaryColor: secondary })
      .where(eq(teams.code, code))
      .returning({ code: teams.code });
    if (result.length > 0) {
      console.log(`  ${code}: -> ${primary} / ${secondary}`);
      updated++;
    }
  }
  console.log(`\nUpdated ${updated} team(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("fix-team-colors failed:", err);
  process.exit(1);
});
