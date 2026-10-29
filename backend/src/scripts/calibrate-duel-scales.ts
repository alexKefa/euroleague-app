// Prints the Four Quarters CATEGORY_SCALES: 20 / median(categoryValue) over
// every current-season player_season_stats row with games_played >= 5.
// Read-only. Paste the output into CATEGORY_SCALES in services/duelEngine.ts.
//
//   npm run duels:calibrate
import "dotenv/config";
import { and, eq, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import { playerSeasonStats } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";
import { DUEL_CATEGORIES, categoryValue, type BaseLine } from "../services/duelEngine.js";

const MIN_GAMES = 5;
const MIN_ROWS = 100;
const TARGET = 20;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function load(season: string): Promise<BaseLine[]> {
  const rows = await db
    .select()
    .from(playerSeasonStats)
    .where(and(eq(playerSeasonStats.season, season), gte(playerSeasonStats.gamesPlayed, MIN_GAMES)));
  return rows.map((r) => ({
    pts: r.pointsPerGame ?? 0,
    reb: r.reboundsPerGame ?? 0,
    ast: r.assistsPerGame ?? 0,
    stl: r.stealsPerGame ?? 0,
    blk: r.blocksPerGame ?? 0,
    pir: r.valuation ?? 0,
  }));
}

async function main() {
  const current = await getCurrentSeason();
  if (!current) throw new Error("no current season");
  let season = current;
  let bases = await load(season);
  if (bases.length < MIN_ROWS) {
    const [start, end] = current.split("-").map(Number);
    const prev = `${start - 1}-${String(end - 1).padStart(2, "0")}`;
    console.log(`${season}: only ${bases.length} rows with games_played >= ${MIN_GAMES}, falling back to ${prev}`);
    season = prev;
    bases = await load(season);
  }
  console.log(`season ${season}, ${bases.length} players`);
  for (const cat of DUEL_CATEGORIES) {
    const med = median(bases.map((b) => categoryValue(b, cat)));
    console.log(`${cat.padEnd(11)} median ${med.toFixed(2).padStart(6)}  scale ${(Math.round((TARGET / med) * 100) / 100).toString()}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
