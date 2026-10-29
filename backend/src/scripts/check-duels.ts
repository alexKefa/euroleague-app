// Four Quarters duels lifecycle checks, against the dev database only.
// Creates three throwaway users with dev-only cards and a shared league,
// plays duels through services/duels.ts, asserts the rules (hidden info,
// locking, timeouts, forfeits, ratings, prize cap, overtime), and deletes
// everything it created at the end (pass or fail).
//
//   npm run check:duels
import "dotenv/config";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  DuelError,
  acceptDuel,
  applyTimeouts,
  cancelDuel,
  commitMove,
  createDuel,
  declineDuel,
  finishDuel,
  forfeitDuelsForDeletedUser,
  getDuelView,
  getLadder,
  getMyRating,
  listMyDuels,
  listOpenDuels,
} from "../services/duels.js";
import { eloDeltas, quarterScore, seasonKey, weakestRemaining, type DuelCard, type DuelCategory } from "../services/duelEngine.js";
import { duels } from "../db/schema.js";
import { eq } from "drizzle-orm";

if (!(process.env.DATABASE_URL ?? "").includes("ep-sparkling-pond")) throw new Error("refusing to run outside the dev database");

type Row = Record<string, unknown>;
const one = async <T extends Row>(q: ReturnType<typeof sql>) => (await db.execute<T>(q))[0];
const num = async (q: ReturnType<typeof sql>) => Number((await one<{ n: number }>(q)).n);

const tag = Math.random().toString(36).slice(2, 8);
const userIds: string[] = [];
let leagueId = "";

async function mkUser(name: string): Promise<string> {
  const u = await one<{ id: string }>(sql`
    insert into users (email, username, password_hash)
    values (${`check-duels-${tag}-${name}@dev.invalid`}, ${`check-duels-${tag}-${name}`}, 'x')
    returning id`);
  userIds.push(u.id);
  return u.id;
}

async function expectCode(p: Promise<unknown>, codes: string[], label: string): Promise<void> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DuelError && codes.includes(err.code)) return;
    throw new Error(`${label}: expected ${codes.join("|")}, got ${(err as Error).message}`);
  }
  throw new Error(`${label}: expected ${codes.join("|")}, but it succeeded`);
}

const step = (s: string) => console.log(`- ${s}`);
const close = (a: number, b: number) => Math.abs(a - b) < 0.05;

async function duelRow(id: string) {
  const [r] = await db.select().from(duels).where(eq(duels.id, id));
  return r;
}
async function moves(id: string) {
  return db.execute<{ quarter: number; user_id: string; slot: number; score: number; auto: boolean }>(
    sql`select quarter, user_id, slot, score, auto from duel_moves where duel_id = ${id} order by quarter, user_id`
  );
}

/** Plays quarter q: A then B (slot = q - 1 for both). */
async function playQuarter(id: string, a: string, b: string, q: number): Promise<void> {
  await commitMove(a, id, q, q - 1);
  await commitMove(b, id, q, q - 1);
}

/** Plays a whole duel with the challenger forced far ahead before Q4 resolves. */
async function playChallengerWin(id: string, challenger: string, opponent: string): Promise<void> {
  for (let q = 1; q <= 3; q++) await playQuarter(id, challenger, opponent, q);
  await db.execute(sql`update duels set challenger_score = opponent_score + 1000 where id = ${id}`);
  await playQuarter(id, challenger, opponent, 4);
}

