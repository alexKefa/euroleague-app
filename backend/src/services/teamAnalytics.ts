import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// Team page analytics (2026-10-06): shot profile vs league, best lineups,
// on/off, clutch. Built from shot_events, lineup_stints and pbp_events
// (sync/gameExtrasSync.ts). One statement, since latency here is round
// trips (see CLAUDE.md).
//
// Shot zones from the feed's coordinates (cm from the basket, y toward
// half-court, see the player shot chart): rim = within the 1.25m
// restricted arc; paint = inside the 4.9m-wide key, 5.8m from the baseline
// (basket is 1.575m in); corner three = a three with y up to 1.5m, the
// straight part of the line.
//
// Clutch = the NBA definition: last 5 minutes of the 4th quarter or any
// overtime, with the score within 5. Every play counts whose score *before*
// it was within 5.

const LINEUP_LIMIT = 8;
const CLUTCH_PLAYER_LIMIT = 10;

export type ShotZone = "rim" | "paint" | "mid" | "corner3" | "above3";

export interface ZoneStat {
  zone: ShotZone;
  fga: number;
  fgm: number;
  leagueFga: number;
  leagueFgm: number;
}

export interface AnalyticsPlayer {
  id: string | null;
  code: string;
  name: string | null;
}

export interface LineupStat {
  players: AnalyticsPlayer[];
  seconds: number;
  games: number;
  ptsFor: number;
  ptsAgainst: number;
  possFor: number;
  possAgainst: number;
}

export interface OnOffStat {
  player: AnalyticsPlayer;
  secondsOn: number;
  ptsForOn: number;
  ptsAgainstOn: number;
  possForOn: number;
  possAgainstOn: number;
  secondsOff: number;
  ptsForOff: number;
  ptsAgainstOff: number;
  possForOff: number;
  possAgainstOff: number;
}

export interface ClutchPlayerStat {
  player: AnalyticsPlayer;
  games: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  ast: number;
  tov: number;
}

export interface TeamAnalytics {
  season: string;
  gamesWithData: number;
  shotZones: ZoneStat[];
  lineups: LineupStat[];
  onOff: OnOffStat[];
  clutch: {
    games: number;
    wins: number;
    losses: number;
    ptsFor: number;
    ptsAgainst: number;
    players: ClutchPlayerStat[];
  };
}

const zoneSql = sql`case
  when s.action_id like '3%' then case when s.coord_y <= 150 then 'corner3' else 'above3' end
  when sqrt(s.coord_x::float * s.coord_x + s.coord_y::float * s.coord_y) <= 125 then 'rim'
  when abs(s.coord_x) <= 245 and s.coord_y <= 422 then 'paint'
  else 'mid' end`;

