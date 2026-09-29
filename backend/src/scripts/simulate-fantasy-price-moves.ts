/**
 * Read-only replay of Fantasy Five's round-to-round price formulas
 * (services/fantasyDailyReprice.ts) over N rounds, using each player's and
 * team's *real* 2025-26 box scores/results for rounds 1..N as stand-ins for
 * 2026-27 performances. Writes nothing.
 *
 * Starting prices = each entity's current 2026-27 price as-is (not
 * reconstructed from the change logs — a real-quotation import can
 * overwrite prices after moves were logged, so subtracting them is wrong).
 *
 * Usage: DATABASE_URL=<dev url> npx tsx src/scripts/simulate-fantasy-price-moves.ts [rounds=6] [fromSeason=2025-26]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  computeFantasyGamePoints,
  pointsForCoachResult,
  FANTASY_MIN_PRICE,
  COACH_MIN_PRICE,
  FANTASY_BUDGET_CAP,
} from "../services/fantasyScoring.js";
import {
  FANTASY_PRICE_VARIATION_MULTIPLIER,
  FANTASY_PRICE_VARIATION_DIVISOR,
  COACH_PRICE_VARIATION_DIVISOR,
  DAILY_PRICE_MAX_DELTA,
} from "../services/fantasyDailyReprice.js";

const ROUNDS = Number(process.argv[2] ?? 6);
const FROM_SEASON = process.argv[3] ?? "2025-26";
const SEASON = "2026-27";

const clamp = (d: number) => Math.max(-DAILY_PRICE_MAX_DELTA, Math.min(DAILY_PRICE_MAX_DELTA, d));
const r1 = (n: number) => Math.round(n * 10) / 10;
const f = (n: number, w = 6) => (n >= 0 ? "+" : "") + n.toFixed(1).padStart(w - 1);

type Row = Record<string, any>;

async function main() {
  const players = (await db.execute<Row>(sql`
    select p.id, p.name, p.position, p.team_id, t.code as team,
      pfp.price as start_price
    from player_fantasy_prices pfp
    join players p on p.id = pfp.player_id
    join teams t on t.id = p.team_id
    where pfp.season = ${SEASON} and p.active
  `)) as Row[];

  const coaches = (await db.execute<Row>(sql`
    select t.id, t.code as team, t.head_coach as name,
      c.price as start_price
    from coach_fantasy_prices c join teams t on t.id = c.team_id
    where c.season = ${SEASON}
  `)) as Row[];

  const box = (await db.execute<Row>(sql`
    select pgs.*, g.round, g.home_team_id, g.away_team_id, g.home_score, g.away_score
    from player_game_stats pgs
    join games g on g.id = pgs.game_id and g.season = ${FROM_SEASON} and g.status = 'final' and g.round <= ${ROUNDS}
  `)) as Row[];

  const teamGames = (await db.execute<Row>(sql`
    select round, home_team_id, away_team_id, home_score, away_score from games
    where season = ${FROM_SEASON} and status = 'final' and round <= ${ROUNDS}
  `)) as Row[];

  // A player's real team for each 2025-26 game: infer it as whichever side of
  // that game their teammates (same current team) mostly sit on isn't knowable,
  // so use "the side that shares the most of this player's 2025-26 game list"
  // â simplest proxy: majority side across their rounds.
  const boxByPlayer = new Map<string, Row[]>();
  for (const b of box) {
    if (!boxByPlayer.has(b.player_id)) boxByPlayer.set(b.player_id, []);
    boxByPlayer.get(b.player_id)!.push(b);
  }
  const teamCount = (rows: Row[]) => {
    const c = new Map<string, number>();
    for (const r of rows) for (const t of [r.home_team_id, r.away_team_id]) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };

  interface PSim { name: string; team: string; pos: string; start: number; price: number; games: number; fp: number[]; deltas: number[] }
  const psims: PSim[] = [];
  let noData = 0;
  for (const p of players) {
    const rows = (boxByPlayer.get(p.id) ?? []).sort((a, b) => a.round - b.round);
    const start = r1(Number(p.start_price));
    const sim: PSim = { name: p.name, team: p.team, pos: p.position ?? "?", start, price: start, games: 0, fp: [], deltas: [] };
    if (rows.length === 0) noData++;
    const oldTeam = rows.length >= 2 ? teamCount(rows) : p.team_id;
    for (const b of rows) {
      const myTeam = [b.home_team_id, b.away_team_id].includes(p.team_id) ? p.team_id : oldTeam;
      const won = myTeam === b.home_team_id ? b.home_score > b.away_score : b.away_score > b.home_score;
      const n = computeFantasyGamePoints(
        {
          points: b.points, rebounds: b.rebounds, assists: b.assists, steals: b.steals, turnovers: b.turnovers,
          blocksFavour: b.blocks_favour, blocksAgainst: b.blocks_against, foulsCommitted: b.fouls_committed,
          foulsReceived: b.fouls_received, fieldGoalsMade2: b.field_goals_made_2, fieldGoalsAttempted2: b.field_goals_attempted_2,
          fieldGoalsMade3: b.field_goals_made_3, fieldGoalsAttempted3: b.field_goals_attempted_3,
          freeThrowsMade: b.free_throws_made, freeThrowsAttempted: b.free_throws_attempted,
        },
        won
      );
      const d = clamp((n - sim.price * FANTASY_PRICE_VARIATION_MULTIPLIER) / FANTASY_PRICE_VARIATION_DIVISOR);
      const next = r1(Math.max(FANTASY_MIN_PRICE, sim.price + d));
      sim.deltas.push(r1(next - sim.price));
      sim.fp.push(n);
      sim.price = next;
      sim.games++;
    }
    psims.push(sim);
  }

  interface CSim { name: string; team: string; start: number; price: number; fp: number[]; deltas: number[] }
  const csims: CSim[] = [];
  for (const c of coaches) {
    const start = r1(Number(c.start_price));
    const sim: CSim = { name: c.name ?? "?", team: c.team, start, price: start, fp: [], deltas: [] };
    for (const g of teamGames.filter((g) => g.home_team_id === c.id || g.away_team_id === c.id).sort((a, b) => a.round - b.round)) {
      const home = g.home_team_id === c.id;
      const n = pointsForCoachResult(home ? g.home_score : g.away_score, home ? g.away_score : g.home_score);
      const d = clamp((n - sim.price) / COACH_PRICE_VARIATION_DIVISOR);
      const next = r1(Math.max(COACH_MIN_PRICE, sim.price + d));
      sim.deltas.push(r1(next - sim.price));
      sim.fp.push(n);
      sim.price = next;
    }
    csims.push(sim);
  }

  // ---- Report ----
  const played = psims.filter((s) => s.games > 0);
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  console.log(`\n=== PLAYERS: ${ROUNDS} rounds replayed from ${FROM_SEASON} real box scores ===`);
  console.log(`${players.length} priced players, ${played.length} with real games, ${noData} with no ${FROM_SEASON} data (price unchanged)`);
  const allMoves = played.map((s) => r1(s.price - s.start));
  console.log(`Market total move: ${f(r1(total(allMoves)))}cr | gainers ${allMoves.filter((m) => m > 0).length}, flat ${allMoves.filter((m) => m === 0).length}, losers ${allMoves.filter((m) => m < 0).length}`);
  console.log(`Per game: avg delta ${(total(played.flatMap((s) => s.deltas)) / total(played.map((s) => s.games))).toFixed(3)}cr, clamped at Â±1: ${played.flatMap((s) => s.deltas).filter((d) => Math.abs(d) >= 1).length}/${total(played.map((s) => s.games))}`);

  console.log(`\nBy starting price bracket (players with games):`);
  console.log(`bracket   n   avgFP/g  breakeven  avgMove6r  minMove  maxMove`);
  for (const [lo, hi] of [[4, 6], [6, 8], [8, 10], [10, 12], [12, 14], [14, 99]]) {
    const b = played.filter((s) => s.start >= lo && s.start < hi);
    if (!b.length) continue;
    const moves = b.map((s) => s.price - s.start);
    const fpg = total(b.flatMap((s) => s.fp)) / total(b.map((s) => s.games));
    const be = (total(b.map((s) => s.start)) / b.length) * FANTASY_PRICE_VARIATION_MULTIPLIER;
    console.log(`${String(lo).padStart(2)}-${String(hi === 99 ? "+" : hi).padEnd(3)} ${String(b.length).padStart(5)}  ${fpg.toFixed(1).padStart(7)}  ${be.toFixed(1).padStart(9)}  ${f(total(moves) / b.length, 9)}  ${f(Math.min(...moves), 7)}  ${f(Math.max(...moves), 7)}`);
  }

  const byMove = [...played].sort((a, b) => b.price - b.start - (a.price - a.start));
  const line = (s: PSim) =>
    `${s.name.padEnd(26).slice(0, 26)} ${s.team.padEnd(4)} ${s.pos.slice(0, 1)}  ${s.start.toFixed(1).padStart(5)} -> ${s.price.toFixed(1).padStart(5)} (${f(s.price - s.start)})  FP: ${s.fp.map((x) => x.toFixed(0).padStart(3)).join(" ")}`;
  console.log(`\nTop 15 gainers:`);
  byMove.slice(0, 15).forEach((s) => console.log("  " + line(s)));
  console.log(`\nTop 15 losers:`);
  byMove.slice(-15).reverse().forEach((s) => console.log("  " + line(s)));
  console.log(`\nMost expensive 15:`);
  [...played].sort((a, b) => b.start - a.start).slice(0, 15).forEach((s) => console.log("  " + line(s)));

  console.log(`\n=== COACHES ===`);
  const cm = csims.map((c) => r1(c.price - c.start));
  console.log(`Total move: ${f(r1(total(cm)))}cr | gainers ${cm.filter((m) => m > 0).length}, losers ${cm.filter((m) => m < 0).length}`);
  for (const c of [...csims].sort((a, b) => b.price - b.start - (a.price - a.start)))
    console.log(`  ${c.name.padEnd(26).slice(0, 26)} ${c.team.padEnd(4)} ${c.start.toFixed(1).padStart(5)} -> ${c.price.toFixed(1).padStart(5)} (${f(c.price - c.start)})  pts: ${c.fp.map((x) => String(x).padStart(3)).join(" ")}`);

  // Squad-level: what a real user's budget does over 6 rounds holding the
  // squad they actually saved on dev (earliest round they have).
  const squads = (await db.execute<Row>(sql`
    select l.user_id, l.round, array_agg(l.player_id) as player_ids,
      (select team_id from fantasy_coach_picks c where c.user_id = l.user_id and c.season = l.season and c.round = l.round) as coach_team
    from fantasy_lineups l
    where l.season = ${SEASON} and l.round = (select min(round) from fantasy_lineups x where x.user_id = l.user_id and x.season = ${SEASON})
    group by l.user_id, l.round, l.season
  `)) as Row[];
  const simById = new Map(players.map((p, i) => [p.id, psims[i]]));
  const coachById = new Map(coaches.map((c, i) => [c.id, csims[i]]));
  const squadMoves = squads.map((s) => {
    const pm = total((s.player_ids as string[]).map((id) => { const x = simById.get(id); return x ? x.price - x.start : 0; }));
    const c = s.coach_team ? coachById.get(s.coach_team) : undefined;
    return { players: pm, coach: c ? c.price - c.start : 0 };
  });
  if (squadMoves.length) {
    const tot = squadMoves.map((m) => m.players + m.coach).sort((a, b) => a - b);
    console.log(`\n=== REAL DEV SQUADS held ${ROUNDS} rounds (${squadMoves.length} users) â budget ${FANTASY_BUDGET_CAP} + move ===`);
    console.log(`avg ${f(total(tot) / tot.length)}cr (players ${f(total(squadMoves.map((m) => m.players)) / tot.length)}, coach ${f(total(squadMoves.map((m) => m.coach)) / tot.length)}) | worst ${f(tot[0])} | median ${f(tot[Math.floor(tot.length / 2)])} | best ${f(tot[tot.length - 1])}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
