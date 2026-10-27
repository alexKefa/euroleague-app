// Run: npx tsx --test src/services/momentsLogic.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickRoundMoments,
  isRoundReady,
  pickSeriesFirst,
  isMomentsLaunched,
  formatPlayerName,
  MOMENTS_PER_ROUND,
  type PlayerLine,
  type RoundGame,
} from "./momentsLogic.js";

const line = (playerId: string, pir: number | null, points = 10, minutes = 20, gameId = "g1"): PlayerLine => ({
  playerId,
  teamId: "t1",
  gameId,
  pir,
  points,
  rebounds: 5,
  assists: 3,
  minutes,
});

test("MOMENTS_PER_ROUND is one legendary and five rares", () => {
  assert.deepEqual(MOMENTS_PER_ROUND, { legendary: 1, rare: 5 });
});

test("pickRoundMoments ranks by PIR then points then minutes then playerId", () => {
  const picks = pickRoundMoments(
    [line("A", 30, 20, 30), line("B", 30, 22, 25), line("C", 30, 22, 28), line("D", 25), line("E", 40), line("F", 10), line("G", 12)],
    MOMENTS_PER_ROUND
  );
  assert.deepEqual(
    picks.map((p) => [p.line.playerId, p.role]),
    [["E", "mvp"], ["C", "top"], ["B", "top"], ["A", "top"], ["D", "top"], ["G", "top"]]
  );
});

test("pickRoundMoments breaks a full tie by playerId", () => {
  const picks = pickRoundMoments([line("Z", 20), line("Y", 20)], MOMENTS_PER_ROUND);
  assert.deepEqual(picks.map((p) => p.line.playerId), ["Y", "Z"]);
});

test("pickRoundMoments keeps one line per player (best)", () => {
  const picks = pickRoundMoments([line("P", 20, 10, 20, "g1"), line("P", 35, 10, 20, "g2"), line("Q", 30)], MOMENTS_PER_ROUND);
  assert.equal(picks.filter((p) => p.line.playerId === "P").length, 1);
  assert.equal(picks[0].line.playerId, "P");
  assert.equal(picks[0].line.gameId, "g2");
});

test("pickRoundMoments treats null pir as lowest", () => {
  const picks = pickRoundMoments([line("N", null, 40), line("L", 1, 0)], MOMENTS_PER_ROUND);
  assert.deepEqual(picks.map((p) => p.line.playerId), ["L", "N"]);
});

test("pickRoundMoments returns fewer than 6 when fewer players exist", () => {
  const picks = pickRoundMoments([line("A", 3), line("B", 2), line("C", 1)], MOMENTS_PER_ROUND);
  assert.deepEqual(picks.map((p) => p.role), ["mvp", "top", "top"]);
});

const DAY = 864e5;
const T0 = new Date("2027-01-10T18:00:00Z");
const games = (n: number, finalWithStats: number, extra: Partial<RoundGame>[] = []): RoundGame[] =>
  Array.from({ length: n }, (_, i) => ({
    gameId: `g${i}`,
    tipoffAt: new Date(T0.getTime() + i * 3600e3),
    status: i < finalWithStats ? "final" : "scheduled",
    hasStats: i < finalWithStats,
    ...(extra[i] ?? {}),
  }));
const lastTip = new Date(T0.getTime() + 9 * 3600e3);

test("isRoundReady true when all games final with stats", () => {
  const r = isRoundReady(games(10, 10), new Date(lastTip.getTime() + 3 * 3600e3));
  assert.equal(r.ready, true);
  assert.equal(r.gameIds.length, 10);
});

test("isRoundReady false when a game is final without stats and under 7 days", () => {
  const g = games(10, 10);
  g[4] = { ...g[4], hasStats: false };
  assert.equal(isRoundReady(g, new Date(lastTip.getTime() + 2 * DAY)).ready, false);
});

test("isRoundReady true after 7 days with 9 of 10 final+stats", () => {
  const r = isRoundReady(games(10, 9), new Date(lastTip.getTime() + 7 * DAY + 1));
  assert.equal(r.ready, true);
  assert.equal(r.gameIds.length, 9);
  assert.ok(!r.gameIds.includes("g9"));
});

test("isRoundReady false after 7 days with 7 of 10", () => {
  assert.equal(isRoundReady(games(10, 7), new Date(lastTip.getTime() + 8 * DAY)).ready, false);
});

test("isRoundReady false at 6.9 days with 9 of 10", () => {
  assert.equal(isRoundReady(games(10, 9), new Date(lastTip.getTime() + 6.9 * DAY)).ready, false);
});

test("isRoundReady false for an empty round", () => {
  assert.equal(isRoundReady([], T0).ready, false);
});

test("pickSeriesFirst returns only series 1 when any exist", () => {
  const rows = [{ id: "a", s: 2 }, { id: "b", s: 1 }, { id: "c", s: 2 }];
  assert.deepEqual(pickSeriesFirst(rows, (r) => r.s).map((r) => r.id), ["b"]);
});

test("pickSeriesFirst returns all when none are series 1", () => {
  const rows = [{ id: "a", s: 2 }, { id: "c", s: 2 }];
  assert.deepEqual(pickSeriesFirst(rows, (r) => r.s).map((r) => r.id), ["a", "c"]);
});

test("isMomentsLaunched flips at 2027-01-01 00:00 Athens", () => {
  assert.equal(isMomentsLaunched(new Date("2026-12-31T21:59:59Z")), false);
  assert.equal(isMomentsLaunched(new Date("2026-12-31T22:00:00Z")), true);
});

test("formatPlayerName turns feed names into display names", () => {
  assert.equal(formatPlayerName("PETERS, ALEC"), "Alec Peters");
  assert.equal(formatPlayerName("ALSTON JR. , DERRICK"), "Derrick Alston Jr.");
  assert.equal(formatPlayerName("Nunn"), "Nunn");
});
