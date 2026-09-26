import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, playerSeasonStats, teams } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";

// TS port of sync-py/player_stats_sync.py, for the same reason
// backfill-career-stats.ts/sync-roster-photos.ts already ported their own
// one-off euroleague-api calls to a plain `fetch`: this one specifically
// needs to run unattended on a schedule (see index.ts), Python isn't in the
// production Docker image at all, and this machine's committed
// sync-py/venv still doesn't run (see CLAUDE.md). Same real endpoint
// euroleague-api's PlayerStats wrapper hits under the hood, confirmed
// directly by inspecting its actual response shape rather than guessing at
// field names from the Python script alone.
const STATS_BASE_URL = "https://api-live.euroleague.net/v3/competitions/E/statistics/players";

interface RawPlayerTraditional {
  player: { code: string; name: string; imageUrl?: string; team: { code: string } };
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
  blocks: number;
  turnovers: number;
  pir: number;
}

interface RawPlayerAdvanced {
  player: { code: string };
  effectiveFieldGoalPercentage: string;
  trueShootingPercentage: string;
  offensiveReboundsPercentage: string;
  defensiveReboundsPercentage: string;
  reboundsPercentage: string;
  assistsToTurnoversRatio: number;
  assistsRatio: string;
  turnoversRatio: string;
  twoPointAttemptsRatio: string;
  threePointAttemptsRatio: string;
  freeThrowsRate: string;
  possesions: number;
}

function pctToFloat(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed.replace("%", ""));
  return Number.isNaN(n) ? null : n;
}

function fieldGoalPct(row: RawPlayerTraditional): number | null {
  const made = (row.twoPointersMade || 0) + (row.threePointersMade || 0);
  const attempted = (row.twoPointersAttempted || 0) + (row.threePointersAttempted || 0);
  return attempted ? (made / attempted) * 100 : null;
}

async function fetchStatsPage<T>(endpoint: "traditional" | "advanced", seasonCode: string): Promise<T[]> {
  const baseParams = `SeasonMode=Single&SeasonCode=${seasonCode}&statisticMode=PerGame&limit=400`;
  const res = await fetch(`${STATS_BASE_URL}/${endpoint}?${baseParams}`);
  if (!res.ok) throw new Error(`GET ${endpoint} stats failed: HTTP ${res.status}`);
  const data = (await res.json()) as { total: number; players: T[] };
  // The feed's all-phases aggregate (no phaseTypeCode) genuinely returns
  // zero rows for a season that's still entirely inside its first phase
  // (confirmed live, 2026-09-26, season 2026-27, 10 real finals already
  // played) — it only starts returning combined data once a season has
  // moved past a single phase. "RS" alone returns real rows in that
  // window and is equivalent to "the whole season so far" while no other
  // phase exists yet, so fall back to it rather than silently syncing
  // nothing for a season that's genuinely in progress. See the matching
  // comment in sync-py/player_stats_sync.py's get_stats_with_rs_fallback.
  if (!data.players?.length) {
    const rsRes = await fetch(`${STATS_BASE_URL}/${endpoint}?${baseParams}&phaseTypeCode=RS`);
    if (!rsRes.ok) throw new Error(`GET ${endpoint} stats (RS fallback) failed: HTTP ${rsRes.status}`);
    const rsData = (await rsRes.json()) as { total: number; players: T[] };
    return rsData.players ?? [];
  }
  return data.players;
}

function seasonCodeFromLabel(seasonLabel: string): string {
  // "2026-27" -> "E2026"
  return `E${seasonLabel.split("-")[0]}`;
}

function buildStatsFields(row: RawPlayerTraditional, adv: RawPlayerAdvanced | undefined) {
  return {
    gamesPlayed: Math.round(row.gamesPlayed || 0),
    minutesPerGame: row.minutesPlayed ?? null,
    pointsPerGame: row.pointsScored ?? null,
    reboundsPerGame: row.totalRebounds ?? null,
    assistsPerGame: row.assists ?? null,
    stealsPerGame: row.steals ?? null,
    blocksPerGame: row.blocks ?? null,
    turnoversPerGame: row.turnovers ?? null,
    fieldGoalPct: fieldGoalPct(row),
    threePointPct: pctToFloat(row.threePointersPercentage),
    freeThrowPct: pctToFloat(row.freeThrowsPercentage),
    valuation: row.pir ?? null,
    effectiveFieldGoalPct: adv ? pctToFloat(adv.effectiveFieldGoalPercentage) : null,
    trueShootingPct: adv ? pctToFloat(adv.trueShootingPercentage) : null,
    offensiveReboundPct: adv ? pctToFloat(adv.offensiveReboundsPercentage) : null,
    defensiveReboundPct: adv ? pctToFloat(adv.defensiveReboundsPercentage) : null,
    totalReboundPct: adv ? pctToFloat(adv.reboundsPercentage) : null,
    assistToTurnoverRatio: adv?.assistsToTurnoversRatio ?? null,
    assistRatio: adv ? pctToFloat(adv.assistsRatio) : null,
    turnoverRatio: adv ? pctToFloat(adv.turnoversRatio) : null,
    twoPointAttemptRate: adv ? pctToFloat(adv.twoPointAttemptsRatio) : null,
    threePointAttemptRate: adv ? pctToFloat(adv.threePointAttemptsRatio) : null,
    freeThrowRate: adv ? pctToFloat(adv.freeThrowsRate) : null,
    possessionsPerGame: adv?.possesions ?? null,
  };
}

