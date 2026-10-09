// Game story cards (2026-10-09): everything about one final game, in three
// statements (latency here is round trips): the game, teams and box score
// (with each player's previous highs and last five games); the game's
// lineup stints; and its scoring plays.
import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { derivePlays, formatName, type ScoringEvent } from "./plays.js";
import type { GameFacts, LineFacts, StintFacts, TeamFacts } from "./types.js";

// db.execute needs plain object types (interfaces lack an index signature).
type Row<T> = { [K in keyof T]: T[K] };

type GameRow = {
  game: {
    id: string;
    season: string;
    round: number | null;
    tipoffAt: string;
    status: string;
    quarters: number | null;
    home: TeamFacts;
    away: TeamFacts;
  } | null;
  lines: (Omit<LineFacts, "name"> & { name: string })[] | null;
};

const teamJson = (alias: string, score: string) =>
  sql.raw(
    `json_build_object('id', ${alias}.id, 'code', ${alias}.code, 'name', ${alias}.name, 'primaryColor', ${alias}.primary_color, 'secondaryColor', ${alias}.secondary_color, 'logoUrl', ${alias}.logo_url, 'score', coalesce(${score}, 0))`
  );

/** null = unknown game or not final. */
export async function loadGameFacts(gameId: string): Promise<GameFacts | null> {
  // 1. Game, teams, box score.
  const [row] = await db.execute<GameRow>(sql`
    with g as (select * from games where id = ${gameId}),
    lines as (
      select s.*, p.code as player_code, p.name as player_name,
        case
          when pss.team_id in (select home_team_id from g union select away_team_id from g) then pss.team_id
          when p.team_id in (select home_team_id from g union select away_team_id from g) then p.team_id
        end as line_team_id
      from player_game_stats s
      join players p on p.id = s.player_id
      left join player_season_stats pss on pss.player_id = s.player_id and pss.season = (select season from g)
      where s.game_id = ${gameId}
    )
    select
      (select json_build_object(
          'id', g.id, 'season', g.season, 'round', g.round, 'tipoffAt', g.tipoff_at, 'status', g.status,
          'quarters', jsonb_array_length(coalesce(g.home_score_by_quarter, '[]'::jsonb)),
          'home', ${teamJson("ht", "g.home_score")}, 'away', ${teamJson("at", "g.away_score")})
        from g join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id) as game,
      (select json_agg(json_build_object(
          'playerCode', l.player_code, 'name', l.player_name, 'teamId', l.line_team_id, 'isStarter', l.is_starter,
          'points', coalesce(l.points, 0), 'rebounds', coalesce(l.rebounds, 0), 'offRebounds', coalesce(l.offensive_rebounds, 0),
          'assists', coalesce(l.assists, 0), 'steals', coalesce(l.steals, 0), 'blocks', coalesce(l.blocks_favour, 0),
          'pir', coalesce(l.valuation, 0), 'plusMinus', l.plus_minus, 'minutes', l.minutes,
          'fg2m', coalesce(l.field_goals_made_2, 0), 'fg2a', coalesce(l.field_goals_attempted_2, 0),
          'fg3m', coalesce(l.field_goals_made_3, 0), 'fg3a', coalesce(l.field_goals_attempted_3, 0),
          'ftm', coalesce(l.free_throws_made, 0), 'fta', coalesce(l.free_throws_attempted, 0),
          'prevHighPoints', (select max(s2.points) from player_game_stats s2 join games g2 on g2.id = s2.game_id
            where s2.player_id = l.player_id and g2.status = 'final' and g2.tipoff_at < (select tipoff_at from g)),
          'prevHighPir', (select max(s2.valuation) from player_game_stats s2 join games g2 on g2.id = s2.game_id
            where s2.player_id = l.player_id and g2.status = 'final' and g2.tipoff_at < (select tipoff_at from g)),
          'last5Points', (select coalesce(json_agg(x.points order by x.tipoff_at), '[]'::json) from (
            select coalesce(s3.points, 0) as points, g3.tipoff_at from player_game_stats s3 join games g3 on g3.id = s3.game_id
            where s3.player_id = l.player_id and g3.status = 'final' and g3.tipoff_at <= (select tipoff_at from g)
            order by g3.tipoff_at desc limit 5) x)))
        from lines l where l.line_team_id is not null) as lines`);
  const game = row?.game;
  if (!game || game.status !== "final") return null;

  // 2. Lineup stints (same possession estimate as teamAnalytics.ts).
  const stints = await db.execute<Row<StintFacts>>(sql`
    select team_id as "teamId", player_codes as "playerCodes", seconds, pts_for as "ptsFor", pts_against as "ptsAgainst",
      (fga_for - oreb_for + tov_for + 0.44 * fta_for)::float as "possFor",
      (fga_against - oreb_against + tov_against + 0.44 * fta_against)::float as "possAgainst"
    from lineup_stints where game_id = ${gameId}`);

  // 3. Scoring plays.
  const events = await db.execute<Row<ScoringEvent>>(sql`
    select period, clock_seconds as clock, team_id as "teamId", player_code as "playerCode", play_type as "playType",
      points, home_score_before as "homeBefore", away_score_before as "awayBefore"
    from pbp_events where game_id = ${gameId} and points > 0 order by order_idx`);

  const lines: LineFacts[] = (row.lines ?? []).map((l) => ({ ...l, name: formatName(l.name) }));
  const names = new Map(lines.map((l) => [l.playerCode, l.name]));
  const plays = derivePlays([...events], names, game.home.id);

  return {
    gameId: game.id,
    season: game.season,
    round: game.round,
    tipoffAt: game.tipoffAt,
    home: game.home,
    away: game.away,
    overtime: plays.overtime || (game.quarters ?? 0) > 4,
    lines,
    stints: [...stints],
    margins: plays.margins,
    clutchPoints: plays.clutchPoints,
    clutchPlays: plays.clutchPlays,
  };
}
