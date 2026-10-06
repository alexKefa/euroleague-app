import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { getRecentSeasons } from "./refereeStats.js";

// Short-rest splits (2026-10-06). EuroLeague's double-round weeks put teams
// on the floor twice in three days. Rest = calendar days since the team's
// previous final game that season; short = 2 or fewer, normal = 3+. A
// team's first game of a season has no rest value and is left out.
//
// League-wide, short rest barely moves win % (51% over 146 short-rest
// games in 2025-26) because in a double week both teams are usually tired.
// So the team view also splits by rest *matchup*: rested vs a tired
// opponent, tired vs a rested one, both tired.
//
// Covers the last two seasons for sample size. Player lines are tied to
// their team for that game the same way as services/refereeStats.ts
// (player_season_stats team, falling back to the current team).

export const SHORT_REST_MAX_DAYS = 2;
const TEAM_PLAYER_LIMIT = 10;

export type RestBucket = "short" | "normal";
export type RestMatchup = "edge" | "disadvantage" | "bothShort" | "bothNormal";

export interface TeamRestRow {
  key: RestBucket | RestMatchup;
  games: number;
  wins: number;
  ptsFor: number; // per game
  ptsAgainst: number; // per game
}

export interface PlayerRestLine {
  bucket: RestBucket;
  games: number;
  minutes: number | null;
  pts: number;
  reb: number;
  ast: number;
  pir: number;
  fgm: number; // totals, for FG%
  fga: number;
}

export interface PlayerRestSplit {
  player: { id: string; name: string };
  short: PlayerRestLine | null;
  normal: PlayerRestLine | null;
}

function teamGamesCte(seasonList: SQL) {
  return sql`
    team_games as (
      select g.id as game_id, g.season, g.tipoff_at, t.team_id, t.opp_id,
        ((t.team_id = g.home_team_id) = (g.home_score > g.away_score))::int as won,
        case when t.team_id = g.home_team_id then g.home_score else g.away_score end as pf,
        case when t.team_id = g.home_team_id then g.away_score else g.home_score end as pa
      from games g
      cross join lateral (values (g.home_team_id, g.away_team_id), (g.away_team_id, g.home_team_id)) as t(team_id, opp_id)
      where g.season in (${seasonList}) and g.status = 'final'
    ),
    rested as (
      select tg.*, tg.tipoff_at::date - lag(tg.tipoff_at::date) over (partition by tg.season, tg.team_id order by tg.tipoff_at) as days
      from team_games tg
    ),
    with_opp as (
      select r.*, o.days as opp_days,
        case when r.days <= ${SHORT_REST_MAX_DAYS} then 'short' else 'normal' end as bucket,
        case when o.days <= ${SHORT_REST_MAX_DAYS} then 'short' else 'normal' end as opp_bucket
      from rested r join rested o on o.game_id = r.game_id and o.team_id = r.opp_id
      where r.days is not null and o.days is not null
    ),
    lines as (
      select s.*, w.bucket
      from player_game_stats s
      join games g on g.id = s.game_id
      join players p on p.id = s.player_id
      left join player_season_stats pss on pss.player_id = s.player_id and pss.season = g.season
      join with_opp w on w.game_id = s.game_id and w.team_id = coalesce(pss.team_id, p.team_id)
      where coalesce(s.minutes, 0) > 0
    )`;
}

const playerLineJson = sql`json_build_object(
  'bucket', bucket, 'games', count(*)::int,
  'minutes', avg(minutes)::float, 'pts', avg(points)::float, 'reb', avg(rebounds)::float,
  'ast', avg(assists)::float, 'pir', avg(valuation)::float,
  'fgm', sum(coalesce(field_goals_made_2, 0) + coalesce(field_goals_made_3, 0))::int,
  'fga', sum(coalesce(field_goals_attempted_2, 0) + coalesce(field_goals_attempted_3, 0))::int)`;

export interface TeamRestSplits {
  seasons: string[];
  rows: TeamRestRow[];
  players: PlayerRestSplit[];
}

export async function getTeamRestSplits(teamId: string): Promise<TeamRestSplits> {
  const seasons = await getRecentSeasons(2);
  if (seasons.length === 0) return { seasons, rows: [], players: [] };
  const seasonList = sql.join(seasons.map((s) => sql`${s}`), sql`, `);

  const [row] = await db.execute<{ rows: TeamRestRow[] | null; players: PlayerRestSplit[] | null }>(sql`
    with ${teamGamesCte(seasonList)},
    mine as (
      select *,
        case
          when bucket = 'normal' and opp_bucket = 'short' then 'edge'
          when bucket = 'short' and opp_bucket = 'normal' then 'disadvantage'
          when bucket = 'short' then 'bothShort'
          else 'bothNormal'
        end as matchup
      from with_opp where team_id = ${teamId}
    ),
    split_rows as (
      select bucket as key, count(*)::int games, sum(won)::int wins, avg(pf)::float pf, avg(pa)::float pa from mine group by bucket
      union all
      select matchup, count(*)::int, sum(won)::int, avg(pf)::float, avg(pa)::float from mine group by matchup
    ),
    -- Current roster only, and only players with games on both sides.
    roster_lines as (
      select l.* from lines l join players p on p.id = l.player_id
      where p.team_id = ${teamId}
    ),
    per_bucket as (
      select player_id, bucket, ${playerLineJson} as line, sum(minutes) as total_min
      from roster_lines group by player_id, bucket
    ),
    players_both as (
      select player_id,
        max(line::text) filter (where bucket = 'short')::json as short,
        max(line::text) filter (where bucket = 'normal')::json as normal,
        sum(total_min) as total_min
      from per_bucket group by player_id
      having count(*) = 2
      order by sum(total_min) desc
      limit ${TEAM_PLAYER_LIMIT}
    )
    select
      (select json_agg(json_build_object('key', key, 'games', games, 'wins', wins, 'ptsFor', pf, 'ptsAgainst', pa)) from split_rows) as rows,
      (select json_agg(json_build_object(
        'player', json_build_object('id', p.id, 'name', p.name), 'short', pb.short, 'normal', pb.normal) order by pb.total_min desc)
        from players_both pb join players p on p.id = pb.player_id) as players
  `);
  return { seasons, rows: row?.rows ?? [], players: row?.players ?? [] };
}

export interface PlayerRestSplits {
  seasons: string[];
  short: PlayerRestLine | null;
  normal: PlayerRestLine | null;
}

export async function getPlayerRestSplits(playerId: string): Promise<PlayerRestSplits> {
  const seasons = await getRecentSeasons(2);
  if (seasons.length === 0) return { seasons, short: null, normal: null };
  const seasonList = sql.join(seasons.map((s) => sql`${s}`), sql`, `);

  const rows = await db.execute<{ bucket: RestBucket; line: PlayerRestLine }>(sql`
    with ${teamGamesCte(seasonList)}
    select bucket, ${playerLineJson} as line from lines where player_id = ${playerId} group by bucket
  `);
  return {
    seasons,
    short: rows.find((r) => r.bucket === "short")?.line ?? null,
    normal: rows.find((r) => r.bucket === "normal")?.line ?? null,
  };
}
