import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { shotEvents, pbpEvents, lineupStints } from "../db/schema.js";
import { fetchPlayByPlay, fetchFeedJson, parseEvents, buildStints, cleanPlayerCode } from "./playByPlay.js";

// Shots + play-by-play + lineup stints for finished games (2026-10-06).
//
// Shots used to come only from sync-py/shot_sync.py, run by hand. Production
// has no Python, so shot_events had nothing for 2026-27 and every player's
// shot chart was stuck on last season. This is its TS port, run in-process:
// once when a game goes final (liveGamesSync.ts) and hourly for any final
// game of the current season still missing data (index.ts), which is also
// what backfills a fresh deploy.

const POINTS_URL = "https://live.euroleague.net/api/Points";
const FIELD_GOAL_ACTIONS = new Set(["2FGM", "2FGA", "3FGM", "3FGA"]);
const INSERT_CHUNK = 500;
// Pause between games in a batch: the feed rate-limits bursts.
const BETWEEN_GAMES_MS = 2000;

interface ShotRow {
  NUM_ANOT: number;
  TEAM: string;
  ID_PLAYER: string;
  ID_ACTION: string;
  POINTS: number;
  COORD_X: number;
  COORD_Y: number;
  ZONE: string | null;
  MINUTE: number | null;
  FASTBREAK: string | null;
  SECOND_CHANCE: string | null;
}

type GameRow = {
  id: string;
  season: string;
  game_code: number;
  home_team_id: string;
  away_team_id: string;
  home_code: string;
  away_code: string;
};

function seasonCodeFor(season: string): string {
  return `E${season.slice(0, 4)}`;
}

async function fetchShots(season: string, gameCode: number): Promise<ShotRow[] | null> {
  const json = await fetchFeedJson<{ Rows?: ShotRow[] }>(`${POINTS_URL}?gamecode=${gameCode}&seasoncode=${seasonCodeFor(season)}`);
  return json?.Rows ?? null;
}

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) out.push(rows.slice(i, i + INSERT_CHUNK));
  return out;
}

export interface GameExtrasResult {
  shots: number;
  plays: number;
  stints: number;
  droppedSeconds: number;
}

