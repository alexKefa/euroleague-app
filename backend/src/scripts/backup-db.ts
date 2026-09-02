import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { db } from "../db/client.js";
import * as schema from "../db/schema.js";

// Full logical snapshot of the DB, table by table, written as JSON. Built as
// a fallback to `pg_dump` (which hung against both Neon's pooled and direct
// endpoints from this machine — no output at all, not even a partial verbose
// log line, so not worth debugging further right now) using the exact same
// `db` connection every route/sync script already relies on. Not a
// point-in-time transactional snapshot (each table is SELECTed one at a
// time, so a write between two tables could in theory be missed by the
// first and caught by the second) — good enough for a pre-season safety net
// where nothing else is writing to the DB concurrently, not a substitute for
// a real `pg_dump`/Neon branch if that ever matters later.

const TABLES: Array<[string, any]> = [
  ["teams", schema.teams],
  ["users", schema.users],
  ["players", schema.players],
  ["games", schema.games],
  ["game_odds", schema.gameOdds],
  ["team_season_stats", schema.teamSeasonStats],
  ["player_game_stats", schema.playerGameStats],
  ["shot_events", schema.shotEvents],
  ["player_season_stats", schema.playerSeasonStats],
  ["favorites", schema.favorites],
  ["device_tokens", schema.deviceTokens],
  ["news_articles", schema.newsArticles],
  ["sync_state", schema.syncState],
  ["predictions", schema.predictions],
  ["point_adjustments", schema.pointAdjustments],
  ["collectibles", schema.collectibles],
  ["user_collectibles", schema.userCollectibles],
  ["pity_counters", schema.pityCounters],
  ["wheel_spins", schema.wheelSpins],
  ["round_rewards", schema.roundRewards],
  ["legendary_milestones", schema.legendaryMilestones],
  ["pack_openings", schema.packOpenings],
  ["pack_opening_results", schema.packOpeningResults],
  ["owned_packs", schema.ownedPacks],
  ["promo_codes", schema.promoCodes],
  ["trade_offers", schema.tradeOffers],
  ["trade_offer_items", schema.tradeOfferItems],
  ["leagues", schema.leagues],
  ["league_members", schema.leagueMembers],
  ["analytics_views", schema.analyticsViews],
];

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const outDir = path.join(repoRoot, "backups", stamp);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Backing up ${TABLES.length} tables to ${outDir}`);
  let totalRows = 0;
  const summary: Array<{ table: string; rows: number }> = [];

  for (const [name, table] of TABLES) {
    const rows = await db.select().from(table);
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(rows, null, 2));
    summary.push({ table: name, rows: rows.length });
    totalRows += rows.length;
    console.log(`  ${name}: ${rows.length} row(s)`);
  }

  fs.writeFileSync(
    path.join(outDir, "_manifest.json"),
    JSON.stringify({ createdAt: new Date().toISOString(), totalRows, tables: summary }, null, 2)
  );

  console.log(`Done — ${totalRows} total rows across ${TABLES.length} tables.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("backup-db failed:", err);
  process.exit(1);
});
