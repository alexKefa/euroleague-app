import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// Referee tracker (2026-10-06). Per referee, over the last two seasons
// (one season is ~30-40 games per referee, too noisy alone): games worked,
// fouls and free throws per game, home win %, and home-minus-away fouls
// and free throws, all next to the same numbers for every game in the
// sample. Plain numbers only; the page makes no claims about bias.
//
// Fouls/FTA come from player box scores. A player's team for a game is
// their player_season_stats team for that season (falls back to their
// current team), so last season's numbers aren't credited to a player's
// new club. Lines that resolve to neither team in the game are dropped.

export interface RefereeRow {
  id: string;
  name: string;
  games: number;
  fouls: number; // per game, both teams
  fta: number; // per game, both teams
  homeWinPct: number;
  foulDiff: number; // home minus away, per game
  ftaDiff: number; // home minus away, per game
}

export interface RefereeStats {
  seasons: string[];
  league: Omit<RefereeRow, "id" | "name">;
  referees: RefereeRow[];
}

export async function getRecentSeasons(count: number): Promise<string[]> {
  const rows = await db.execute<{ season: string }>(
    sql`select distinct season from games where status = 'final' order by season desc limit ${count}`
  );
  return rows.map((r) => r.season);
}

export async function getRefereeStats(): Promise<RefereeStats> {
  const seasons = await getRecentSeasons(2);
  if (seasons.length === 0) return { seasons, league: emptyLeague(), referees: [] };
  const seasonList = sql.join(seasons.map((s) => sql`${s}`), sql`, `);

  const [row] = await db.execute<{ league: RefereeStats["league"] | null; referees: RefereeRow[] | null }>(sql`
    with
    lines as (
      select s.game_id, coalesce(pss.team_id, p.team_id) as team_id, s.fouls_committed as pf, s.free_throws_attempted as fta
      from player_game_stats s
      join games g on g.id = s.game_id
      join players p on p.id = s.player_id
      left join player_season_stats pss on pss.player_id = s.player_id and pss.season = g.season
      where g.season in (${seasonList}) and g.status = 'final'
    ),
    gt as (
      select g.id as game_id, (g.home_score > g.away_score)::int as home_won,
        sum(l.pf) filter (where l.team_id = g.home_team_id) as home_pf,
        sum(l.pf) filter (where l.team_id = g.away_team_id) as away_pf,
        sum(l.fta) filter (where l.team_id = g.home_team_id) as home_fta,
        sum(l.fta) filter (where l.team_id = g.away_team_id) as away_fta
      from games g join lines l on l.game_id = g.id
      group by g.id
      having sum(l.pf) filter (where l.team_id = g.home_team_id) is not null
        and sum(l.pf) filter (where l.team_id = g.away_team_id) is not null
    ),
    refs as (
      select r.id, r.name, count(*)::int as games,
        avg(gt.home_pf + gt.away_pf)::float as fouls,
        avg(gt.home_fta + gt.away_fta)::float as fta,
        (100 * avg(gt.home_won))::float as home_win_pct,
        avg(gt.home_pf - gt.away_pf)::float as foul_diff,
        avg(gt.home_fta - gt.away_fta)::float as fta_diff
      from game_referees gr join referees r on r.id = gr.referee_id join gt on gt.game_id = gr.game_id
      group by r.id, r.name
    )
    select
      (select json_build_object(
        'games', count(*)::int,
        'fouls', avg(home_pf + away_pf)::float,
        'fta', avg(home_fta + away_fta)::float,
        'homeWinPct', (100 * avg(home_won))::float,
        'foulDiff', avg(home_pf - away_pf)::float,
        'ftaDiff', avg(home_fta - away_fta)::float)
        from gt where exists (select 1 from game_referees gr where gr.game_id = gt.game_id)) as league,
      (select json_agg(json_build_object(
        'id', id, 'name', name, 'games', games, 'fouls', fouls, 'fta', fta,
        'homeWinPct', home_win_pct, 'foulDiff', foul_diff, 'ftaDiff', fta_diff) order by games desc, name)
        from refs) as referees
  `);
  return { seasons, league: row?.league ?? emptyLeague(), referees: row?.referees ?? [] };
}

function emptyLeague(): RefereeStats["league"] {
  return { games: 0, fouls: 0, fta: 0, homeWinPct: 0, foulDiff: 0, ftaDiff: 0 };
}

/** The crew of one game, crew chief first (for the game page). */
export async function getGameReferees(gameId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db.execute<{ id: string; name: string }>(sql`
    select r.id, r.name from game_referees gr join referees r on r.id = gr.referee_id
    where gr.game_id = ${gameId} order by gr.position
  `);
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