async function main() {
  const A = await mkUser("a");
  const B = await mkUser("b");
  const C = await mkUser("c");

  // 18 non-coach series-1 cards with distinct names, 6 per user, plus a coach for A.
  const cards = await db.execute<{ id: string }>(sql`
    select id from (select distinct on (lower(name)) id, name from collectibles where tier <> 'coach' and series = 1 order by lower(name), id) x
    order by name limit 18`);
  assert.equal(cards.length, 18, "dev has at least 18 distinct non-coach cards");
  const coach = await one<{ id: string }>(sql`select id from collectibles where tier = 'coach' limit 1`);
  const own: Record<string, string[]> = {
    [A]: cards.slice(0, 6).map((c) => c.id),
    [B]: cards.slice(6, 12).map((c) => c.id),
    [C]: cards.slice(12, 18).map((c) => c.id),
  };
  const values = Object.entries(own).flatMap(([u, ids]) => ids.map((id) => sql`(${u}::uuid, ${id}::uuid)`));
  values.push(sql`(${A}::uuid, ${coach.id}::uuid)`);
  await db.execute(sql`insert into user_collectibles (user_id, collectible_id) values ${sql.join(values, sql`, `)}`);
  const lineup = (u: string) => own[u].slice(0, 5);

  const league = await one<{ id: string }>(sql`
    insert into leagues (name, code, created_by_user_id) values (${`check-duels-${tag}`}, ${`cd${tag}`}, ${A}) returning id`);
  leagueId = league.id;
  await db.execute(sql`insert into league_members (league_id, user_id) values (${leagueId}, ${A}), (${leagueId}, ${B})`);

  // Rejections
  await expectCode(createDuel(A, { lineup: lineup(A).slice(0, 4) }), ["INVALID_LINEUP"], "4-card lineup");
  await expectCode(createDuel(A, { lineup: [...lineup(A).slice(0, 4), coach.id] }), ["INVALID_LINEUP"], "coach in lineup");
  await expectCode(createDuel(A, { lineup: lineup(A), opponentUserId: C, leagueId }), ["NOT_A_MEMBER"], "opponent not in league");
  await expectCode(createDuel(A, { lineup: lineup(A), opponentUserId: A, leagueId }), ["NOT_A_MEMBER"], "challenge yourself");
  step("rejections: 4 cards, coach, non-member, self");

  // Open challenge hiding
  const { id: d1 } = await createDuel(A, { lineup: lineup(A) });
  assert.equal((await duelRow(d1)).status, "open");
  await expectCode(getDuelView(d1, C), ["NOT_PARTICIPANT"], "third party view of open challenge");
  const openForB = await listOpenDuels(B);
  assert.ok(openForB.some((o) => o.id === d1), "B sees A's open challenge");
  const openJson = JSON.stringify(openForB);
  for (const id of lineup(A)) assert.ok(!openJson.includes(id), "open list exposes no card ids");
  assert.ok(!(await listOpenDuels(A)).some((o) => o.id === d1), "own open challenge excluded");
  const preview = await getDuelView(d1, A);
  assert.equal(preview.myLineup.length, 5, "challenger previews own lineup");
  assert.equal(preview.theirLineup, null);
  step("open challenge hidden from third parties, no card ids listed");

  // After accept
  const bView = await acceptDuel(B, d1, lineup(B));
  const row1 = await duelRow(d1);
  assert.equal(row1.status, "active");
  assert.equal(row1.quarter, 1);
  assert.equal(new Set(row1.categories).size, 4, "4 distinct categories");
  const aView = await getDuelView(d1, A);
  for (const v of [aView, bView]) {
    assert.equal(v.quarter, 1);
    assert.equal(v.myLineup.length, 5);
    assert.equal(v.theirLineup?.length, 5);
    assert.ok(v.categories[0] && v.categories[1], "current + next category shown");
    assert.equal(v.categories[2], null);
    assert.equal(v.categories[3], null);
  }
  assert.equal(aView.theirLineup![0].collectibleId, lineup(B)[0]);
  await expectCode(acceptDuel(C, d1, lineup(C)), ["NOT_AVAILABLE"], "accept already taken");
  step("accept: quarter 1, 4 categories, only current + next visible, both lineups");

  // Hidden commit
  await commitMove(A, d1, 1, 0);
  const bAfter = await getDuelView(d1, B);
  assert.equal(bAfter.theyCommitted, true);
  assert.equal(bAfter.iCommitted, false);
  assert.equal(bAfter.quarters[0].theirSlot, null);
  assert.equal(bAfter.quarters[0].theirScore, null);
  assert.equal(bAfter.score.them, 0);
  const bList = (await listMyDuels(B)).find((s) => s.id === d1)!;
  assert.ok(!/slot/i.test(JSON.stringify(bList)), "summary has no slot");
  assert.equal(bList.myMove, true);
  assert.equal(bList.score.them, 0);
  await commitMove(B, d1, 1, 0);
  assert.equal((await duelRow(d1)).quarter, 2);
  const aQ1 = await getDuelView(d1, A);
  assert.equal(aQ1.quarters[0].theirSlot, 0, "slot revealed once the quarter resolves");
  step("hidden commit: opponent sees only that a card was played");

  // Concurrent commit
  await Promise.all([commitMove(A, d1, 2, 1), commitMove(B, d1, 2, 1)]);
  const row2 = await duelRow(d1);
  assert.equal(row2.quarter, 3, "advanced exactly once");
  const m2 = await moves(d1);
  assert.equal(m2.length, 4);
  const sumFor = (u: string) => m2.filter((m) => m.user_id === u).reduce((s, m) => s + Number(m.score), 0);
  assert.ok(close(row2.challengerScore, sumFor(A)), `challenger total ${row2.challengerScore} vs ${sumFor(A)}`);
  assert.ok(close(row2.opponentScore, sumFor(B)), `opponent total ${row2.opponentScore} vs ${sumFor(B)}`);
  step("concurrent commits resolve the quarter once, totals = sum of moves");

  // Double commit
  await commitMove(A, d1, 3, 2);
  const before = (await moves(d1)).length;
  await expectCode(commitMove(A, d1, 3, 3), ["QUARTER_CHANGED", "SLOT_USED"], "second commit same quarter");
  await expectCode(commitMove(A, d1, 3, 2), ["QUARTER_CHANGED", "SLOT_USED"], "repeat commit");
  await expectCode(commitMove(B, d1, 3, 0), ["SLOT_USED"], "used slot");
  await expectCode(commitMove(C, d1, 3, 4), ["NOT_PARTICIPANT"], "non-participant commit");
  assert.equal((await moves(d1)).length, before, "moves unchanged");
  step("double commit rejected, no extra moves");

  // Stale quarter: B misses Q3
  await db.execute(sql`update duels set quarter_deadline = now() - interval '1 second' where id = ${d1}`);
  assert.ok((await applyTimeouts(d1)) >= 1);
  const row3 = await duelRow(d1);
  const bAuto = (await moves(d1)).find((m) => m.quarter === 3 && m.user_id === B)!;
  const bLineup = row3.opponentLineup as DuelCard[];
  const cats = row3.categories as DuelCategory[];
  assert.equal(bAuto.auto, true);
  assert.equal(bAuto.slot, weakestRemaining(bLineup, [0, 1], cats[2]));
  assert.equal(row3.opponentMissStreak, 1);
  assert.equal(row3.challengerMissStreak, 0);
  assert.equal(row3.quarter, 4);
  await expectCode(commitMove(B, d1, 3, 4), ["QUARTER_CHANGED"], "stale quarter commit");
  step("timeout auto-commits the weakest card, miss streak 1, stale quarter rejected");

  // Q4: force A ahead, normal finish
  await db.execute(sql`update duels set challenger_score = opponent_score + 1000 where id = ${d1}`);
  const bFree = [0, 1, 2, 3, 4].find((s) => s !== 0 && s !== 1 && s !== bAuto.slot)!;
  await commitMove(A, d1, 4, 3);
  const finalB = await commitMove(B, d1, 4, bFree);
  const row4 = await duelRow(d1);
  assert.equal(row4.status, "finished");
  assert.equal(row4.finishReason, "normal");
  assert.equal(row4.winnerUserId, A);
  assert.equal(row4.opponentMissStreak, 0, "manual commit resets the streak");
  assert.equal(finalB.result, "loss");
  assert.equal(finalB.categories.filter(Boolean).length, 4);

  // Ratings + prize
  const season = seasonKey(new Date());
  const e1 = eloDeltas(1000, 1000, 1, 32, 32);
  assert.equal(row4.challengerRatingDelta, e1.a);
  assert.equal(row4.opponentRatingDelta, e1.b);
  const ra = await one<{ rating: number; games: number; wins: number }>(sql`select rating, games, wins from duel_ratings where user_id = ${A} and season = ${season}`);
  const rb = await one<{ rating: number; games: number; losses: number }>(sql`select rating, games, losses from duel_ratings where user_id = ${B} and season = ${season}`);
  assert.deepEqual([ra.rating, ra.games, ra.wins], [1000 + e1.a, 1, 1]);
  assert.deepEqual([rb.rating, rb.games, rb.losses], [1000 + e1.b, 1, 1]);
  const prizeRows = () => num(sql`select count(*) as n from point_adjustments where user_id = ${A} and reason = 'Duel win' and points = 15`);
  assert.equal(await prizeRows(), 1);
  assert.equal(row4.prizePaid, true);
  // A second finish pays nothing and doesn't touch ratings.
  const again = await db.transaction(async (tx) => finishDuel(tx, { ...row4, status: "active" }, { winnerUserId: A, reason: "normal" }));
  assert.equal(again, false);
  assert.equal(await applyTimeouts(d1), 0);
  assert.equal(await prizeRows(), 1, "no second prize");
  assert.equal(await num(sql`select games as n from duel_ratings where user_id = ${A} and season = ${season}`), 1);
  const aFinal = await getDuelView(d1, A);
  assert.equal(aFinal.result, "win");
  assert.equal(aFinal.ratingDelta, e1.a);
  assert.equal(aFinal.prizePaid, true);
  step("finish: Elo rows and deltas, one 15-point prize, second finish is a no-op");

  // Prize cap: A beats B again today
  const { id: d2 } = await createDuel(A, { lineup: lineup(A), opponentUserId: B, leagueId });
  assert.equal((await duelRow(d2)).status, "pending");
  await expectCode(acceptDuel(C, d2, lineup(C)), ["NOT_PARTICIPANT"], "stranger accepts pending");
  await acceptDuel(B, d2, lineup(B));
  await playChallengerWin(d2, A, B);
  const row5 = await duelRow(d2);
  assert.equal(row5.winnerUserId, A);
  assert.equal(row5.prizePaid, false, "second win vs same opponent today pays nothing");
  assert.equal(await prizeRows(), 1);
  const e2 = eloDeltas(1000 + e1.a, 1000 + e1.b, 1, 32, 32);
  assert.equal(row5.challengerRatingDelta, e2.a);
  assert.equal(row5.opponentRatingDelta, e2.b);
  const myA = await getMyRating(A);
  assert.equal(myA.rating, 1000 + e1.a + e2.a);
  assert.equal(myA.wins, 2);
  assert.equal(myA.paidWinsLeftToday, 4);
  assert.equal(myA.season, season);
  step("prize cap: second win vs same opponent unpaid, ratings carry over");

  // Overtime: A vs C (open, C accepts), totals tied before Q4 resolves
  const { id: d3 } = await createDuel(A, { lineup: lineup(A) });
  await acceptDuel(C, d3, lineup(C));
  for (let q = 1; q <= 3; q++) await playQuarter(d3, A, C, q);
  await commitMove(A, d3, 4, 3);
  const r3 = await duelRow(d3);
  const c4 = quarterScore((r3.opponentLineup as DuelCard[])[3], (r3.categories as DuelCategory[])[3]);
  const aQ4 = Number((await moves(d3)).find((m) => m.quarter === 4 && m.user_id === A)!.score);
  const oppScore = Math.round((r3.challengerScore + aQ4 - c4) * 10) / 10;
  await db.execute(sql`update duels set opponent_score = ${oppScore} where id = ${d3}`);
  const otView = await commitMove(C, d3, 4, 3);
  const r3f = await duelRow(d3);
  const ot = (await moves(d3)).filter((m) => m.quarter === 5);
  assert.equal(ot.length, 2, "two overtime rows");
  assert.equal(r3f.quarter, 5);
  assert.equal(r3f.status, "finished");
  const aBench = quarterScore((r3f.challengerLineup as DuelCard[])[4], "efficiency");
  const cBench = quarterScore((r3f.opponentLineup as DuelCard[])[4], "efficiency");
  assert.ok(ot.every((m) => m.slot === 4));
  const expectedWinner = aBench > cBench ? A : cBench > aBench ? C : null;
  assert.equal(r3f.winnerUserId, expectedWinner, "overtime decided by bench efficiency");
  assert.ok(otView.overtime && close(otView.overtime.myScore, cBench) && close(otView.overtime.theirScore, aBench));
  step(`overtime: bench efficiency ${aBench} vs ${cBench} decides it`);

  // Forfeit: B posts, A accepts and misses twice
  const { id: d4 } = await createDuel(B, { lineup: lineup(B) });
  await acceptDuel(A, d4, lineup(A));
  for (const q of [1, 2]) {
    await commitMove(B, d4, q, q - 1);
    await db.execute(sql`update duels set quarter_deadline = now() - interval '1 second' where id = ${d4}`);
    await applyTimeouts(d4);
  }
  const r4 = await duelRow(d4);
  assert.equal(r4.status, "finished");
  assert.equal(r4.finishReason, "forfeit");
  assert.equal(r4.winnerUserId, B);
  assert.equal(r4.opponentMissStreak, 2);
  step("forfeit after two auto misses in a row");

  // Card gone before accept
  const { id: d5 } = await createDuel(C, { lineup: lineup(C) });
  await db.execute(sql`delete from user_collectibles where user_id = ${C} and collectible_id = ${lineup(C)[0]}`);
  await expectCode(acceptDuel(A, d5, lineup(A)), ["NOT_AVAILABLE"], "challenger card gone");
  assert.equal((await duelRow(d5)).status, "cancelled");
  step("challenger card gone: accept cancels the duel");

  // Decline, cancel, expiry
  const { id: d6 } = await createDuel(A, { lineup: lineup(A), opponentUserId: B, leagueId });
  await expectCode(declineDuel(C, d6), ["NOT_PARTICIPANT"], "stranger declines");
  await declineDuel(B, d6);
  assert.equal((await duelRow(d6)).status, "declined");
  const { id: d7 } = await createDuel(A, { lineup: lineup(A) });
  await expectCode(cancelDuel(B, d7), ["NOT_PARTICIPANT"], "stranger cancels");
  await cancelDuel(A, d7);
  assert.equal((await duelRow(d7)).status, "cancelled");
  const { id: d8 } = await createDuel(A, { lineup: lineup(A) });
  await db.execute(sql`update duels set expires_at = now() - interval '1 second' where id = ${d8}`);
  assert.equal(await applyTimeouts(d8), 1);
  assert.equal((await duelRow(d8)).status, "expired");
  step("decline, cancel and expiry");

  // Active cap: create side and accept side
  const capIds: string[] = [];
  for (let i = 0; i < 5; i++) capIds.push((await createDuel(A, { lineup: lineup(A) })).id);
  await expectCode(createDuel(A, { lineup: lineup(A) }), ["TOO_MANY_DUELS"], "6th duel");
  const { id: dB } = await createDuel(B, { lineup: lineup(B) });
  await expectCode(acceptDuel(A, dB, lineup(A)), ["TOO_MANY_DUELS"], "accept as 6th duel");
  for (const id of capIds) await cancelDuel(A, id);
  step("active cap: 6th duel rejected at create and accept");

  // Lists and ladder
  const mine = await listMyDuels(A);
  assert.ok(mine.some((s) => s.id === d1 && s.result === "win"));
  assert.ok(!mine.some((s) => s.id === d7), "cancelled duels left out");
  const ladder = await getLadder(leagueId);
  assert.deepEqual(new Set(ladder.map((r) => r.userId)), new Set([A, B]));
  assert.equal(ladder[0].userId, A);
  const global = await getLadder(null);
  assert.ok(global.some((r) => r.userId === C));
  step("lists and ladders");

  // Account deletion: A's active duel is forfeited without touching A's rating
  await acceptDuel(A, dB, lineup(A));
  const { id: dOpen } = await createDuel(A, { lineup: lineup(A) });
  const ratingBefore = await num(sql`select rating as n from duel_ratings where user_id = ${B} and season = ${season}`);
  const res = await forfeitDuelsForDeletedUser(A);
  assert.ok(res.duelIds.includes(dB) && res.duelIds.includes(dOpen));
  const rB = await duelRow(dB);
  assert.equal(rB.status, "finished");
  assert.equal(rB.finishReason, "forfeit");
  assert.equal(rB.winnerUserId, B);
  assert.equal(rB.opponentRatingDelta, null, "deleted user's delta stays null");
  assert.equal(await num(sql`select rating as n from duel_ratings where user_id = ${B} and season = ${season}`), ratingBefore + rB.challengerRatingDelta!);
  assert.equal(await num(sql`select count(*) as n from duel_ratings where user_id = ${A}`), 0);
  assert.equal((await duelRow(dOpen)).status, "cancelled");
  step("account deletion forfeits active duels and cancels open ones");
}

async function cleanup() {
  if (userIds.length === 0) return;
  const ids = sql.join(userIds.map((u) => sql`${u}::uuid`), sql`, `);
  await db.execute(sql`delete from duel_moves where duel_id in (select id from duels where challenger_user_id in (${ids}) or opponent_user_id in (${ids}))`);
  await db.execute(sql`delete from duels where challenger_user_id in (${ids}) or opponent_user_id in (${ids})`);
  await db.execute(sql`delete from duel_ratings where user_id in (${ids})`);
  await db.execute(sql`delete from point_adjustments where user_id in (${ids}) or created_by_user_id in (${ids})`);
  await db.execute(sql`delete from user_collectibles where user_id in (${ids})`);
  await db.execute(sql`delete from league_members where user_id in (${ids})`);
  if (leagueId) await db.execute(sql`delete from leagues where id = ${leagueId}`);
  await db.execute(sql`delete from users where id in (${ids})`);
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  try {
    await cleanup();
    console.log("cleanup done");
  } catch (err) {
    failed = true;
    console.error("cleanup failed:", err);
  }
}
if (!failed) console.log("OK");
process.exit(failed ? 1 : 0);
