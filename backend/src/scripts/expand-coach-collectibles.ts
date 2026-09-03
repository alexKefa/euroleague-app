/**
 * One-time (but idempotent — safe to re-run) catalog expansion: adds one
 * "coach" tier collectible per team that has a synced `head_coach`
 * (roster_sync.py) — a distinct card type from the player common/rare/
 * legendary catalog `expand-collectibles.ts` builds, see CLAUDE.md's
 * "Coach cards" section for the full design.
 *
 * Matched by normalized name + team, same as expand-collectibles.ts, so
 * re-running this after a mid-season coaching change adds the new coach's
 * card without touching (or duplicating) the outgoing coach's.
 *
 * Usage: npx tsx src/scripts/expand-coach-collectibles.ts
 */
import "dotenv/config";
import { or, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { teams, collectibles, games } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";

// Display-only "collector value" — same idea as legendary's up-to-10000,
// never actually charged: coach cards are never directly purchasable
// (routes/collectibles.ts's DIRECT_BUY_PRICE has no "coach" entry) and
// never sell back (routes/packs.ts's sellValueFor excludes "coach" too).
const COACH_COLLECTOR_VALUE = 5000;

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** "PETERS, ALEC" -> "Alec Peters" — same transform expand-collectibles.ts
 * uses for player cards, reused here so a coach's name reads the same way
 * on a card as every player's does. */
function displayName(rawName: string): string {
  const [last, first] = rawName.split(",").map((s) => s.trim());
  const toTitle = (s: string) => s.split(/\s+/).map(titleCase).join(" ");
  return `${toTitle(first)} ${toTitle(last)}`;
}

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  // teams.head_coach isn't reliably scoped to "currently in the
  // competition" — roster_sync.py only ever UPDATEs it for a team the feed
  // still recognizes, so a team that drops out (e.g. last season's AS
  // Monaco) keeps whatever stale coach it last had rather than getting
  // cleared. Found the hard way: this script's first run generated a
  // phantom "Manuchar Markoishvili" coach card for Monaco, which has zero
  // games in the current season. Scoping to teams with an actual game this
  // season (same join GET /api/teams already uses) filters that out.
  const season = await getCurrentSeason();
  const coachedTeams = season
    ? await db
        .selectDistinct({
          id: teams.id,
          headCoach: teams.headCoach,
        })
        .from(teams)
        .innerJoin(games, or(eq(games.homeTeamId, teams.id), eq(games.awayTeamId, teams.id)))
        .where(eq(games.season, season))
    : await db.select({ id: teams.id, headCoach: teams.headCoach }).from(teams);
  const coachedTeamsWithCoach = coachedTeams.filter((t) => t.headCoach);

  const existing = await db.select().from(collectibles);
  const existingCoachKeys = new Set(
    existing.filter((c) => c.tier === "coach").map((c) => `${c.teamId}::${normalize(c.name)}`)
  );

  let inserted = 0;
  for (const team of coachedTeamsWithCoach) {
    const name = displayName(team.headCoach!);
    const key = `${team.id}::${normalize(name)}`;
    if (existingCoachKeys.has(key)) continue;

    await db.insert(collectibles).values({
      name,
      teamId: team.id,
      tier: "coach",
      pointsCost: COACH_COLLECTOR_VALUE,
      imageUrl: null,
    });
    existingCoachKeys.add(key);
    inserted++;
  }

  console.log(
    `Inserted ${inserted} coach collectible(s) (${coachedTeamsWithCoach.length} of ${coachedTeams.length} current-season team(s) have a synced coach).`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Coach collectibles expansion failed:", err);
  process.exit(1);
});
