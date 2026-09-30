/**
 * One-off (2026-09-30): undoes a round's already-applied Fantasy Five price
 * moves so the round can be re-priced in one go.
 *
 * Why: round 2 of 2026-27 was priced game by game, so its Tuesday games
 * moved everyone's budget before Wednesday's were played. Prices now move
 * once per round (fantasyDailyReprice.ts's roundSettled); undoing the
 * partial moves lets the price job re-price the whole round together once
 * it settles. Per-user budgets are 100 + logged moves of owned players, so
 * removing the logs is what reverts every user's credits.
 *
 * Deploy the per-round pricing first: the old per-game job would otherwise
 * re-price the reverted games within the hour.
 *
 * Steps (--apply; without it this is a dry run that writes nothing):
 *  1. Back up the touched rows to backups/round<N>-revert-<ts>.json.
 *  2. In one transaction: price -= applied_delta for every logged player and
 *     coach move in the round, then delete those log rows.
 *
 * Usage: npx tsx src/scripts/revert-round-fantasy-prices.ts <round> [--apply]
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { getCurrentSeason } from "../services/season.js";
import { getOwnedPriceMoves } from "../services/fantasyScoring.js";

const ROUND = Number(process.argv[2]);
const APPLY = process.argv.includes("--apply");

type Row = Record<string, any>;

async function main() {
  if (!Number.isInteger(ROUND) || ROUND < 1) throw new Error("usage: revert-round-fantasy-prices.ts <round> [--apply]");
  const season = await getCurrentSeason();
  if (!season) throw new Error("no current season");

  const playerMoves = (await db.execute<Row>(sql`
    select l.id, l.player_id, l.game_id, l.delta, l.applied_delta, l.applied_at, p.name, f.price
    from fantasy_price_change_log l
    join games g on g.id = l.game_id
    join players p on p.id = l.player_id
    join player_fantasy_prices f on f.player_id = l.player_id and f.season = g.season
    where g.season = ${season} and g.round = ${ROUND}
    order by p.name
  `)) as Row[];
  const coachMoves = (await db.execute<Row>(sql`
    select l.id, l.team_id, l.game_id, l.delta, l.applied_delta, l.applied_at, t.code, c.price
    from fantasy_coach_price_change_log l
    join games g on g.id = l.game_id
    join teams t on t.id = l.team_id
    join coach_fantasy_prices c on c.team_id = l.team_id and c.season = g.season
    where g.season = ${season} and g.round = ${ROUND}
    order by t.code
  `)) as Row[];

  const users = (await db.execute<Row>(sql`
    select distinct u.id, u.username from fantasy_lineups fl join users u on u.id = fl.user_id
    where fl.season = ${season} and fl.round = ${ROUND}
  `)) as Row[];
  const userMoves = await Promise.all(
    users.map(async (u) => ({ user: u.username, move: await getOwnedPriceMoves(u.id, season, { round: ROUND }) }))
  );

  console.log(`season ${season}, round ${ROUND} — ${APPLY ? "APPLY" : "dry run"}`);
  console.log(`player moves: ${playerMoves.length} (sum ${sum(playerMoves)}), coach moves: ${coachMoves.length} (sum ${sum(coachMoves)})`);
  console.log("per-user credit change being reverted (budget goes back by the opposite):");
  for (const u of userMoves.sort((a, b) => a.move - b.move)) console.log(`  ${u.user}: ${u.move > 0 ? "+" : ""}${u.move}`);
  console.log("sample price restores:");
  for (const m of [...playerMoves].filter((m) => Number(m.applied_delta) !== 0).slice(0, 8)) {
    console.log(`  ${m.name}: ${m.price} -> ${r1(Number(m.price) - Number(m.applied_delta))}`);
  }
  for (const m of coachMoves.filter((m) => Number(m.applied_delta) !== 0).slice(0, 4)) {
    console.log(`  coach ${m.code}: ${m.price} -> ${r1(Number(m.price) - Number(m.applied_delta))}`);
  }

  if (!APPLY) return;

  const dir = path.resolve("backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `round${ROUND}-revert-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ season, round: ROUND, playerMoves, coachMoves }, null, 2));
  console.log(`backup: ${file}`);

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update player_fantasy_prices f
      set price = round((f.price - l.applied_delta)::numeric, 1)::real, updated_at = now()
      from fantasy_price_change_log l join games g on g.id = l.game_id
      where l.player_id = f.player_id and f.season = g.season and g.season = ${season} and g.round = ${ROUND}
    `);
    await tx.execute(sql`
      update coach_fantasy_prices c
      set price = round((c.price - l.applied_delta)::numeric, 1)::real, updated_at = now()
      from fantasy_coach_price_change_log l join games g on g.id = l.game_id
      where l.team_id = c.team_id and c.season = g.season and g.season = ${season} and g.round = ${ROUND}
    `);
    await tx.execute(sql`
      delete from fantasy_price_change_log l using games g
      where g.id = l.game_id and g.season = ${season} and g.round = ${ROUND}
    `);
    await tx.execute(sql`
      delete from fantasy_coach_price_change_log l using games g
      where g.id = l.game_id and g.season = ${season} and g.round = ${ROUND}
    `);
  });
  console.log("reverted.");
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}
function sum(rows: Row[]): number {
  return r1(rows.reduce((s, r) => s + Number(r.applied_delta ?? 0), 0));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
