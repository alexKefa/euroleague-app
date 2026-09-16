/**
 * Backfills `players.photo_url` from the club-roster endpoint
 * (sync-py/roster_sync.py's own source) rather than waiting on real 2026-27
 * game stats. That script's Python side already captures this on every run
 * now (2026-09-16) — see its own doc comment — but this machine's
 * sync-py/venv doesn't run locally (same broken-on-macOS gap
 * backfill-player-photos.ts and backfill-career-stats.ts already worked
 * around), so this is the TS/fetch equivalent to apply the same backfill
 * immediately without depending on that venv.
 *
 * Only 5 of ~330 current players had a real 2026-27 photo here as of
 * 2026-09-16 (checked live) — clubs are registering theirs gradually, not
 * all at once — so this is meant to be safe to re-run periodically (e.g.
 * whenever `roster_sync.py` itself can't be run) to pick up newly-added
 * ones, not a one-off. Always overwrites with whatever the feed has now
 * (a 2026-27 photo supersedes an older stale one, e.g. from
 * backfill-player-photos.ts's 2025-26 source) — but only for players the
 * feed actually has an image for; everyone else's existing photo_url
 * (real or null) is left untouched, same COALESCE-equivalent guard
 * roster_sync.py's SQL now uses.
 *
 * Also checks each roster's Coach entry the same way (2026-09-16) and
 * writes straight onto that team's coach collectible's `image_url` —
 * coaches have no `players` row to put a photo on at all (see CLAUDE.md's
 * Coach cards section), so `collectibles` is the only place a coach photo
 * can actually land. Zero found across every team as of this pass (checked
 * live) — this is a no-op today, built so a future run picks one up the
 * moment EuroLeague adds it instead of needing the script revisited by
 * hand once that happens.
 *
 * Usage: npx tsx src/scripts/sync-roster-photos.ts [--dry-run] [--team=CODE]
 */
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, teams, collectibles } from "../db/schema.js";

const SEASON = 2026; // 2026-27 — bump alongside roster_sync.py's own default each season

interface ClubPerson {
  typeName: string;
  person?: { code?: string; images?: Record<string, string | null> };
  // A sibling of "person", not nested inside it — the bulk 2026-27
  // photoshoot collection (confirmed live for most of Real Madrid, Dubai,
  // Fenerbahce, Olympiacos). person.images below is a SEPARATE, older
  // per-person assignment covering scattered individual players on other
  // teams whose top-level field is empty (e.g. Panathinaikos's
  // Kalaitzakis) — both must be checked, one doesn't supersede the other
  // (a first pass checked only person.images, a second switched to only
  // this field and silently lost every person.images-only player; fixed
  // 2026-09-16 by checking both).
  images?: Record<string, string | null>;
}

function extractPhotoUrl(entry: ClubPerson): string | null {
  for (const images of [entry.images, entry.person?.images]) {
    if (!images) continue;
    if (images.action) return images.action;
    for (const value of Object.values(images)) {
      if (value) return value;
    }
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const teamArg = process.argv.find((a) => a.startsWith("--team="))?.split("=")[1];

  const allTeamRows = await db.select({ id: teams.id, code: teams.code }).from(teams);
  const teamRows = teamArg ? allTeamRows.filter((t) => t.code === teamArg) : allTeamRows;

  const photoByCode = new Map<string, string>();
  // Coaches aren't in `players` at all (see CLAUDE.md's Coach cards
  // section) — a coach photo has nowhere to land on that table, so it's
  // tracked separately here and written straight onto that team's coach
  // collectible below instead. Zero found across every team as of
  // 2026-09-16 (checked live), same as the player collection was before
  // it started populating — this exists so a future run picks one up
  // automatically instead of needing this script revisited by hand.
  const coachPhotoByTeamId = new Map<string, string>();
  for (const { id: teamId, code } of teamRows) {
    const url = `https://api-live.euroleague.net/v2/competitions/E/seasons/E${SEASON}/clubs/${code}/people?type=J`;
    const res = await fetch(url);
    if (!res.ok) continue; // team not found in this season's feed (e.g. AS Monaco) — same as roster_sync.py's fetch_club_people
    const people = (await res.json()) as ClubPerson[];
    if (!Array.isArray(people)) continue;
    for (const entry of people) {
      if (entry.typeName === "Player" && entry.person?.code) {
        const photoUrl = extractPhotoUrl(entry);
        if (photoUrl) photoByCode.set(entry.person.code, photoUrl);
      } else if (entry.typeName === "Coach") {
        const photoUrl = extractPhotoUrl(entry);
        if (photoUrl) coachPhotoByTeamId.set(teamId, photoUrl);
      }
    }
  }
  console.log(`Found ${photoByCode.size} real player photo(s) and ${coachPhotoByTeamId.size} coach photo(s) across ${teamRows.length} team(s).`);

  const existingPlayers = await db.select({ code: players.code, photoUrl: players.photoUrl }).from(players);
  const playersToUpdate = existingPlayers.filter((p) => photoByCode.has(p.code) && p.photoUrl !== photoByCode.get(p.code));
  console.log(`${playersToUpdate.length} player(s) need updating.`);
  for (const p of playersToUpdate) {
    console.log(`  ${p.code}: ${p.photoUrl ?? "(none)"} -> ${photoByCode.get(p.code)}`);
  }

  const existingCoachCards = await db
    .select({ id: collectibles.id, teamId: collectibles.teamId, name: collectibles.name, imageUrl: collectibles.imageUrl })
    .from(collectibles)
    .where(eq(collectibles.tier, "coach"));
  const coachCardsToUpdate = existingCoachCards.filter(
    (c) => coachPhotoByTeamId.has(c.teamId) && c.imageUrl !== coachPhotoByTeamId.get(c.teamId)
  );
  console.log(`${coachCardsToUpdate.length} coach card(s) need updating.`);
  for (const c of coachCardsToUpdate) {
    console.log(`  ${c.name}: ${c.imageUrl ?? "(none)"} -> ${coachPhotoByTeamId.get(c.teamId)}`);
  }

  if (dryRun) {
    console.log("Dry run — no writes made.");
    return;
  }

  if (playersToUpdate.length > 0) {
    const values = playersToUpdate.map((p) => sql`(${p.code}, ${photoByCode.get(p.code)!})`);
    await db.execute(sql`
      update players
      set photo_url = v.photo_url
      from (values ${sql.join(values, sql`, `)}) as v(code, photo_url)
      where players.code = v.code
    `);
    console.log(`Updated ${playersToUpdate.length} players' photo_url.`);
  }

  for (const c of coachCardsToUpdate) {
    await db
      .update(collectibles)
      .set({ imageUrl: coachPhotoByTeamId.get(c.teamId)! })
      .where(and(eq(collectibles.id, c.id), eq(collectibles.tier, "coach")));
  }
  if (coachCardsToUpdate.length > 0) {
    console.log(`Updated ${coachCardsToUpdate.length} coach card(s)' image_url.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("sync-roster-photos failed:", err);
    process.exit(1);
  });
