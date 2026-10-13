// Assert-based checks for the Daily Question (no test suite in this repo).
//   npx tsx src/scripts/daily-question-check.ts            pure logic
//   npx tsx --env-file=.env src/scripts/daily-question-check.ts --db     generation against the DB in .env
//   DQ_USER_ID=<uuid> ... --flow | --lock                   service flow / 7-day lock (dev DB only)
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { athensDay, nextStreak, pointsFor, pickPair } from "../services/dailyQuestion/logic.js";

// DB modules load only for the DB sections, so the logic check needs no env.
const dbModules = async () => ({
  db: (await import("../db/client.js")).db,
  generateQuestion: (await import("../services/dailyQuestion/generate.js")).generateQuestion,
});

function checkLogic(): void {
  assert.equal(athensDay(new Date("2026-10-13T20:59:59Z")), "2026-10-13"); // 23:59:59 Athens (UTC+3)
  assert.equal(athensDay(new Date("2026-10-13T21:00:01Z")), "2026-10-14");
  assert.equal(athensDay(new Date("2026-12-01T22:30:00Z")), "2026-12-02"); // winter UTC+2
  assert.equal(nextStreak(null), 1);
  assert.equal(nextStreak(6), 7);
  assert.deepEqual(pointsFor(1, false), { streakBonus: 3, correctBonus: 0, milestone: 0, total: 3 });
  assert.deepEqual(pointsFor(7, true), { streakBonus: 21, correctBonus: 30, milestone: 75, total: 126 });
  assert.equal(pointsFor(12, true).total, 60);
  assert.equal(pointsFor(30, false).total, 330);
  assert.equal(pointsFor(60, true).milestone, 300);
  assert.equal(pointsFor(31, true).milestone, 0);
  const seq = (xs: number[]) => xs.map((value, i) => ({ id: i, value }));
  const sorted = (p: { value: number }[]) => p.map((x) => x.value).sort((a, b) => a - b);
  assert.deepEqual(sorted(pickPair(seq([10, 12, 30]), () => 0)!), [10, 12]); // 1.2 fits the tight band
  assert.equal(pickPair(seq([10, 10]), Math.random), null);
  assert.deepEqual(sorted(pickPair(seq([10, 13.5]), () => 0)!), [10, 13.5]); // 1.35, widened band only
  assert.equal(pickPair(seq([10, 20]), Math.random), null); // 2.0, outside both bands
}

async function checkGeneration(): Promise<void> {
  const { db, generateQuestion } = await dbModules();
  const day = athensDay(new Date());
  const qs = [];
  for (let i = 0; i < 20; i++) {
    const q = await generateQuestion(day);
    assert.ok(q, "generateQuestion returned null");
    assert.notEqual(q.valueA, q.valueB);
    assert.notEqual(q.playerAId, q.playerBId);
    const ratio = Math.max(q.valueA, q.valueB) / Math.min(q.valueA, q.valueB);
    assert.ok(ratio >= 1.1 && ratio <= 1.4, `ratio ${ratio} out of band`);
    qs.push(q);
  }
  const ids = [...new Set(qs.flatMap((q) => [q.playerAId, q.playerBId]))];
  const rows = (await db.execute<{ id: string; name: string }>(
    sql`select id, name from players where id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`
  )) as { id: string; name: string }[];
  const name = new Map(rows.map((r) => [r.id, r.name]));
  for (const q of qs) console.log(`${q.template.padEnd(10)} ${q.stat.padEnd(8)} ${name.get(q.playerAId)} ${q.valueA}  vs  ${name.get(q.playerBId)} ${q.valueB}`);
  console.log("generation OK");
}

// --flow / --lock write and delete only DQ_USER_ID's daily-question rows.
// Run them against the dev DB only.
function testUser(): string {
  const u = process.env.DQ_USER_ID;
  assert.ok(u, "set DQ_USER_ID to a dev user id");
  return u;
}

async function resetUser(u: string): Promise<void> {
  const { db } = await dbModules();
  await db.execute(sql`delete from point_adjustments where user_id = ${u}::uuid and reason = 'daily_question'`);
  await db.execute(sql`delete from daily_questions where user_id = ${u}::uuid`);
}

async function dqPaid(u: string): Promise<number> {
  const { db } = await dbModules();
  const [r] = (await db.execute<{ total: number }>(
    sql`select coalesce(sum(points), 0)::int as total from point_adjustments where user_id = ${u}::uuid and reason = 'daily_question'`
  )) as { total: number }[];
  return r.total;
}

