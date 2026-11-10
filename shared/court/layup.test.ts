// Run: (backend) npm run test:court
// Layups: who gets one (driving at the rim, close), what the launch looks
// like, and real-physics make rates (Rapier, same as the server).
import { test } from "node:test";
import assert from "node:assert/strict";
import RAPIER from "../../frontend/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs";
import { CourtPhysics, type RapierApi } from "./sim.js";
import { rimCenter } from "./geometry.js";
import { LAYUP_RELEASE_HEIGHT, RELEASE_HEIGHT } from "./constants.js";
import { computeShotLaunch, layupEligible, meterOverheld, meterValue, timingErrorFromMeter } from "./shot.js";
import { LAYUP_METER_FILL_SECONDS, METER_FILL_SECONDS, METER_SWEET_CENTER } from "./constants.js";

await RAPIER.init();
const phys = new CourtPhysics(RAPIER as unknown as RapierApi);
const rim = rimCenter("A");

/** A point `d` metres from the rim at angle `a` (0 = straight out towards midcourt). */
function spot(d: number, a = 0): { x: number; z: number } {
  return { x: rim.x + Math.sin(a) * d, z: rim.z + Math.cos(a) * d };
}
/** Velocity of `speed` m/s straight at the rim from p. */
function towardRim(p: { x: number; z: number }, speed: number): { vx: number; vz: number } {
  const d = Math.hypot(rim.x - p.x, rim.z - p.z);
  return { vx: ((rim.x - p.x) / d) * speed, vz: ((rim.z - p.z) / d) * speed };
}

test("layup: driving at the rim from close range qualifies", () => {
  for (const a of [0, 0.8, -1.1]) {
    const p = spot(2.2, a);
    const v = towardRim(p, 3.5);
    assert.equal(layupEligible(p.x, p.z, "A", v.vx, v.vz), true, `angle ${a}`);
  }
});

test("layup: standing still, drifting away or too far out is a jump shot", () => {
  const p = spot(2.2);
  const v = towardRim(p, 3.5);
  assert.equal(layupEligible(p.x, p.z, "A", 0, 0), false, "standing");
  assert.equal(layupEligible(p.x, p.z, "A", -v.vx, -v.vz), false, "moving away");
  assert.equal(layupEligible(p.x, p.z, "A", v.vz, -v.vx), false, "running across");
  const far = spot(4.5);
  const vf = towardRim(far, 4.5);
  assert.equal(layupEligible(far.x, far.z, "A", vf.vx, vf.vz), false, "too far");
  assert.equal(layupEligible(NaN, p.z, "A", v.vx, v.vz), false, "bad input");
});

test("layup: released higher and closer than a jumper from the same spot", () => {
  const p = spot(2.4);
  const jumper = computeShotLaunch(p.x, p.z, "A", 0, 42);
  const layup = computeShotLaunch(p.x, p.z, "A", 0, 42, "layup");
  assert.equal(layup.kind, "layup");
  assert.equal(jumper.kind, "jumper");
  assert.equal(layup.origin.y, LAYUP_RELEASE_HEIGHT);
  assert.equal(jumper.origin.y, RELEASE_HEIGHT);
  assert.ok(layup.distance < jumper.distance - 0.3, `${layup.distance} vs ${jumper.distance}`);
  assert.ok(layup.distance >= 0.5, "never released from right under the rim");
});

test("layup: same seed, same launch (client prediction = server)", () => {
  const p = spot(1.8, 0.4);
  assert.deepEqual(computeShotLaunch(p.x, p.z, "A", 0.3, 7, "layup"), computeShotLaunch(p.x, p.z, "A", 0.3, 7, "layup"));
});

test("layup: the meter fills faster (a quick gather, not a set shot)", () => {
  assert.ok(LAYUP_METER_FILL_SECONDS < METER_FILL_SECONDS);
  const sweetHeld = METER_SWEET_CENTER * LAYUP_METER_FILL_SECONDS;
  assert.equal(timingErrorFromMeter(meterValue(sweetHeld, LAYUP_METER_FILL_SECONDS)), 0);
  assert.equal(meterOverheld(LAYUP_METER_FILL_SECONDS + 0.25, LAYUP_METER_FILL_SECONDS), true);
});

function makeRate(kind: "jumper" | "layup", timing: number, n = 160): number {
  let made = 0;
  for (let i = 0; i < n; i++) {
    const p = spot(1.2 + (i % 8) * 0.25, ((i % 7) - 3) * 0.35);
    if (phys.simulate(computeShotLaunch(p.x, p.z, "A", timing, 1000 + i * 7919, kind)).made) made++;
  }
  return made / n;
}

test("layup physics: a well-timed layup almost always drops", () => {
  const rate = makeRate("layup", 0);
  assert.ok(rate >= 0.92, `perfect layups made ${(rate * 100).toFixed(0)}%`);
});

test("layup physics: forgiving, but a badly mistimed layup still misses a lot", () => {
  const ok = makeRate("layup", 0.35);
  const bad = makeRate("layup", 1);
  assert.ok(ok >= 0.6, `slightly off layups made ${(ok * 100).toFixed(0)}%`);
  assert.ok(bad <= 0.45, `fully mistimed layups made ${(bad * 100).toFixed(0)}%`);
  assert.ok(makeRate("layup", 0.35) > makeRate("jumper", 0.35), "a layup beats a jumper at the same timing up close");
});
