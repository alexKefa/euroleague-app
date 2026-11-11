// Run: (backend) npm run test:court
import { test } from "node:test";
import assert from "node:assert/strict";
import { GRAVITY, METER_ERROR_SPAN, METER_SWEET_CENTER, METER_WHITE_WIDTH, PHYSICS_STEP, RIM_INNER_RADIUS, BALL_RADIUS } from "./constants.js";
import { ACTIVE_HOOPS, HOOP_IDS, clampPlayerPosition, FENCE, insideThreePoint, pickTargetHoop, rimCenter } from "./geometry.js";
import {
  apexAboveRim,
  clampTiming,
  computeShotLaunch,
  effectiveTiming,
  greenHalfWidth,
  idealVelocity,
  releaseGrade,
  releasePoint,
  shotDistance,
  timingErrorFromMeter,
} from "./shot.js";
import { Vec3 } from "./types.js";

/** Step a ball like the physics engine (semi-implicit Euler, no contacts) and
 *  return where its centre crosses the rim plane on the way down. */
function crossRimPlane(origin: Vec3, v: Vec3, rimY: number): { x: number; z: number; apex: number } | null {
  let p = { ...origin };
  let vel = { ...v };
  let apex = p.y;
  for (let i = 0; i < 600; i++) {
    vel = { ...vel, y: vel.y - GRAVITY * PHYSICS_STEP };
    const next = { x: p.x + vel.x * PHYSICS_STEP, y: p.y + vel.y * PHYSICS_STEP, z: p.z + vel.z * PHYSICS_STEP };
    apex = Math.max(apex, next.y);
    if (vel.y < 0 && p.y >= rimY && next.y < rimY) {
      const f = (p.y - rimY) / (p.y - next.y);
      return { x: p.x + (next.x - p.x) * f, z: p.z + (next.z - p.z) * f, apex };
    }
    p = next;
  }
  return null;
}

const SPOTS: Array<[number, number]> = [
  [0, -11], // straight on, close
  [3, -10], // wing mid-range
  [-5.5, -8], // long two
  [6.4, -12], // corner three
  [0, -5.6], // top of the key three
  [2, 0], // half court
];

test("ideal velocity drops the ball through the rim centre", () => {
  const rim = rimCenter("A");
  for (const [x, z] of SPOTS) {
    const o = releasePoint(x, z, "A");
    const hit = crossRimPlane(o, idealVelocity(o, rim), rim.y);
    assert.ok(hit, `no rim-plane crossing from (${x}, ${z})`);
    const miss = Math.hypot(hit.x - rim.x, hit.z - rim.z);
    assert.ok(miss < 0.02, `from (${x}, ${z}) the ideal shot lands ${miss.toFixed(3)} m off centre`);
    assert.ok(miss < RIM_INNER_RADIUS - BALL_RADIUS);
  }
});

test("apex sits 1.0-1.5 m above the rim, higher from further out", () => {
  const rim = rimCenter("B");
  let prev = 0;
  for (const d of [1, 3, 5, 7, 9]) {
    const o = { x: 0, y: 2.2, z: rim.z - d };
    const hit = crossRimPlane(o, idealVelocity(o, rim), rim.y)!;
    const above = hit.apex - rim.y;
    assert.ok(above >= 0.97 && above <= 1.53, `apex ${above.toFixed(2)} m above the rim from ${d} m`);
    assert.ok(above >= prev - 1e-9);
    prev = above;
    assert.ok(apexAboveRim(d) >= 1 && apexAboveRim(d) <= 1.5);
  }
});

test("the release point is pulled back when standing under the rim", () => {
  const rim = rimCenter("A");
  const o = releasePoint(rim.x, rim.z, "A");
  assert.ok(Math.hypot(o.x - rim.x, o.z - rim.z) > 0.85);
  assert.ok(o.z > rim.z, "pulled towards midcourt");
});

test("timing error is clamped and NaN counts as fully late", () => {
  assert.equal(clampTiming(5), 1);
  assert.equal(clampTiming(-5), -1);
  assert.equal(clampTiming(Number.NaN), 1);
  assert.equal(effectiveTiming(0, 5), 0);
});

test("the meter maps the sweet spot to a perfect release", () => {
  const g = greenHalfWidth(5);
  assert.equal(timingErrorFromMeter(METER_SWEET_CENTER), 0);
  const edge = timingErrorFromMeter(METER_SWEET_CENTER + g * 0.99);
  assert.equal(effectiveTiming(edge, 5), 0);
  assert.ok(effectiveTiming(timingErrorFromMeter(METER_SWEET_CENTER + g * 1.5), 5) > 0);
  assert.ok(timingErrorFromMeter(0) < 0 && timingErrorFromMeter(1.2) > 0);
});

test("the green is wide at the rim and tight from deep; layups get the wide one", () => {
  const ws = [0.5, 1.5, 3, 4, 5.5, 6.75, 8, 10].map((d) => greenHalfWidth(d));
  for (let i = 1; i < ws.length; i++) assert.ok(ws[i]! <= ws[i - 1]!, `green ${ws.join(" >= ")}`);
  assert.ok(ws[0]! >= 2.5 * ws[ws.length - 1]!);
  assert.equal(greenHalfWidth(2.5, "layup"), greenHalfWidth(0));
  const rim = rimCenter("A");
  assert.ok(Math.abs(shotDistance(0, rim.z + 6, "A") - 6) < 1e-9);
});

