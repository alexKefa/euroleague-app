// Run: (backend) npm run test:court
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_TALLY, HOT_STREAK, applyShot, headToHead, rankScores, shootingPct, type ScoreLine } from "./scoreboard.js";

const line = (id: string, makes: number, attempts: number, joinedAt: number, extra: Partial<ScoreLine> = {}): ScoreLine => ({
  id,
  name: id,
  color: "#000",
  makes,
  attempts,
  streak: 0,
  best: 0,
  threes: 0,
  joinedAt,
  connected: true,
  ...extra,
});

test("tally: a make counts, extends the streak and the best; a three is a three", () => {
  let t = applyShot(EMPTY_TALLY, true, false);
  t = applyShot(t, true, true);
  t = applyShot(t, true, false);
  assert.deepEqual(t, { makes: 3, attempts: 3, streak: 3, best: 3, threes: 1 });
  t = applyShot(t, false, true);
  assert.deepEqual(t, { makes: 3, attempts: 4, streak: 0, best: 3, threes: 1 });
  assert.equal(t.streak >= HOT_STREAK, false);
});

test("percentage: rounded, and null before the first shot", () => {
  assert.equal(shootingPct(0, 0), null);
  assert.equal(shootingPct(2, 3), 67);
  assert.equal(shootingPct(5, 5), 100);
});

test("ranking: most makes, then better %, then fewer attempts, then who joined first; disconnected players drop out", () => {
  const ranked = rankScores([
    line("a", 5, 10, 1),
    line("b", 7, 20, 2),
    line("c", 5, 8, 3),
    line("d", 5, 8, 0),
    line("gone", 50, 50, 4, { connected: false }),
  ]);
  assert.deepEqual(
    ranked.map((l) => l.id),
    ["b", "d", "c", "a"]
  );
});

test("head-to-head: the top two, kept in join order so names don't swap sides as the lead changes", () => {
  assert.equal(headToHead([line("a", 1, 1, 1)]), null);
  const [left, right] = headToHead([line("late", 9, 9, 5), line("early", 2, 4, 1), line("third", 1, 9, 2)])!;
  assert.equal(left.id, "early");
  assert.equal(right.id, "late");
});