async function checkFlow(): Promise<void> {
  const { db } = await dbModules();
  const svc = await import("../services/dailyQuestion/service.js");
  const u = testUser();
  // A fixed question from two real players: the dev DB's box scores can't
  // always produce one, and the flow is what's under test here.
  const players = (await db.execute<{ id: string }>(sql`select id from players where active order by id limit 2`)) as { id: string }[];
  const fixed = async () => ({ template: "last_game" as const, stat: "points" as const, playerAId: players[0].id, playerBId: players[1].id, valueA: 12, valueB: 10 });

  await resetUser(u);
  const ready = await svc.getDailyQuestionState(u);
  assert.equal(ready.status, "ready");
  assert.equal(ready.today, null);

  const [s1, s2] = await Promise.all([svc.startDailyQuestion(u, new Date(), fixed), svc.startDailyQuestion(u, new Date(), fixed)]);
  const [count] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from daily_questions where user_id = ${u}::uuid`)) as { n: number }[];
  assert.equal(count.n, 1, "double start must create one row");
  assert.equal(s1.status, "in_progress");
  assert.equal(s1.today!.playerA.id, s2.today!.playerA.id);
  assert.equal(s1.today!.result, null);
  assert.ok(!JSON.stringify(s1).includes("valueA"), "values leaked before answering");
  assert.ok(s1.today!.remainingMs! > 0);

  const done = await svc.answerDailyQuestion(u, "a"); // a = 12 > 10
  assert.ok(!("error" in done));
  assert.equal(done.status, "done");
  assert.equal(done.today!.result!.correct, true);
  assert.equal(done.today!.result!.points.total, 33);
  const again = await svc.answerDailyQuestion(u, "b");
  assert.ok(!("error" in again));
  assert.equal(again.today!.result!.correct, true, "second answer must not change the result");
  assert.equal(await dqPaid(u), 33, "second answer must not pay twice");

  // Timeout: served, never answered, read 13 s later.
  await resetUser(u);
  const t0 = new Date();
  await svc.startDailyQuestion(u, t0, fixed);
  const late = await svc.getDailyQuestionState(u, new Date(t0.getTime() + 13_000));
  assert.equal(late.status, "done");
  assert.equal(late.today!.result!.choice, null);
  assert.equal(late.today!.result!.correct, false);
  assert.equal(late.today!.result!.points.total, 3);
  const lateAnswer = await svc.answerDailyQuestion(u, "a", new Date(t0.getTime() + 14_000));
  assert.ok(!("error" in lateAnswer));
  assert.equal(lateAnswer.today!.result!.correct, false);
  assert.equal(await dqPaid(u), 3);

  // Streak: yesterday at 6, today correct -> 21 + 30 + 75.
  await resetUser(u);
  const today = athensDay(new Date());
  await db.execute(sql`
    insert into daily_questions (user_id, day, template, stat, player_a_id, player_b_id, value_a, value_b, served_at, streak, resolved_at, points_awarded, correct)
    values (${u}::uuid, ${today}::date - 1, 'last_game', 'points', ${players[0].id}::uuid, ${players[1].id}::uuid, 12, 10, now() - interval '1 day', 6, now() - interval '1 day', 0, false)
  `);
  await svc.startDailyQuestion(u, new Date(), fixed);
  const streakDay = await svc.answerDailyQuestion(u, "a");
  assert.ok(!("error" in streakDay));
  assert.equal(streakDay.streak, 7);
  assert.equal(streakDay.today!.result!.points.total, 126);

  // Not started: answering with no row.
  await resetUser(u);
  const none = await svc.answerDailyQuestion(u, "a");
  assert.deepEqual(none, { error: "not_started" });

  await resetUser(u);
  console.log("flow OK");
}

async function checkLock(): Promise<void> {
  const { db } = await dbModules();
  const { getUserPoints } = await import("../services/points.js");
  const u = testUser();
  await resetUser(u);
  const [orig] = (await db.execute<{ created_at: string }>(sql`select created_at from users where id = ${u}::uuid`)) as { created_at: string }[];
  try {
    const before = await getUserPoints(u);
    await db.execute(sql`insert into point_adjustments (user_id, points, reason, created_by_user_id, counts_toward_ranking) values (${u}::uuid, 33, 'daily_question', ${u}::uuid, false)`);
    await db.execute(sql`update users set created_at = now() - interval '2 days' where id = ${u}::uuid`);
    assert.equal(await getUserPoints(u), before, "young account must not spend daily-question points");
    await db.execute(sql`update users set created_at = now() - interval '8 days' where id = ${u}::uuid`);
    assert.equal(await getUserPoints(u), before + 33, "points unlock after 7 days");
  } finally {
    await db.execute(sql`update users set created_at = ${orig.created_at}::timestamptz where id = ${u}::uuid`);
    await resetUser(u);
  }
  console.log("lock OK");
}

const args = new Set(process.argv.slice(2));
checkLogic();
console.log("logic OK");
if (args.has("--db")) await checkGeneration();
if (args.has("--flow")) await checkFlow();
if (args.has("--lock")) await checkLock();
console.log("OK");
process.exit(0);
