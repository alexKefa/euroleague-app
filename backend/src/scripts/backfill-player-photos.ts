/**
 * One-off backfill (2026-09-09): `players.photo_url` was nulled for every
 * player on 2026-09-02 as part of the 2026-27 season transition (see
 * CLAUDE.md's "Jersey-style placeholders, team colors, and stale
 * collectible teams" section) — the real fix is `player_stats_sync.py`
 * repopulating it once 2026-27 games are actually played, but the season
 * still has zero played games as of this pass, so every player/coach
 * across the whole app (Fantasy Five's roster builder included) has shown
 * nothing but the jersey-silhouette fallback for a week. Asked directly
 * for real photos to check the Fantasy UI against — same reasoning as the
 * CLAUDE.md-documented 2026-09-08 top-scorer-predictions visual QA pass,
 * which pulled real photos from this exact endpoint, matched by
 * `players.code`, and then reverted them since that was throwaway QA.
 * This pass is NOT reverted afterward — a player's photo doesn't change
 * season to season for the same real person (confirmed stable across
 * seasons for `code` itself, see backfill-career-stats.ts), so a photo
 * sourced this way is the same real image `player_stats_sync.py` would
 * eventually write once 2026-27 has real stats, just fetched a season
 * early rather than fabricated.
 *
 * Source: the same public REST endpoint player_stats_sync.py wraps
 * (api-live.euroleague.net/v3/competitions/E/statistics/players/traditional),
 * queried directly via fetch rather than through the Python sync path —
 * same practical reason backfill-career-stats.ts gives (this machine's
 * sync-py/venv doesn't run on Windows, and this endpoint needs no auth/SDK).
 * Only ever sets a NULL photo_url, matched by the player's stable `code`
 * against the most recent season with real per-game data (2025-26) —
 * never overwrites a photo already on file, never touches any other
 * column. Only 208 of this app's ~425 players (208 have real 2025-26
 * per-game stats — call-ups/incoming transfers/reserves with no EuroLeague
 * minutes last season simply aren't in this dataset) get a photo from
 * this pass; the rest keep the placeholder until player_stats_sync.py has
 * real 2026-27 data for them.
 *
 * Usage: npx tsx src/scripts/backfill-player-photos.ts [--dry-run]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players } from "../db/schema.js";

const SOURCE_SEASON = 2025; // 2025-26 — the most recent season with real per-game stats

interface RawPlayerStatsResponse {
  players: { player: { code: string; imageUrl?: string } }[];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const url = `https://api-live.euroleague.net/v3/competitions/E/statistics/players/traditional?SeasonMode=Single&SeasonCode=E${SOURCE_SEASON}&statisticMode=PerGame&limit=400`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`traditional ${SOURCE_SEASON} failed: HTTP ${res.status}`);
  const body = (await res.json()) as RawPlayerStatsResponse;

  const photoByCode = new Map<string, string>();
  for (const row of body.players) {
    if (row.player.imageUrl) photoByCode.set(row.player.code, row.player.imageUrl);
  }
  console.log(`Fetched ${photoByCode.size} real photos from season ${SOURCE_SEASON}.`);

  const existing = await db.select({ code: players.code, photoUrl: players.photoUrl }).from(players);
  const toUpdate = existing.filter((p) => p.photoUrl === null && photoByCode.has(p.code));
  console.log(`${toUpdate.length} of ${existing.length} players have no photo and match by code.`);

  if (dryRun) {
    console.log("Dry run — no writes made.");
    return;
  }
  if (toUpdate.length === 0) return;

  // One batched UPDATE...FROM (VALUES ...) rather than one round trip per
  // player — same "fewer round trips against Neon" lever documented
  // elsewhere in this app (see CLAUDE.md).
  const values = toUpdate.map((p) => sql`(${p.code}, ${photoByCode.get(p.code)!})`);
  await db.execute(sql`
    update players
    set photo_url = v.photo_url
    from (values ${sql.join(values, sql`, `)}) as v(code, photo_url)
    where players.code = v.code and players.photo_url is null
  `);
  console.log(`Updated ${toUpdate.length} players' photo_url.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-player-photos failed:", err);
    process.exit(1);
  });
