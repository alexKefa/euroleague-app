/**
 * One-off (2026-09-29): re-bases round 1 of 2026-27 Fantasy Five price moves
 * on EuroLeague Fantasy's own real round-1 moves, pulled from Dunkest
 * (quotation + plus per player/coach, saved as dk_p1..4.json by hand).
 *
 * Why: round 1 was priced with rules that turned out to differ from the real
 * game (rounding, DNP handling, win bonus on negative lines, stale box
 * scores; see fantasyDailyReprice.ts). Per-user budgets are 100 + logged
 * moves of owned players, so fixing the logs fixes everyone's budget.
 *
 * Steps (--apply; without it this is a dry run that writes nothing):
 *  1. Back up the touched tables to backups/round1-fix-<ts>.json.
 *  2. Re-fetch round 1's official box scores (refreshFinalBoxscore).
 *  3. In one transaction: undo round 1's logged moves, delete those logs,
 *     then for every player/coach matched to Dunkest set price = real
 *     quotation and log the real move (plus) against their round-1 game.
 *  4. Run the (new) price job, which prices any round-1 player still
 *     unlogged, i.e. ones Dunkest doesn't list, with the new rules.
 *
 * Usage: npx tsx src/scripts/fix-round1-fantasy-prices.ts [--apply]
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { refreshFinalBoxscore } from "../sync/liveGamesSync.js";
import { applyDailyFantasyPriceChanges } from "../services/fantasyDailyReprice.js";

const SEASON = "2026-27";
const ROUND = 1;
const APPLY = process.argv.includes("--apply");
const DISP: Record<string, string> = {
  IST: "EFS", MIL: "MIL", BES: "BJK", RED: "CZV", DUB: "DUB", BAR: "BAR", MUN: "BAY", ULK: "FBT", HTA: "HTA", BAS: "KBA",
  ASV: "ASV", TEL: "MTA", OLY: "OLY", PAN: "PAO", PRS: "PBB", PAR: "PAR", MAD: "RMB", PAM: "VBC", VIR: "VIR", ZAL: "ZAL",
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "");

type Row = Record<string, any>;

async function main() {
  const el: Row[] = [];
  for (const p of [1, 2, 3, 4]) {
    const j = JSON.parse(fs.readFileSync(`dk_p${p}.json`, "utf8"));
    for (const r of j.data.players) el.push(Object.fromEntries(j.data.columns.map((k: string, i: number) => [k, r.row[i]])));
  }

  const games = (await db.execute<Row>(sql`
    select id, game_code, home_team_id, away_team_id, status from games where season = ${SEASON} and round = ${ROUND}
  `)) as Row[];
  if (games.length !== 10 || games.some((g) => g.status !== "final")) throw new Error("round 1 isn't 10 final games");
  const gameByTeam = new Map<string, string>();
  for (const g of games) { gameByTeam.set(g.home_team_id, g.id); gameByTeam.set(g.away_team_id, g.id); }

  const players = (await db.execute<Row>(sql`
    select p.id, p.name, p.team_id, t.code, f.price,
      coalesce((select sum(l.applied_delta) from fantasy_price_change_log l join games g on g.id = l.game_id
        where l.player_id = p.id and g.season = ${SEASON} and g.round = ${ROUND}), 0) as old_move
    from player_fantasy_prices f join players p on p.id = f.player_id join teams t on t.id = p.team_id
    where f.season = ${SEASON}
  `)) as Row[];
  const coaches = (await db.execute<Row>(sql`
    select t.id, t.code, c.price,
      coalesce((select sum(l.applied_delta) from fantasy_coach_price_change_log l join games g on g.id = l.game_id
        where l.team_id = t.id and g.season = ${SEASON} and g.round = ${ROUND}), 0) as old_move
    from coach_fantasy_prices c join teams t on t.id = c.team_id where c.season = ${SEASON}
  `)) as Row[];

  const playerFix: { id: string; name: string; gameId: string; price: number; move: number; oldPrice: number; oldMove: number }[] = [];
  const unmatched: Row[] = [];
  for (const p of players) {
    const [last, first = ""] = String(p.name).split(",").map((s) => s.trim());
    const e = el.find((x) => x.position !== "Head Coach" && x.team === DISP[p.code] &&
      norm(x.name.split(". ").slice(1).join(". ")) === norm(last) && norm(x.name)[0] === norm(first)[0]);
    const gameId = gameByTeam.get(p.team_id);
    if (!e || e.plus === "-" || !gameId) { unmatched.push(p); continue; }
    playerFix.push({ id: p.id, name: p.name, gameId, price: Number(e.quotation), move: Number(e.plus), oldPrice: Number(p.price), oldMove: r1(Number(p.old_move)) });
  }
  const coachFix: { id: string; code: string; gameId: string; price: number; move: number; oldPrice: number; oldMove: number }[] = [];
  for (const c of coaches) {
    const e = el.find((x) => x.position === "Head Coach" && x.team === DISP[c.code]);
    const gameId = gameByTeam.get(c.id);
    if (!e || e.plus === "-" || !gameId) throw new Error(`coach ${c.code} not matched`);
    coachFix.push({ id: c.id, code: c.code, gameId, price: Number(e.quotation), move: Number(e.plus), oldPrice: Number(c.price), oldMove: r1(Number(c.old_move)) });
  }

  // ---- Report ----
  const changed = playerFix.filter((f) => Math.abs(f.price - f.oldPrice) > 1e-6);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — round ${ROUND} ${SEASON}`);
  console.log(`players matched to Dunkest: ${playerFix.length} (price changes for ${changed.length}); not in Dunkest: ${unmatched.length} (priced by the new rules)`);
  for (const f of changed.sort((a, b) => Math.abs(b.price - b.oldPrice) - Math.abs(a.price - a.oldPrice)).slice(0, 25))
    console.log(`  ${f.name.padEnd(26).slice(0, 26)} ${f.oldPrice.toFixed(1)} -> ${f.price.toFixed(1)}  (round-1 move ${f.oldMove >= 0 ? "+" : ""}${f.oldMove.toFixed(1)} -> ${f.move >= 0 ? "+" : ""}${f.move.toFixed(1)})`);
  console.log(`coaches:`);
  for (const f of coachFix) if (Math.abs(f.price - f.oldPrice) > 1e-6 || Math.abs(f.move - f.oldMove) > 1e-6)
    console.log(`  ${f.code} ${f.oldPrice.toFixed(1)} -> ${f.price.toFixed(1)}  (move ${f.oldMove.toFixed(1)} -> ${f.move.toFixed(1)})`);

  // Budget preview: round-2 budget = 100 + round-1 owned moves.
  const lineups = (await db.execute<Row>(sql`
    select u.username, fl.user_id, array_agg(fl.player_id) as ids,
      (select team_id from fantasy_coach_picks c where c.user_id = fl.user_id and c.season = fl.season and c.round = fl.round) as coach
    from fantasy_lineups fl join users u on u.id = fl.user_id
    where fl.season = ${SEASON} and fl.round = ${ROUND} group by u.username, fl.user_id, fl.season, fl.round
  `)) as Row[];
  const newMove = new Map(playerFix.map((f) => [f.id, f.move]));
  const oldMove = new Map(players.map((p) => [p.id, r1(Number(p.old_move))]));
  const coachNew = new Map(coachFix.map((f) => [f.id, f.move]));
  const coachOld = new Map(coachFix.map((f) => [f.id, f.oldMove]));
  console.log(`\nround-2 budgets (${lineups.length} users with a round-1 squad):`);
  for (const l of lineups) {
    const ids: string[] = l.ids;
    const before = 100 + ids.reduce((s, id) => s + (oldMove.get(id) ?? 0), 0) + (coachOld.get(l.coach) ?? 0);
    const unknown = ids.filter((id) => !newMove.has(id)).length;
    const after = 100 + ids.reduce((s, id) => s + (newMove.get(id) ?? 0), 0) + (coachNew.get(l.coach) ?? 0);
    console.log(`  ${String(l.username).padEnd(20)} ${r1(before).toFixed(1)} -> ${r1(after).toFixed(1)}${unknown ? `  (+${unknown} player(s) priced by new rules, not included)` : ""}`);
  }

  if (!APPLY) { console.log("\nDry run only. Re-run with --apply to write."); return; }

  // 1. Backup of everything this touches.
  const backup = {
    player_fantasy_prices: await db.execute(sql`select * from player_fantasy_prices where season = ${SEASON}`),
    coach_fantasy_prices: await db.execute(sql`select * from coach_fantasy_prices where season = ${SEASON}`),
    fantasy_price_change_log: await db.execute(sql`select * from fantasy_price_change_log`),
    fantasy_coach_price_change_log: await db.execute(sql`select * from fantasy_coach_price_change_log`),
    player_game_stats_round1: await db.execute(sql`select pgs.* from player_game_stats pgs join games g on g.id = pgs.game_id where g.season = ${SEASON} and g.round = ${ROUND}`),
  };
  const out = path.resolve("..", "backups", `round1-fix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(backup));
  console.log(`\nbackup: ${out}`);

  // 2. Official box scores.
  for (const g of games) console.log(`box refresh ${g.game_code}: ${await refreshFinalBoxscore(g.id, SEASON, g.game_code)}`);

  // 3. Re-base round 1 on the real moves.
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update player_fantasy_prices f set price = f.price - s.d
      from (select l.player_id, sum(l.applied_delta) d from fantasy_price_change_log l join games g on g.id = l.game_id
            where g.season = ${SEASON} and g.round = ${ROUND} group by 1) s
      where f.player_id = s.player_id and f.season = ${SEASON}`);
    await tx.execute(sql`
      update coach_fantasy_prices f set price = f.price - s.d
      from (select l.team_id, sum(l.applied_delta) d from fantasy_coach_price_change_log l join games g on g.id = l.game_id
            where g.season = ${SEASON} and g.round = ${ROUND} group by 1) s
      where f.team_id = s.team_id and f.season = ${SEASON}`);
    await tx.execute(sql`delete from fantasy_price_change_log l using games g where g.id = l.game_id and g.season = ${SEASON} and g.round = ${ROUND}`);
    await tx.execute(sql`delete from fantasy_coach_price_change_log l using games g where g.id = l.game_id and g.season = ${SEASON} and g.round = ${ROUND}`);

    const pv = playerFix.map((f) => sql`(${f.id}::uuid, ${f.price}::real)`);
    await tx.execute(sql`update player_fantasy_prices f set price = v.price, updated_at = now()
      from (values ${sql.join(pv, sql`, `)}) as v(player_id, price) where f.player_id = v.player_id and f.season = ${SEASON}`);
    const pl = playerFix.map((f) => sql`(${f.id}::uuid, ${f.gameId}::uuid, ${f.move}::real, ${f.move}::real)`);
    await tx.execute(sql`insert into fantasy_price_change_log (player_id, game_id, delta, applied_delta) values ${sql.join(pl, sql`, `)}`);

    const cv = coachFix.map((f) => sql`(${f.id}::uuid, ${f.price}::real)`);
    await tx.execute(sql`update coach_fantasy_prices f set price = v.price, updated_at = now()
      from (values ${sql.join(cv, sql`, `)}) as v(team_id, price) where f.team_id = v.team_id and f.season = ${SEASON}`);
    const cl = coachFix.map((f) => sql`(${f.id}::uuid, ${f.gameId}::uuid, ${f.move}::real, ${f.move}::real)`);
    await tx.execute(sql`insert into fantasy_coach_price_change_log (team_id, game_id, delta, applied_delta) values ${sql.join(cl, sql`, `)}`);
  });
  console.log(`re-based ${playerFix.length} players and ${coachFix.length} coaches on the real round-1 moves`);

  // 4. Anyone left unlogged for round 1.
  console.log("price job:", await applyDailyFantasyPriceChanges(SEASON));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
