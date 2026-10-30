// Prints the Four Quarters CATEGORY_SCALES over every current-season
// player_season_stats row with games_played >= 5: each category scaled so its
// top 5 players average what the top 5 scorers do, scoring fixed at
// SCORING_SCALE (2026-10-30; was 20 / median, which let assist specialists
// run away with playmaking, see duelEngine.ts).
// Read-only. Paste the output into CATEGORY_SCALES in services/duelEngine.ts
// and DUEL_CATEGORY_SCALES in the frontend's core/models.ts.
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
const TOP_N = 5;
const SCORING_SCALE = 2.82;

function topAverage(xs: number[]): number {
  const s = [...xs].sort((a, b) => b - a).slice(0, TOP_N);
  return s.reduce((a, b) => a + b, 0) / s.length;
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
  const target = topAverage(bases.map((b) => categoryValue(b, "scoring"))) * SCORING_SCALE;
  for (const cat of DUEL_CATEGORIES) {
    const top = topAverage(bases.map((b) => categoryValue(b, cat)));
    console.log(`${cat.padEnd(11)} top-${TOP_N} avg ${top.toFixed(2).padStart(6)}  scale ${(Math.round((target / top) * 100) / 100).toString()}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