// Usage% isn't part of euroleague-api's `advanced` endpoint (checked
// directly against its actual response columns — there's no usage field at
// all), so unlike everything else here it isn't synced verbatim — computed
// from raw per-game box scores instead, same formula/caveats as
// sync-py/player_stats_sync.py's own sync_usage_percentage (see that
// function's doc comment for the per-game team-total join and its
// traded-player accuracy caveat, unchanged here).
async function syncUsagePercentage(season: string): Promise<void> {
  await db.execute(sql`
    WITH game_team_totals AS (
      SELECT
        pgs.game_id,
        p.team_id,
        SUM(pgs.minutes) AS team_minutes,
        SUM(COALESCE(pgs.field_goals_attempted_2, 0) + COALESCE(pgs.field_goals_attempted_3, 0)) AS team_fga,
        SUM(COALESCE(pgs.free_throws_attempted, 0)) AS team_fta,
        SUM(COALESCE(pgs.turnovers, 0)) AS team_tov
      FROM player_game_stats pgs
      JOIN games g ON g.id = pgs.game_id
      JOIN players p ON p.id = pgs.player_id
      WHERE g.season = ${season}
        AND pgs.minutes IS NOT NULL AND pgs.minutes > 0
        AND p.team_id IN (g.home_team_id, g.away_team_id)
      GROUP BY pgs.game_id, p.team_id
    ),
    player_game_usage AS (
      SELECT
        pgs.player_id,
        100.0 * (
          COALESCE(pgs.field_goals_attempted_2, 0) + COALESCE(pgs.field_goals_attempted_3, 0)
          + 0.44 * COALESCE(pgs.free_throws_attempted, 0) + COALESCE(pgs.turnovers, 0)
        ) * (gtt.team_minutes / 5.0)
        / NULLIF(pgs.minutes * (gtt.team_fga + 0.44 * gtt.team_fta + gtt.team_tov), 0) AS usage_pct
      FROM player_game_stats pgs
      JOIN games g ON g.id = pgs.game_id
      JOIN players p ON p.id = pgs.player_id
      JOIN game_team_totals gtt ON gtt.game_id = pgs.game_id AND gtt.team_id = p.team_id
      WHERE g.season = ${season}
        AND pgs.minutes IS NOT NULL AND pgs.minutes > 0
    )
    UPDATE player_season_stats pss
    SET usage_percentage = agg.usage_percentage
    FROM (
      SELECT player_id, AVG(usage_pct) AS usage_percentage
      FROM player_game_usage
      WHERE usage_pct IS NOT NULL
      GROUP BY player_id
    ) agg
    WHERE pss.player_id = agg.player_id AND pss.season = ${season}
  `);
}

export interface PlayerStatsSyncResult {
  playersUpserted: number;
  statsUpserted: number;
  skippedNoTeam: number;
}

const EMPTY_RESULT: PlayerStatsSyncResult = { playersUpserted: 0, statsUpserted: 0, skippedNoTeam: 0 };

export async function syncPlayerStats(seasonLabel?: string): Promise<PlayerStatsSyncResult> {
  const season = seasonLabel ?? (await getCurrentSeason());
  if (!season) return EMPTY_RESULT;

  const seasonCode = seasonCodeFromLabel(season);
  const [traditional, advanced] = await Promise.all([
    fetchStatsPage<RawPlayerTraditional>("traditional", seasonCode),
    fetchStatsPage<RawPlayerAdvanced>("advanced", seasonCode),
  ]);
  if (traditional.length === 0) return EMPTY_RESULT;

  const advByCode = new Map(advanced.map((row) => [row.player.code, row]));

  const teamRows = await db.select({ id: teams.id, code: teams.code }).from(teams);
  const teamIdByCode = new Map(teamRows.map((t) => [t.code, t.id]));

  let playersUpserted = 0;
  let statsUpserted = 0;
  let skippedNoTeam = 0;

  for (const row of traditional) {
    // Players who changed teams mid-season have a compound code like
    // "OLY;PAR" — the last entry is their most recent team.
    const rawTeamCode = row.player.team.code;
    const teamCode = rawTeamCode.includes(";") ? rawTeamCode.split(";").pop()! : rawTeamCode;
    const teamId = teamIdByCode.get(teamCode);
    if (!teamId) {
      skippedNoTeam++;
      continue;
    }

    const [player] = await db
      .insert(players)
      .values({ code: row.player.code, teamId, name: row.player.name, photoUrl: row.player.imageUrl ?? null })
      .onConflictDoUpdate({
        target: players.code,
        set: { teamId, name: row.player.name, photoUrl: row.player.imageUrl ?? null },
      })
      .returning({ id: players.id });
    playersUpserted++;

    const statsFields = buildStatsFields(row, advByCode.get(row.player.code));

    await db
      .insert(playerSeasonStats)
      .values({ playerId: player.id, teamId, season, ...statsFields })
      .onConflictDoUpdate({
        target: [playerSeasonStats.playerId, playerSeasonStats.season],
        set: { teamId, ...statsFields },
      });
    statsUpserted++;
  }

  await syncUsagePercentage(season);

  return { playersUpserted, statsUpserted, skippedNoTeam };
}