test("release grades: green, then slightly, then plain, then very", () => {
  const d = 6;
  const g = greenHalfWidth(d);
  const t = (meter: number) => meter / METER_ERROR_SPAN;
  assert.equal(releaseGrade(t(g * 0.9), d), "perfect");
  assert.equal(releaseGrade(t(-(g + METER_WHITE_WIDTH * 0.5)), d), "slightlyEarly");
  assert.equal(releaseGrade(t(g + METER_WHITE_WIDTH * 0.5), d), "slightlyLate");
  assert.equal(releaseGrade(t(-(g + METER_WHITE_WIDTH + 0.05)), d), "early");
  assert.equal(releaseGrade(t(g + METER_WHITE_WIDTH + 0.05), d), "late");
  assert.equal(releaseGrade(-1, d), "veryEarly");
  assert.equal(releaseGrade(1, d), "veryLate");
  // The same release is green at the rim and not from deep.
  assert.equal(releaseGrade(t(0.06), 1), "perfect");
  assert.notEqual(releaseGrade(t(0.06), 7), "perfect");
});

test("a green release flies the ideal arc, whatever the seed", () => {
  const a = computeShotLaunch(3, -6, "A", 0, 1);
  const b = computeShotLaunch(3, -6, "A", 0, 987654);
  assert.deepEqual(a.velocity, b.velocity);
  const ideal = idealVelocity(a.origin, rimCenter("A"));
  assert.deepEqual(a.velocity, ideal);
});

test("a perfect release is perfect, an off one is not", () => {
  assert.equal(computeShotLaunch(0, -8, "A", 0, 1).perfect, true);
  assert.equal(computeShotLaunch(0, -8, "A", 0.5, 1).perfect, false);
});

test("same seed, same launch (client and server agree)", () => {
  const a = computeShotLaunch(2.5, -7, "A", 0.37, 12345);
  const b = computeShotLaunch(2.5, -7, "A", 0.37, 12345);
  assert.deepEqual(a, b);
});

function landingMiss(x: number, z: number, e: number, seed: number): number {
  const rim = rimCenter("A");
  const l = computeShotLaunch(x, z, "A", e, seed);
  const hit = crossRimPlane(l.origin, l.velocity, rim.y);
  if (!hit) return 99;
  return Math.hypot(hit.x - rim.x, hit.z - rim.z);
}

function meanMiss(x: number, z: number, e: number): number {
  let sum = 0;
  for (let seed = 1; seed <= 200; seed++) sum += landingMiss(x, z, e, seed);
  return sum / 200;
}

test("error grows with |timingError|", () => {
  const errs = [0, 0.15, 0.25, 0.35, 0.5].map((e) => meanMiss(3, -8, e));
  for (let i = 1; i < errs.length; i++) assert.ok(errs[i]! > errs[i - 1]!, `miss ${errs.map((m) => m.toFixed(3)).join(" < ")}`);
});

test("error grows with distance (threes are harder than layups)", () => {
  assert.ok(meanMiss(0, -10.5, 0.4) < meanMiss(0, -7.5, 0.4));
  assert.ok(meanMiss(0, -7.5, 0.4) < meanMiss(0, -5.4, 0.4));
});

test("perfect releases land dead centre", () => {
  assert.ok(meanMiss(0, -7.8, 0) < 0.01);
});

test("early falls short, late goes long", () => {
  const rim = rimCenter("A");
  const z = -8;
  const land = (e: number) => {
    const l = computeShotLaunch(0, z, "A", e, 7);
    return crossRimPlane(l.origin, l.velocity, rim.y)!.z;
  };
  // Shooting towards -z: short = larger z than the rim, long = smaller.
  assert.ok(land(-0.8) > rim.z);
  assert.ok(land(0.8) < rim.z);
});

test("targeting: hoop in front, else the nearest", () => {
  // Facing -z (rotY = PI) from midcourt-ish: hoop A is in front.
  assert.equal(pickTargetHoop(0, -2, Math.PI, HOOP_IDS).hoopId, "A");
  // Facing +z near hoop A: hoop B is in front (within 60°), even though A is nearer.
  assert.equal(pickTargetHoop(0, -9, 0, HOOP_IDS).hoopId, "B");
  // Facing sideways: nothing in front, nearest wins.
  assert.equal(pickTargetHoop(0, -9, Math.PI / 2, HOOP_IDS).hoopId, "A");
  assert.equal(pickTargetHoop(0, 9, -Math.PI / 2, HOOP_IDS).hoopId, "B");
});

test("3-point area", () => {
  const rim = rimCenter("A");
  assert.ok(insideThreePoint("A", 0, rim.z + 6.5));
  assert.ok(!insideThreePoint("A", 0, rim.z + 7));
  assert.ok(!insideThreePoint("A", 6.7, -13)); // corner three is outside
  assert.ok(insideThreePoint("A", 6.5, -13));
  assert.ok(!insideThreePoint("B", 0, rim.z + 6.5));
});

test("half court: every shot targets an active hoop, players stay inside the fence", () => {
  for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    assert.ok(ACTIVE_HOOPS.includes(pickTargetHoop(0, 1, rot).hoopId));
  }
  const p = clampPlayerPosition(100, 100);
  assert.ok(p.x < FENCE.maxX && p.z < FENCE.maxZ);
  const q = clampPlayerPosition(-100, -100);
  assert.ok(q.x > FENCE.minX && q.z > FENCE.minZ);
});
