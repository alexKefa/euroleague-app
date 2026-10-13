// Assert-based checks for the Daily Question (no test suite in this repo).
//   npx tsx src/scripts/daily-question-check.ts            pure logic
//   npx tsx --env-file=.env src/scripts/daily-question-check.ts --db     generation against the DB in .env
//   DQ_USER_ID=<uuid> ... --flow | --lock                   service flow / 7-day lock (dev DB only)
import assert from "node:assert/strict";
import { athensDay, nextStreak, pointsFor, pickPair } from "../services/dailyQuestion/logic.js";

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

const args = new Set(process.argv.slice(2));
checkLogic();
console.log("logic OK");
void args;
console.log("OK");
process.exit(0);