export async function getTeamAnalytics(teamId: string, season: string): Promise<TeamAnalytics> {
  const [row] = await db.execute<{ result: Omit<TeamAnalytics, "season"> }>(sql`
    with
    zones as (
      select ${zoneSql} as zone,
        count(*) filter (where s.team_id = ${teamId})::int as fga,
        count(*) filter (where s.team_id = ${teamId} and s.made)::int as fgm,
        count(*)::int as league_fga,
        count(*) filter (where s.made)::int as league_fgm
      from shot_events s where s.season = ${season}
      group by 1
    ),
    stints as (
      select player_codes, game_id, seconds, pts_for, pts_against,
        (fga_for - oreb_for + tov_for + 0.44 * fta_for) as poss_for,
        (fga_against - oreb_against + tov_against + 0.44 * fta_against) as poss_against
      from lineup_stints where team_id = ${teamId} and season = ${season}
    ),
    totals as (
      select coalesce(sum(seconds), 0) sec, coalesce(sum(pts_for), 0) pf, coalesce(sum(pts_against), 0) pa,
        coalesce(sum(poss_for), 0) posf, coalesce(sum(poss_against), 0) posa, count(distinct game_id)::int games
      from stints
    ),
    lineups as (
      select player_codes, sum(seconds)::int sec, count(distinct game_id)::int games,
        sum(pts_for)::int pf, sum(pts_against)::int pa, sum(poss_for)::float posf, sum(poss_against)::float posa
      from stints group by player_codes order by sum(seconds) desc limit ${LINEUP_LIMIT}
    ),
    on_court as (
      select c.code, sum(st.seconds)::int sec, sum(st.pts_for)::int pf, sum(st.pts_against)::int pa,
        sum(st.poss_for)::float posf, sum(st.poss_against)::float posa
      from stints st cross join lateral unnest(st.player_codes) as c(code)
      group by c.code
    ),
    clutch_games as (
      select g.id, g.home_team_id = ${teamId} as is_home,
        (g.home_team_id = ${teamId}) = (g.home_score > g.away_score) as won
      from games g
      where g.season = ${season} and g.status = 'final' and ${teamId} in (g.home_team_id, g.away_team_id)
        and exists (
          select 1 from pbp_events e where e.game_id = g.id and e.period >= 4 and e.clock_seconds <= 300
            and abs(e.home_score_before - e.away_score_before) <= 5
        )
    ),
    clutch_plays as (
      select e.* from pbp_events e join clutch_games cg on cg.id = e.game_id
      where e.period >= 4 and e.clock_seconds <= 300 and abs(e.home_score_before - e.away_score_before) <= 5
    ),
    clutch_players as (
      select player_code as code, count(distinct game_id)::int games,
        sum(points)::int pts,
        count(*) filter (where play_type in ('2FGM', '3FGM'))::int fgm,
        count(*) filter (where play_type in ('2FGM', '2FGA', '3FGM', '3FGA'))::int fga,
        count(*) filter (where play_type = '3FGM')::int tpm,
        count(*) filter (where play_type in ('3FGM', '3FGA'))::int tpa,
        count(*) filter (where play_type = 'FTM')::int ftm,
        count(*) filter (where play_type in ('FTM', 'FTA'))::int fta,
        count(*) filter (where play_type = 'AS')::int ast,
        count(*) filter (where play_type = 'TO')::int tov
      from clutch_plays
      where team_id = ${teamId} and player_code is not null
      group by player_code
      having sum(points) > 0 or count(*) filter (where play_type in ('2FGM', '2FGA', '3FGM', '3FGA', 'AS')) > 0
      order by sum(points) desc, count(*) filter (where play_type = 'AS') desc
      limit ${CLUTCH_PLAYER_LIMIT}
    )
    select json_build_object(
      'gamesWithData', (select games from totals),
      'shotZones', coalesce((select json_agg(json_build_object(
          'zone', zone, 'fga', fga, 'fgm', fgm, 'leagueFga', league_fga, 'leagueFgm', league_fgm)) from zones), '[]'::json),
      'lineups', coalesce((select json_agg(json_build_object(
          'players', (select json_agg(json_build_object('id', p.id, 'code', c.code, 'name', p.name) order by p.name)
                      from unnest(l.player_codes) c(code) left join players p on p.code = c.code),
          'seconds', l.sec, 'games', l.games, 'ptsFor', l.pf, 'ptsAgainst', l.pa,
          'possFor', l.posf, 'possAgainst', l.posa) order by l.sec desc) from lineups l), '[]'::json),
      'onOff', coalesce((select json_agg(json_build_object(
          'player', json_build_object('id', p.id, 'code', o.code, 'name', p.name),
          'secondsOn', o.sec, 'ptsForOn', o.pf, 'ptsAgainstOn', o.pa, 'possForOn', o.posf, 'possAgainstOn', o.posa,
          'secondsOff', t.sec - o.sec, 'ptsForOff', t.pf - o.pf, 'ptsAgainstOff', t.pa - o.pa,
          'possForOff', t.posf - o.posf, 'possAgainstOff', t.posa - o.posa) order by o.sec desc)
        from on_court o cross join totals t left join players p on p.code = o.code), '[]'::json),
      'clutch', json_build_object(
        'games', (select count(*)::int from clutch_games),
        'wins', (select count(*) filter (where won)::int from clutch_games),
        'losses', (select count(*) filter (where not won)::int from clutch_games),
        'ptsFor', (select coalesce(sum(points) filter (where team_id = ${teamId}), 0)::int from clutch_plays),
        'ptsAgainst', (select coalesce(sum(points) filter (where team_id is distinct from ${teamId} and team_id is not null), 0)::int from clutch_plays),
        'players', coalesce((select json_agg(json_build_object(
            'player', json_build_object('id', p.id, 'code', cp.code, 'name', p.name),
            'games', cp.games, 'pts', cp.pts, 'fgm', cp.fgm, 'fga', cp.fga, 'tpm', cp.tpm, 'tpa', cp.tpa,
            'ftm', cp.ftm, 'fta', cp.fta, 'ast', cp.ast, 'tov', cp.tov) order by cp.pts desc, cp.ast desc)
          from clutch_players cp left join players p on p.code = cp.code), '[]'::json)
      )
    ) as result
  `);
  return { season, ...row.result };
}

export interface ClutchLeader extends ClutchPlayerStat {
  team: { id: string; code: string; primaryColor: string | null } | null;
}

const CLUTCH_LEADER_LIMIT = 15;

/** League-wide clutch scorers for the Stats page, same clutch definition. */
export async function getClutchLeaders(season: string): Promise<ClutchLeader[]> {
  const rows = await db.execute<{ result: ClutchLeader[] | null }>(sql`
    with clutch_plays as (
      select e.* from pbp_events e
      where e.season = ${season} and e.period >= 4 and e.clock_seconds <= 300
        and abs(e.home_score_before - e.away_score_before) <= 5
        and e.player_code is not null and e.team_id is not null
    ),
    leaders as (
      select player_code as code, team_id, count(distinct game_id)::int games,
        sum(points)::int pts,
        count(*) filter (where play_type in ('2FGM', '3FGM'))::int fgm,
        count(*) filter (where play_type in ('2FGM', '2FGA', '3FGM', '3FGA'))::int fga,
        count(*) filter (where play_type = '3FGM')::int tpm,
        count(*) filter (where play_type in ('3FGM', '3FGA'))::int tpa,
        count(*) filter (where play_type = 'FTM')::int ftm,
        count(*) filter (where play_type in ('FTM', 'FTA'))::int fta,
        count(*) filter (where play_type = 'AS')::int ast,
        count(*) filter (where play_type = 'TO')::int tov
      from clutch_plays
      group by player_code, team_id
      having sum(points) > 0
      order by sum(points) desc, count(*) filter (where play_type in ('2FGM', '3FGM')) desc
      limit ${CLUTCH_LEADER_LIMIT}
    )
    select json_agg(json_build_object(
      'player', json_build_object('id', p.id, 'code', l.code, 'name', p.name),
      'team', json_build_object('id', t.id, 'code', t.code, 'primaryColor', t.primary_color),
      'games', l.games, 'pts', l.pts, 'fgm', l.fgm, 'fga', l.fga, 'tpm', l.tpm, 'tpa', l.tpa,
      'ftm', l.ftm, 'fta', l.fta, 'ast', l.ast, 'tov', l.tov) order by l.pts desc, l.fgm desc) as result
    from leaders l left join players p on p.code = l.code join teams t on t.id = l.team_id
  `);
  return rows[0]?.result ?? [];
}
