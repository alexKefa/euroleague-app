import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { computeFantasyGamePoints } from "./fantasyScoring.js";
import { cached, CACHE_KEYS } from "./responseCache.js";

/**
 * Defense vs position (2026-10-13): for every team, the fantasy points its
 * opponents' Guards / Forwards / Centers score against it per game, ranked
 * 1 = fewest allowed (toughest matchup). Fantasy points are the same
 * computeFantasyGamePoints the game scores with, summed over every opposing
 * player of that position in the game. Positions are each player's current
 * `players.position` (the feed has no per-game position).
 *
 * Early in a season a team's few games are noisy, so last season's per-game
 * average is blended in as PRIOR_GAMES pseudo-games that fade out as real
 * games accumulate (none left once a team has played PRIOR_GAMES).
 */
export type FantasyPosition = "Guard" | "Forward" | "Center";
export const FANTASY_POSITIONS: FantasyPosition[] = ["Guard", "Forward", "Center"];

export interface DvpEntry {
  allowed: number; // fantasy points allowed per game to this position
  rank: number; // 1 = fewest allowed among this season's teams
  games: number; // current-season games behind the number
}

export interface DefenseVsPosition {
  season: string;
  teamCount: number;
  teams: Record<string, Record<FantasyPosition, DvpEntry>>;
}

const PRIOR_GAMES = 8;
const r1 = (n: number) => Math.round(n * 10) / 10;

function previousSeason(season: string): string {
  const start = Number(season.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

type Row = Record<string, any>;

async function computeDefenseVsPosition(season: string): Promise<DefenseVsPosition> {
  const prior = previousSeason(season);
  // One row per (game, opposing player of a known position): the defending
  // team is whichever side the player's own team wasn't on that night.
  const rows = (await db.execute<Row>(sql`
    with team_games as (
      select g.id as game_id, g.season, g.home_team_id as team_id, g.away_team_id as opp_id, g.home_score > g.away_score as won
      from games g where g.status = 'final' and g.season in (${season}, ${prior})
      union all
      select g.id, g.season, g.away_team_id, g.home_team_id, g.away_score > g.home_score
      from games g where g.status = 'final' and g.season in (${season}, ${prior})
    )
    select tg.season, tg.opp_id as defending_team_id, tg.game_id, tg.won, p.position,
      s.points, s.rebounds, s.assists, s.steals, s.turnovers, s.blocks_favour, s.blocks_against,
      s.fouls_committed, s.fouls_received, s.field_goals_made_2, s.field_goals_attempted_2,
      s.field_goals_made_3, s.field_goals_attempted_3, s.free_throws_made, s.free_throws_attempted
    from team_games tg
    join player_game_stats s on s.game_id = tg.game_id
    join players p on p.id = s.player_id
    -- The player's club that season (a since-transferred player's current
    -- team_id would put last season's games on the wrong side).
    left join player_season_stats pss on pss.player_id = p.id and pss.season = tg.season
    where p.position in ('Guard', 'Forward', 'Center')
      and coalesce(pss.team_id, p.team_id) = tg.team_id
      and tg.opp_id in (
        select home_team_id from games where season = ${season}
        union select away_team_id from games where season = ${season}
      )
  `)) as Row[];

  // team -> season -> position -> total; team -> season -> game ids
  const totals = new Map<string, Map<string, Record<FantasyPosition, number>>>();
  const gameIds = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    const team: string = r.defending_team_id;
    const bySeason = totals.get(team) ?? new Map();
    totals.set(team, bySeason);
    const sums = bySeason.get(r.season) ?? { Guard: 0, Forward: 0, Center: 0 };
    bySeason.set(r.season, sums);
    sums[r.position as FantasyPosition] += computeFantasyGamePoints(
      {
        points: r.points,
        rebounds: r.rebounds,
        assists: r.assists,
        steals: r.steals,
        turnovers: r.turnovers,
        blocksFavour: r.blocks_favour,
        blocksAgainst: r.blocks_against,
        foulsCommitted: r.fouls_committed,
        foulsReceived: r.fouls_received,
        fieldGoalsMade2: r.field_goals_made_2,
        fieldGoalsAttempted2: r.field_goals_attempted_2,
        fieldGoalsMade3: r.field_goals_made_3,
        fieldGoalsAttempted3: r.field_goals_attempted_3,
        freeThrowsMade: r.free_throws_made,
        freeThrowsAttempted: r.free_throws_attempted,
      },
      r.won
    );
    const gSeason = gameIds.get(team) ?? new Map();
    gameIds.set(team, gSeason);
    const set = gSeason.get(r.season) ?? new Set();
    gSeason.set(r.season, set);
    set.add(r.game_id);
  }

  const allowed = new Map<string, { values: Record<FantasyPosition, number>; games: number }>();
  for (const [team, bySeason] of totals) {
    const cur = bySeason.get(season);
    const prev = bySeason.get(prior);
    const nCur = gameIds.get(team)?.get(season)?.size ?? 0;
    const nPrev = gameIds.get(team)?.get(prior)?.size ?? 0;
    // Prior season stands in for up to PRIOR_GAMES games at its own average.
    const w = nPrev > 0 ? Math.max(0, PRIOR_GAMES - nCur) : 0;
    if (nCur + w === 0) continue;
    const values = {} as Record<FantasyPosition, number>;
    for (const pos of FANTASY_POSITIONS) {
      const curSum = cur?.[pos] ?? 0;
      const prevAvg = nPrev > 0 ? (prev?.[pos] ?? 0) / nPrev : 0;
      values[pos] = (curSum + prevAvg * w) / (nCur + w);
    }
    allowed.set(team, { values, games: nCur });
  }

  const teams: DefenseVsPosition["teams"] = {};
  for (const team of allowed.keys()) teams[team] = {} as Record<FantasyPosition, DvpEntry>;
  for (const pos of FANTASY_POSITIONS) {
    const ordered = [...allowed.entries()].sort((a, b) => a[1].values[pos] - b[1].values[pos]);
    ordered.forEach(([team, v], i) => {
      teams[team][pos] = { allowed: r1(v.values[pos]), rank: i + 1, games: v.games };
    });
  }
  return { season, teamCount: allowed.size, teams };
}

/** Cached per season; it only moves when a game goes final (hourly-ish). */
export function getDefenseVsPosition(season: string): Promise<DefenseVsPosition> {
  return cached(CACHE_KEYS.fantasyDvp + season, 30 * 60_000, () => computeDefenseVsPosition(season));
}
