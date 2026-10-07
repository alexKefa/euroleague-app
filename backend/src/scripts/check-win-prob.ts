// Node checks for the win-probability math (no test suite in this repo).
// Run from backend/: npx tsx src/scripts/check-win-prob.ts
import assert from "node:assert/strict";
import {
  biggestSwings,
  buildCurve,
  clampProb,
  eloProb,
  expectedMargin,
  normCdf,
  normInv,
  secondsLeft,
  winProb,
  type WpEvent,
} from "../services/winProb/model.js";

function check(name: string, fn: () => void) {
  fn();
  console.log("ok", name);
}
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

check("normal cdf / inverse round-trip", () => {
  near(normCdf(0), 0.5);
  near(normCdf(1.96), 0.975);
  near(normCdf(normInv(0.62)), 0.62);
  near(normInv(0.5), 0);
});

check("clampProb keeps p0 away from 0 and 1", () => {
  assert.equal(clampProb(0), 0.01);
  assert.equal(clampProb(1), 0.99);
  assert.equal(clampProb(0.6), 0.6);
  assert.equal(clampProb(Number.NaN), 0.5);
});

check("secondsLeft: regulation and overtime", () => {
  assert.equal(secondsLeft(1, 600), 2400);
  assert.equal(secondsLeft(4, 0), 0);
  assert.equal(secondsLeft(3, 125), 725);
  assert.equal(secondsLeft(5, 300), 300);
  assert.equal(secondsLeft(6, 12), 12);
});

check("tip-off chance equals p0", () => {
  const sigma = 12;
  const mu = expectedMargin(0.62, sigma);
  near(winProb(0, 2400, mu, sigma), 0.62);
});

check("monotonic in margin", () => {
  const mu = expectedMargin(0.5, 12);
  const a = winProb(-5, 600, mu, 12);
  const b = winProb(0, 600, mu, 12);
  const c = winProb(5, 600, mu, 12);
  assert.ok(a < b && b < c);
  near(b, 0.5);
});

check("final buzzer: 1 / 0 / 0.5", () => {
  assert.equal(winProb(1, 0, 3, 12), 1);
  assert.equal(winProb(-1, 0, 3, 12), 0);
  assert.equal(winProb(0, 0, 3, 12), 0.5);
});

check("never NaN, home + away = 1", () => {
  for (const s of [0, 1, 30, 600, 2400]) {
    for (const m of [-20, -1, 0, 1, 20]) {
      const p = winProb(m, s, 2, 12);
      assert.ok(Number.isFinite(p) && p >= 0 && p <= 1);
      near(p + winProb(-m, s, -2, 12), 1);
    }
  }
});

check("elo probability: symmetric, home edge helps", () => {
  near(eloProb(1500, 1500, 0), 0.5);
  near(eloProb(1600, 1500, 0) + eloProb(1500, 1600, 0), 1);
  assert.ok(eloProb(1500, 1500, 60) > 0.5);
});

const HOME = "home-team";
const AWAY = "away-team";
const ev = (orderIdx: number, period: number, clock: number | null, h: number, a: number, points = 0, teamId: string | null = null, playType = "D", playerCode: string | null = null): WpEvent => ({
  orderIdx, period, clockSeconds: clock, homeScoreBefore: h, awayScoreBefore: a, points, teamId, playType, playerCode,
});

check("curve: starts at p0, follows the score, ends decided", () => {
  const events = [
    ev(1, 1, 590, 0, 0, 2, HOME, "2FGM", "P1"),
    ev(2, 2, 300, 2, 0, 3, AWAY, "3FGM", "P2"),
    ev(3, 4, 5, 2, 3, 3, HOME, "3FGM", "P1"),
    ev(4, 4, 0, 5, 3, 0, null, "EG"),
  ];
  const pts = buildCurve(events, HOME, 0.5, 12);
  near(pts[0].homeProb, 0.5);
  assert.equal(pts[0].s, 2400);
  assert.equal(pts.at(-1)!.s, 0);
  assert.equal(pts.at(-1)!.homeProb, 1);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].s <= pts[i - 1].s, "time never runs backwards");
});

check("curve: skips missing clocks, sorts by order", () => {
  const events = [ev(3, 4, 0, 10, 8, 0), ev(1, 1, 500, 0, 0, 2, HOME, "2FGM"), ev(2, 2, null, 2, 0, 0)];
  const pts = buildCurve(events, HOME, 0.5, 12);
  assert.equal(pts.length, 3); // start + 2 events with clocks
  assert.equal(pts[1].period, 1);
});

check("swings: biggest change, labelled with the scoring play", () => {
  const events = [
    ev(1, 1, 500, 0, 0, 2, HOME, "2FGM", "P1"),
    ev(2, 4, 20, 70, 70, 3, AWAY, "3FGM", "P9"),
    ev(3, 4, 10, 70, 73, 2, HOME, "2FGM", "P1"),
  ];
  const pts = buildCurve(events, HOME, 0.5, 12);
  const swings = biggestSwings(pts, 2);
  assert.equal(swings.length, 2);
  assert.equal(swings[0].event?.playerCode, "P9");
  assert.ok(swings[0].homeProbAfter < swings[0].homeProbBefore);
  assert.ok(Math.abs(swings[0].homeProbAfter - swings[0].homeProbBefore) >= Math.abs(swings[1].homeProbAfter - swings[1].homeProbBefore));
});
