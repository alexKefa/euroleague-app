import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { getCurrentSeason } from "../season.js";
import { DQ_STATS, DqStat, DqTemplate, STAT_FLOOR, pickPair } from "./logic.js";

/**
 * Builds one user's Daily Question from real box scores (spec: "Question
 * types"). `last_night` when a final game was played the Athens day before
 * `day`; otherwise `last_game` or `last_3` 50/50, falling back to the other.
 * One query per template tried, each returning all five stats, so trying
 * another stat costs no round trip.
 */
export interface GeneratedQuestion {
  template: DqTemplate;
  stat: DqStat;
  playerAId: string;
  playerBId: string;
  valueA: number;
  valueB: number;
}

type Row = { player_id: string } & Record<DqStat, number | null>;

const MIN_MINUTES = 15;

async function candidates(template: DqTemplate, season: string, day: string): Promise<Row[]> {
  if (template === "last_night") {
    return (await db.execute<Row>(sql`
      select s.player_id, s.points, s.rebounds, s.assists, s.valuation as pir, s.field_goals_made_3 as threes
      from player_game_stats s
      join games g on g.id = s.game_id
      join players p on p.id = s.player_id
      where g.status = 'final' and g.season = ${season}
        and (g.tipoff_at at time zone 'Europe/Athens')::date = ${day}::date - 1
        and p.active and s.minutes >= ${MIN_MINUTES}
    `)) as Row[];
  }
  // A player's N most recent final games this season, all with real minutes.
  const n = template === "last_3" ? 3 : 1;
  return (await db.execute<Row>(sql`
    with ranked as (
      select s.player_id, s.minutes, s.points, s.rebounds, s.assists, s.valuation, s.field_goals_made_3,
        row_number() over (partition by s.player_id order by g.tipoff_at desc) as rn
      from player_game_stats s
      join games g on g.id = s.game_id
      where g.status = 'final' and g.season = ${season}
        and (g.tipoff_at at time zone 'Europe/Athens')::date < ${day}::date
    )
    select r.player_id, sum(r.points)::int as points, sum(r.rebounds)::int as rebounds, sum(r.assists)::int as assists,
      sum(r.valuation)::int as pir, sum(r.field_goals_made_3)::int as threes
    from ranked r
    join players p on p.id = r.player_id
    where r.rn <= ${n} and p.active
    group by r.player_id
    having count(*) = ${n} and min(r.minutes) >= ${MIN_MINUTES}
  `)) as Row[];
}

function shuffled<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function fromRows(template: DqTemplate, rows: Row[], rand: () => number): GeneratedQuestion | null {
  const games = template === "last_3" ? 3 : 1;
  for (const stat of shuffled(DQ_STATS, rand)) {
    const floor = STAT_FLOOR[stat] * games;
    const pool = rows
      .map((r) => ({ playerId: r.player_id, value: Number(r[stat] ?? 0) }))
      .filter((c) => c.value >= floor);
    const pair = pickPair(pool, rand);
    if (pair) {
      return { template, stat, playerAId: pair[0].playerId, playerBId: pair[1].playerId, valueA: pair[0].value, valueB: pair[1].value };
    }
  }
  return null;
}

export async function generateQuestion(day: string, rand: () => number = Math.random): Promise<GeneratedQuestion | null> {
  const season = await getCurrentSeason();
  if (!season) return null;

  const lastNight = await candidates("last_night", season, day);
  const order: DqTemplate[] = rand() < 0.5 ? ["last_game", "last_3"] : ["last_3", "last_game"];
  if (lastNight.length > 0) {
    const q = fromRows("last_night", lastNight, rand);
    if (q) return q;
  }
  for (const template of order) {
    const q = fromRows(template, await candidates(template, season, day), rand);
    if (q) return q;
  }
  return null;
}