/** Fetches and stores shots, play-by-play and lineup stints for one game. */
export async function syncGameExtras(gameId: string): Promise<GameExtrasResult | null> {
  const [game] = await db.execute<GameRow>(sql`
    select g.id, g.season, g.game_code, g.home_team_id, g.away_team_id, ht.code as home_code, at.code as away_code
    from games g join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
    where g.id = ${gameId}
  `);
  if (!game) return null;

  const teamIdByCode = new Map([
    [game.home_code, game.home_team_id],
    [game.away_code, game.away_team_id],
  ]);

  const [shots, pbp, playerRows] = await Promise.all([
    fetchShots(game.season, game.game_code),
    fetchPlayByPlay(seasonCodeFor(game.season), game.game_code),
    db.execute<{ id: string; code: string; team_id: string | null; is_starter: boolean | null }>(sql`
      select p.id, p.code, p.team_id, s.is_starter from players p
      left join player_game_stats s on s.player_id = p.id and s.game_id = ${gameId}
    `),
  ]);
  const playerIdByCode = new Map(playerRows.map((r) => [r.code, r.id]));

  let shotCount = 0;
  if (shots?.length) {
    const rows = shots.flatMap((r) => {
      const action = r.ID_ACTION.trim();
      const teamId = teamIdByCode.get(r.TEAM.trim());
      if (!FIELD_GOAL_ACTIONS.has(action) || !teamId) return [];
      const code = cleanPlayerCode(r.ID_PLAYER);
      return [{
        gameId,
        playerId: (code && playerIdByCode.get(code)) ?? null,
        teamId,
        season: game.season,
        numAnot: r.NUM_ANOT,
        actionId: action,
        made: action.endsWith("M"),
        points: r.POINTS,
        coordX: r.COORD_X,
        coordY: r.COORD_Y,
        zone: r.ZONE?.trim() || null,
        minute: r.MINUTE,
        fastbreak: r.FASTBREAK === "1",
        secondChance: r.SECOND_CHANCE === "1",
      }];
    });
    for (const chunk of chunks(rows)) {
      await db
        .insert(shotEvents)
        .values(chunk)
        .onConflictDoUpdate({
          target: [shotEvents.gameId, shotEvents.numAnot],
          set: {
            playerId: sql`excluded.player_id`,
            made: sql`excluded.made`,
            points: sql`excluded.points`,
            coordX: sql`excluded.coord_x`,
            coordY: sql`excluded.coord_y`,
          },
        });
    }
    shotCount = rows.length;
  }

  if (!pbp) return { shots: shotCount, plays: 0, stints: 0, droppedSeconds: 0 };
  const events = parseEvents(pbp);
  if (events.length === 0) return { shots: shotCount, plays: 0, stints: 0, droppedSeconds: 0 };

  // Box-score starters, only a fallback for period 1 (see buildStints).
  const sideTeam = { A: teamIdByCode.get(pbp.CodeTeamA.trim()), B: teamIdByCode.get(pbp.CodeTeamB.trim()) };
  const starters = { A: [] as string[], B: [] as string[] };
  for (const r of playerRows) {
    if (!r.is_starter) continue;
    if (r.team_id === sideTeam.A) starters.A.push(r.code);
    else if (r.team_id === sideTeam.B) starters.B.push(r.code);
  }
  const { stints, droppedSeconds } = buildStints(events, starters);

  // Home is side A in the feed; flip the running score if the feed ever
  // lists the away team first.
  const aIsHome = sideTeam.A === game.home_team_id;
  const playRows = events.map((e, i) => ({
    gameId,
    season: game.season,
    seq: e.seq,
    orderIdx: i,
    period: e.period,
    clockSeconds: e.clockSeconds,
    teamId: (e.teamCode && teamIdByCode.get(e.teamCode)) ?? null,
    playerCode: e.playerCode,
    playType: e.playType,
    points: e.points,
    homeScoreBefore: aIsHome ? e.homeScoreBefore : e.awayScoreBefore,
    awayScoreBefore: aIsHome ? e.awayScoreBefore : e.homeScoreBefore,
  }));
  const stintRows = stints.flatMap((s) => {
    const teamId = sideTeam[s.side];
    if (!teamId) return [];
    return [{
      gameId,
      season: game.season,
      teamId,
      playerCodes: s.playerCodes,
      seconds: s.seconds,
      ptsFor: s.own.pts,
      ptsAgainst: s.opp.pts,
      fgaFor: s.own.fga,
      ftaFor: s.own.fta,
      orebFor: s.own.oreb,
      tovFor: s.own.tov,
      fgaAgainst: s.opp.fga,
      ftaAgainst: s.opp.fta,
      orebAgainst: s.opp.oreb,
      tovAgainst: s.opp.tov,
    }];
  });

  // Derived data, rebuilt whole: clear this game's rows, then insert.
  await db.execute(sql`delete from pbp_events where game_id = ${gameId}`);
  await db.execute(sql`delete from lineup_stints where game_id = ${gameId}`);
  for (const chunk of chunks(playRows)) await db.insert(pbpEvents).values(chunk);
  for (const chunk of chunks(stintRows)) await db.insert(lineupStints).values(chunk);

  return { shots: shotCount, plays: playRows.length, stints: stintRows.length, droppedSeconds: droppedSeconds.A + droppedSeconds.B };
}

/**
 * Final games of `season` with no play-by-play stored yet, oldest first.
 * A game whose feed is still empty just stays in the list for next time.
 */
export async function syncMissingGameExtras(season: string, limit: number): Promise<{ synced: number; empty: number; failed: number }> {
  const rows = await db.execute<{ id: string }>(sql`
    select g.id from games g
    where g.season = ${season} and g.status = 'final'
      and not exists (select 1 from pbp_events e where e.game_id = g.id)
    order by g.tipoff_at
    limit ${limit}
  `);
  let synced = 0;
  let empty = 0;
  let failed = 0;
  for (const [i, r] of rows.entries()) {
    if (i > 0) await new Promise((res) => setTimeout(res, BETWEEN_GAMES_MS));
    const result = await syncGameExtras(r.id).catch((err) => {
      console.error(`[game extras] ${r.id} failed:`, err);
      return null;
    });
    if (!result) failed++;
    else if (result.plays > 0) synced++;
    else empty++;
  }
  return { synced, empty, failed };
}
