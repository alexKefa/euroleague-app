import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * Player scouting report (2026-10-01): where a player ranks among his
 * position on a set of profile metrics (percentiles), his last-5 form
 * against his season line, splits, and the most statistically similar
 * players. Everything is derived from player_game_stats.
 *
 * Season: the latest one in which the player has MIN_GAMES games, so the
 * percentiles aren't built on two games in early October (falls back to
 * his latest season with any games). The comparison pool is every player
 * with MIN_GAMES games and MIN_MPG minutes a game that season.
 */

const MIN_GAMES = 5;
const MIN_MPG = 10;
const POOL_TTL_MS = 10 * 60 * 1000;

export type ScoutingMetricKey =
  | "scoring"
  | "efficiency"
  | "threes"
  | "rebounding"
  | "playmaking"
  | "ballSecurity"
  | "defense"
  | "foulDrawing"
  | "impact";

// higherIsBetter false: a lower value ranks higher (turnovers).
const METRICS: { key: ScoutingMetricKey; higherIsBetter: boolean }[] = [
  { key: "scoring", higherIsBetter: true },
  { key: "efficiency", higherIsBetter: true },
  { key: "threes", higherIsBetter: true },
  { key: "rebounding", higherIsBetter: true },
  { key: "playmaking", higherIsBetter: true },
  { key: "ballSecurity", higherIsBetter: false },
  { key: "defense", higherIsBetter: true },
  { key: "foulDrawing", higherIsBetter: true },
  { key: "impact", higherIsBetter: true },
];

interface PoolPlayer {
  id: string;
  name: string;
  position: string | null;
  photoUrl: string | null;
  team: { code: string | null; logoUrl: string | null };
  games: number;
  values: Record<ScoutingMetricKey, number>;
}

type Row = Record<string, any>;

const poolCache = new Map<string, { at: number; pool: PoolPlayer[] }>();

function metricValues(r: Row): Record<ScoutingMetricKey, number> {
  const gp = Number(r.gp);
  const min = Number(r.minutes);
  const pts = Number(r.points);
  const fga = Number(r.fga2) + Number(r.fga3);
  const fta = Number(r.fta);
  const tsDenominator = 2 * (fga + 0.44 * fta);
  return {
    scoring: pts / gp,
    efficiency: tsDenominator > 0 ? (pts / tsDenominator) * 100 : 0,
    threes: Number(r.fgm3) / gp,
    rebounding: Number(r.rebounds) / gp,
    playmaking: Number(r.assists) / gp,
    // Per 36 minutes, so a starter isn't punished just for playing more.
    ballSecurity: min > 0 ? (Number(r.turnovers) / min) * 36 : 0,
    defense: (Number(r.steals) + Number(r.blocks)) / gp,
    foulDrawing: Number(r.fouls_received) / gp,
    impact: Number(r.valuation) / gp,
  };
}

async function getPool(season: string): Promise<PoolPlayer[]> {
  const cached = poolCache.get(season);
  if (cached && Date.now() - cached.at < POOL_TTL_MS) return cached.pool;
  const rows = (await db.execute<Row>(sql`
    select p.id, p.name, p.position, p.photo_url, t.code as team_code, t.logo_url as team_logo,
      count(*) as gp, sum(pgs.minutes) as minutes, sum(pgs.points) as points,
      sum(pgs.field_goals_attempted_2) as fga2, sum(pgs.field_goals_attempted_3) as fga3,
      sum(pgs.field_goals_made_3) as fgm3, sum(pgs.free_throws_attempted) as fta,
      sum(pgs.rebounds) as rebounds, sum(pgs.assists) as assists, sum(pgs.turnovers) as turnovers,
      sum(pgs.steals) as steals, sum(pgs.blocks_favour) as blocks, sum(pgs.fouls_received) as fouls_received,
      sum(pgs.valuation) as valuation
    from player_game_stats pgs
    join games g on g.id = pgs.game_id
    join players p on p.id = pgs.player_id
    left join teams t on t.id = p.team_id
    where g.season = ${season} and g.status = 'final' and pgs.minutes > 0
    group by p.id, t.code, t.logo_url
    having count(*) >= ${MIN_GAMES} and sum(pgs.minutes) / count(*) >= ${MIN_MPG}
  `)) as Row[];
  const pool = rows.map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    photoUrl: r.photo_url,
    team: { code: r.team_code, logoUrl: r.team_logo },
    games: Number(r.gp),
    values: metricValues(r),
  }));
  poolCache.set(season, { at: Date.now(), pool });
  return pool;
}

function percentile(value: number, others: number[], higherIsBetter: boolean): number {
  if (others.length === 0) return 50;
  const below = others.filter((v) => (higherIsBetter ? v < value : v > value)).length;
  const equal = others.filter((v) => v === value).length;
  return Math.round(((below + equal / 2) / others.length) * 100);
}

export interface ScoutingSplit {
  key: "home" | "away" | "wins" | "losses" | "starter" | "bench";
  games: number;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  pir: number | null;
}

