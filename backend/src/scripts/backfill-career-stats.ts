/**
 * One-off backfill (run once, 2026-09-05): pulls every past EuroLeague
 * season's traditional+advanced player stats directly from the same public
 * REST endpoint sync-py/player_stats_sync.py wraps
 * (api-live.euroleague.net/v3/competitions/E/statistics/players/...) and
 * upserts player_season_stats rows for them — enabling a "career averages"
 * view on the collectible card flip (routes/collectibles.ts), not just
 * this-season stats.
 *
 * Written in TypeScript rather than reusing player_stats_sync.py's Python
 * path for a practical reason: this machine's committed sync-py/venv is a
 * Windows venv (Scripts/ not bin/), which doesn't run here at all, and the
 * underlying euroleague-api Python package additionally requires Python
 * 3.10+ (`str | None` syntax) while this machine's system python3 is 3.9 —
 * neither is this script's problem to fix, and the target REST endpoint
 * turned out to need no auth and no SDK, just a plain fetch.
 *
 * Deliberately NEVER creates a new `players` row — unlike the regular
 * per-season sync (which is meant to discover the current roster), this
 * only enriches players ALREADY in our `players` table (matched by their
 * stable `code`, confirmed directly to stay the same across seasons for
 * the same real person — see CLAUDE.md). A historical season's stats API
 * returns hundreds of long-retired players with no relevance to this app's
 * current card economy; inserting `players` rows for them would pollute
 * roster-listing routes (which filter on `active`, a flag this script has
 * no season-aware way to set correctly) for zero benefit — this app's
 * collectible cards only ever exist for players already synced onto some
 * roster, so "career stats for a player we already have a card for" is the
 * entire real requirement.
 *
 * Historical coverage: confirmed directly against the live endpoint that
 * per-game data exists back to season 2000 (2000-01) — season 1999 and
 * earlier 404. EARLIEST_SEASON below reflects that; there's no further
 * history to backfill past it.
 *
 * Usage: npx tsx src/scripts/backfill-career-stats.ts [--dry-run]
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, teams, playerSeasonStats } from "../db/schema.js";

const EARLIEST_SEASON = 2000; // 2000-01 — the real API 404s before this
const CURRENT_SEASON_START = 2025; // 2025-26 already synced by the regular job; backfill stops the season before it

function seasonLabel(season: number): string {
  return `${season}-${String(season + 1).slice(-2)}`;
}

function safeFloat(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctToFloat(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const n = Number(value.replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

function fieldGoalPct(row: RawStatRow): number | null {
  const made = (safeFloat(row.twoPointersMade) ?? 0) + (safeFloat(row.threePointersMade) ?? 0);
  const attempted = (safeFloat(row.twoPointersAttempted) ?? 0) + (safeFloat(row.threePointersAttempted) ?? 0);
  return attempted ? (made / attempted) * 100 : null;
}

interface RawPlayerStatsResponse {
  total: number;
  players: RawStatRow[];
}

interface RawStatRow {
  player: { code: string; team: { code: string } };
  gamesPlayed: number;
  minutesPlayed: number;
  pointsScored: number;
  twoPointersMade: number;
  twoPointersAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  threePointersPercentage: string;
  freeThrowsPercentage: string;
  totalRebounds: number;
  assists: number;
  steals: number;
  turnovers: number;
  blocks: number;
  pir: number;
  // advanced-endpoint-only fields
  effectiveFieldGoalPercentage?: string;
  trueShootingPercentage?: string;
  offensiveReboundsPercentage?: string;
  defensiveReboundsPercentage?: string;
  reboundsPercentage?: string;
  assistsToTurnoversRatio?: number;
  assistsRatio?: string;
  turnoversRatio?: string;
  twoPointAttemptsRatio?: string;
  threePointAttemptsRatio?: string;
  freeThrowsRate?: string;
  possesions?: number;
}

async function fetchSeasonStats(endpoint: "traditional" | "advanced", season: number): Promise<RawStatRow[]> {
  const url = `https://api-live.euroleague.net/v3/competitions/E/statistics/players/${endpoint}?SeasonMode=Single&SeasonCode=E${season}&statisticMode=PerGame&limit=400`;
  const res = await fetch(url);
  if (res.status === 404) return []; // no data at all for this season
  if (!res.ok) throw new Error(`${endpoint} ${season} failed: HTTP ${res.status}`);
  const body = (await res.json()) as RawPlayerStatsResponse;
  return body.players ?? [];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const allPlayers = await db.select({ id: players.id, code: players.code, teamId: players.teamId }).from(players);
  const playerByCode = new Map(allPlayers.map((p) => [p.code, p]));

  const allTeams = await db.select({ id: teams.id, code: teams.code }).from(teams);
  const teamIdByCode = new Map(allTeams.map((t) => [t.code, t.id]));

  let totalUpserted = 0;
  let totalSkippedUnmatched = 0;

  for (let season = EARLIEST_SEASON; season < CURRENT_SEASON_START; season++) {
    const [traditional, advanced] = await Promise.all([
      fetchSeasonStats("traditional", season),
      fetchSeasonStats("advanced", season),
    ]);
    if (traditional.length === 0) {
      console.log(`season ${season}: no data, skipping`);
      continue;
    }
    const advByCode = new Map(advanced.map((r) => [r.player.code, r]));

    let seasonUpserted = 0;
    let seasonSkipped = 0;
    const seasonStr = seasonLabel(season);

    for (const row of traditional) {
      const player = playerByCode.get(row.player.code);
      if (!player) {
        seasonSkipped++;
        continue;
      }
      const adv = advByCode.get(row.player.code);
      // Players who changed teams mid-season have a compound code like
      // "OLY;PAR" — same handling as player_stats_sync.py.
      const rawTeamCode = row.player.team.code;
      const teamCode = rawTeamCode.includes(";") ? rawTeamCode.split(";").pop()! : rawTeamCode;
      const teamId = teamIdByCode.get(teamCode) ?? player.teamId; // fall back to their current team if the historical code doesn't resolve

      if (!dryRun) {
        await db
          .insert(playerSeasonStats)
          .values({
            playerId: player.id,
            teamId,
            season: seasonStr,
            gamesPlayed: Math.round(safeFloat(row.gamesPlayed) ?? 0),
            minutesPerGame: safeFloat(row.minutesPlayed),
            pointsPerGame: safeFloat(row.pointsScored),
            reboundsPerGame: safeFloat(row.totalRebounds),
            assistsPerGame: safeFloat(row.assists),
            stealsPerGame: safeFloat(row.steals),
            blocksPerGame: safeFloat(row.blocks),
            turnoversPerGame: safeFloat(row.turnovers),
            fieldGoalPct: fieldGoalPct(row),
            threePointPct: pctToFloat(row.threePointersPercentage),
            freeThrowPct: pctToFloat(row.freeThrowsPercentage),
            valuation: safeFloat(row.pir),
            effectiveFieldGoalPct: adv ? pctToFloat(adv.effectiveFieldGoalPercentage) : null,
            trueShootingPct: adv ? pctToFloat(adv.trueShootingPercentage) : null,
            offensiveReboundPct: adv ? pctToFloat(adv.offensiveReboundsPercentage) : null,
            defensiveReboundPct: adv ? pctToFloat(adv.defensiveReboundsPercentage) : null,
            totalReboundPct: adv ? pctToFloat(adv.reboundsPercentage) : null,
            assistToTurnoverRatio: adv ? safeFloat(adv.assistsToTurnoversRatio) : null,
            assistRatio: adv ? pctToFloat(adv.assistsRatio) : null,
            turnoverRatio: adv ? pctToFloat(adv.turnoversRatio) : null,
            twoPointAttemptRate: adv ? pctToFloat(adv.twoPointAttemptsRatio) : null,
            threePointAttemptRate: adv ? pctToFloat(adv.threePointAttemptsRatio) : null,
            freeThrowRate: adv ? pctToFloat(adv.freeThrowsRate) : null,
            possessionsPerGame: adv ? safeFloat(adv.possesions) : null,
            // usagePercentage intentionally left null — that column is
            // computed from player_game_stats' raw per-game rows
            // (sync_usage_percentage in player_stats_sync.py), which don't
            // exist for these historical seasons and aren't being backfilled.
          })
          .onConflictDoUpdate({
            target: [playerSeasonStats.playerId, playerSeasonStats.season],
            set: {
              teamId,
              gamesPlayed: Math.round(safeFloat(row.gamesPlayed) ?? 0),
              minutesPerGame: safeFloat(row.minutesPlayed),
              pointsPerGame: safeFloat(row.pointsScored),
              reboundsPerGame: safeFloat(row.totalRebounds),
              assistsPerGame: safeFloat(row.assists),
              stealsPerGame: safeFloat(row.steals),
              blocksPerGame: safeFloat(row.blocks),
              turnoversPerGame: safeFloat(row.turnovers),
              fieldGoalPct: fieldGoalPct(row),
              threePointPct: pctToFloat(row.threePointersPercentage),
              freeThrowPct: pctToFloat(row.freeThrowsPercentage),
              valuation: safeFloat(row.pir),
              effectiveFieldGoalPct: adv ? pctToFloat(adv.effectiveFieldGoalPercentage) : null,
              trueShootingPct: adv ? pctToFloat(adv.trueShootingPercentage) : null,
              offensiveReboundPct: adv ? pctToFloat(adv.offensiveReboundsPercentage) : null,
              defensiveReboundPct: adv ? pctToFloat(adv.defensiveReboundsPercentage) : null,
              totalReboundPct: adv ? pctToFloat(adv.reboundsPercentage) : null,
              assistToTurnoverRatio: adv ? safeFloat(adv.assistsToTurnoversRatio) : null,
              assistRatio: adv ? pctToFloat(adv.assistsRatio) : null,
              turnoverRatio: adv ? pctToFloat(adv.turnoversRatio) : null,
              twoPointAttemptRate: adv ? pctToFloat(adv.twoPointAttemptsRatio) : null,
              threePointAttemptRate: adv ? pctToFloat(adv.threePointAttemptsRatio) : null,
              freeThrowRate: adv ? pctToFloat(adv.freeThrowsRate) : null,
              possessionsPerGame: adv ? safeFloat(adv.possesions) : null,
            },
          });
      }
      seasonUpserted++;
    }

    console.log(`season ${season} (${seasonStr}): ${seasonUpserted} matched/upserted, ${seasonSkipped} unmatched (not in our players table)`);
    totalUpserted += seasonUpserted;
    totalSkippedUnmatched += seasonSkipped;
  }

  console.log(`\nDone${dryRun ? " (dry run, no writes)" : ""}: ${totalUpserted} season-stat rows upserted across existing players, ${totalSkippedUnmatched} historical rows skipped (player not already in our players table).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-career-stats failed:", err);
    process.exit(1);
  });
