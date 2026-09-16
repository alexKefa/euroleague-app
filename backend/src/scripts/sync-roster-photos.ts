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
 * Usage: npx tsx src/scripts/sync-roster-photos.ts [--dry-run]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, teams } from "../db/schema.js";

const SEASON = 2026; // 2026-27 — bump alongside roster_sync.py's own default each season

interface ClubPerson {
  typeName: string;
  person?: { code?: string; images?: Record<string, string | null> };
}

function extractPhotoUrl(images: Record<string, string | null> | undefined): string | null {
  if (!images) return null;
  if (images.action) return images.action;
  for (const value of Object.values(images)) {
    if (value) return value;
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const teamRows = await db.select({ code: teams.code }).from(teams);

  const photoByCode = new Map<string, string>();
  for (const { code } of teamRows) {
    const url = `https://api-live.euroleague.net/v2/competitions/E/seasons/E${SEASON}/clubs/${code}/people?type=J`;
    const res = await fetch(url);
    if (!res.ok) continue; // team not found in this season's feed (e.g. AS Monaco) — same as roster_sync.py's fetch_club_people
    const people = (await res.json()) as ClubPerson[];
    if (!Array.isArray(people)) continue;
    for (const entry of people) {
      if (entry.typeName !== "Player" || !entry.person?.code) continue;
      const photoUrl = extractPhotoUrl(entry.person.images);
      if (photoUrl) photoByCode.set(entry.person.code, photoUrl);
    }
  }
  console.log(`Found ${photoByCode.size} real 2026-27 photo(s) across ${teamRows.length} team(s).`);

  if (photoByCode.size === 0) return;

  const existing = await db.select({ code: players.code, photoUrl: players.photoUrl }).from(players);
  const toUpdate = existing.filter((p) => photoByCode.has(p.code) && p.photoUrl !== photoByCode.get(p.code));
  console.log(`${toUpdate.length} player(s) need updating.`);
  for (const p of toUpdate) {
    console.log(`  ${p.code}: ${p.photoUrl ?? "(none)"} -> ${photoByCode.get(p.code)}`);
  }

  if (dryRun) {
    console.log("Dry run — no writes made.");
    return;
  }
  if (toUpdate.length === 0) return;

  const values = toUpdate.map((p) => sql`(${p.code}, ${photoByCode.get(p.code)!})`);
  await db.execute(sql`
    update players
    set photo_url = v.photo_url
    from (values ${sql.join(values, sql`, `)}) as v(code, photo_url)
    where players.code = v.code
  `);
  console.log(`Updated ${toUpdate.length} players' photo_url.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("sync-roster-photos failed:", err);
    process.exit(1);
  });