export interface ScoutingReport {
  season: string;
  seasonGames: number;
  position: string | null;
  poolSize: number;
  // False when the player is below the pool's games/minutes bar: he's then
  // ranked against the pool without being part of it.
  qualified: boolean;
  metrics: { key: ScoutingMetricKey; value: number; percentile: number }[];
  form: {
    games: number;
    last5: { points: number; rebounds: number; assists: number; pir: number } | null;
    season: { points: number; rebounds: number; assists: number; pir: number } | null;
  };
  splits: ScoutingSplit[];
  similar: {
    id: string;
    name: string;
    position: string | null;
    photoUrl: string | null;
    team: { code: string | null; logoUrl: string | null };
    similarity: number;
  }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function getScoutingReport(playerId: string): Promise<ScoutingReport | null> {
  // The player's games across every season, newest first — drives season
  // choice, form, splits and his own metric line.
  const games = (await db.execute<Row>(sql`
    select g.season, g.tipoff_at, g.home_team_id, g.away_team_id, g.home_score, g.away_score,
      p.position,
      pgs.is_starter, pgs.minutes, pgs.points, pgs.rebounds, pgs.assists, pgs.valuation,
      pgs.field_goals_attempted_2, pgs.field_goals_attempted_3, pgs.field_goals_made_3, pgs.free_throws_attempted,
      pgs.turnovers, pgs.steals, pgs.blocks_favour, pgs.fouls_received
    from player_game_stats pgs
    join games g on g.id = pgs.game_id
    join players p on p.id = pgs.player_id
    where pgs.player_id = ${playerId} and g.status = 'final' and pgs.minutes > 0
    order by g.tipoff_at desc
  `)) as Row[];
  if (games.length === 0) return null;

  const bySeason = new Map<string, Row[]>();
  for (const g of games) {
    const arr = bySeason.get(g.season) ?? [];
    arr.push(g);
    bySeason.set(g.season, arr);
  }
  const seasons = [...bySeason.keys()].sort().reverse();
  const season = seasons.find((s) => bySeason.get(s)!.length >= MIN_GAMES) ?? seasons[0];
  const seasonGames = bySeason.get(season)!;
  const position: string | null = games[0].position;

  const sum = (rows: Row[], k: string) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const own = metricValues({
    gp: seasonGames.length,
    minutes: sum(seasonGames, "minutes"),
    points: sum(seasonGames, "points"),
    fga2: sum(seasonGames, "field_goals_attempted_2"),
    fga3: sum(seasonGames, "field_goals_attempted_3"),
    fgm3: sum(seasonGames, "field_goals_made_3"),
    fta: sum(seasonGames, "free_throws_attempted"),
    rebounds: sum(seasonGames, "rebounds"),
    assists: sum(seasonGames, "assists"),
    turnovers: sum(seasonGames, "turnovers"),
    steals: sum(seasonGames, "steals"),
    blocks: sum(seasonGames, "blocks_favour"),
    fouls_received: sum(seasonGames, "fouls_received"),
    valuation: sum(seasonGames, "valuation"),
  });

  const pool = await getPool(season);
  const peers = pool.filter((p) => p.id !== playerId && (position === null || p.position === position));
  const qualified = pool.some((p) => p.id === playerId);

  const metrics = METRICS.map(({ key, higherIsBetter }) => ({
    key,
    value: r1(own[key]),
    percentile: percentile(own[key], peers.map((p) => p.values[key]), higherIsBetter),
  }));

  // Similar players: nearest neighbours across the whole pool (any
  // position) on z-scored metrics, so no single stat's scale dominates.
  const stats = METRICS.map(({ key }) => {
    const xs = pool.map((p) => p.values[key]);
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length || 1)) || 1;
    return { key, mean, sd };
  });
  const z = (v: Record<ScoutingMetricKey, number>) => stats.map(({ key, mean, sd }) => (v[key] - mean) / sd);
  const ownZ = z(own);
  const similar = pool
    .filter((p) => p.id !== playerId)
    .map((p) => {
      const pz = z(p.values);
      const dist = Math.sqrt(pz.reduce((a, v, i) => a + (v - ownZ[i]) ** 2, 0));
      return { p, dist };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5)
    .map(({ p, dist }) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      photoUrl: p.photoUrl,
      team: p.team,
      // 100 at identical profiles, falling off with distance.
      similarity: Math.max(0, Math.round(100 - dist * 20)),
    }));

  const line = (rows: Row[]) =>
    rows.length === 0
      ? null
      : {
          points: r1(sum(rows, "points") / rows.length),
          rebounds: r1(sum(rows, "rebounds") / rows.length),
          assists: r1(sum(rows, "assists") / rows.length),
          pir: r1(sum(rows, "valuation") / rows.length),
        };

  // Box scores don't store the player's team and players.team_id is only
  // his current club, so a transferred player's old games would all read
  // as one side. His team that season is the one in (nearly) every game.
  const teamCount = new Map<string, number>();
  for (const g of seasonGames) {
    for (const t of [g.home_team_id, g.away_team_id]) teamCount.set(t, (teamCount.get(t) ?? 0) + 1);
  }
  const seasonTeam = [...teamCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const isHome = (g: Row) => g.home_team_id === seasonTeam;
  const won = (g: Row) => {
    if (g.home_score === null || g.away_score === null) return false;
    return isHome(g) ? g.home_score > g.away_score : g.away_score > g.home_score;
  };
  const split = (key: ScoutingSplit["key"], rows: Row[]): ScoutingSplit => {
    const l = line(rows);
    return { key, games: rows.length, points: l?.points ?? null, rebounds: l?.rebounds ?? null, assists: l?.assists ?? null, pir: l?.pir ?? null };
  };

  return {
    season,
    seasonGames: seasonGames.length,
    position,
    poolSize: peers.length,
    qualified,
    metrics,
    form: { games: Math.min(5, games.length), last5: line(games.slice(0, 5)), season: line(seasonGames) },
    splits: [
      split("home", seasonGames.filter(isHome)),
      split("away", seasonGames.filter((g) => !isHome(g))),
      split("wins", seasonGames.filter(won)),
      split("losses", seasonGames.filter((g) => !won(g))),
      split("starter", seasonGames.filter((g) => g.is_starter === true)),
      split("bench", seasonGames.filter((g) => g.is_starter === false)),
    ],
    similar,
  };
}
