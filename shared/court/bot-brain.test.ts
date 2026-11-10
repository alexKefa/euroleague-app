// Run: (backend) npm run test:court
import { test } from "node:test";
import assert from "node:assert/strict";
import { BotBrain, type BotView } from "./bot-brain.js";
import { FENCE, insideThreePoint } from "./geometry.js";
import { layupEligible } from "./shot.js";
import { HORSE_SPOT_RADIUS } from "./horse.js";
import { createRng } from "./rng.js";

const DT = 0.05;

/** Run a brain against a tiny world (it moves where it says; shots make it busy for 2 s). */
function simulate(brain: BotBrain, seconds: number, view: Partial<BotView> = {}) {
  let x = 0;
  let z = -6;
  let busyUntil = 0;
  const shots: { x: number; z: number; layup: boolean; vx: number; vz: number }[] = [];
  let outside = 0;
  for (let t = 0; t < seconds * 1000; t += DT * 1000) {
    const out = brain.step(t, DT, { x, z, phase: "free", turnId: "", spot: null, busy: t < busyUntil, ...view });
    if (out.move) {
      x = out.move.x;
      z = out.move.z;
      if (x < FENCE.minX || x > FENCE.maxX || z < FENCE.minZ || z > FENCE.maxZ) outside++;
    }
    if (out.shoot) {
      shots.push({ x, z, ...out.shoot });
      busyUntil = t + 2000;
    }
  }
  return { shots, outside, x, z };
}

test("bot: shoots around in free play and stays inside the fence", () => {
  const { shots, outside } = simulate(new BotBrain("bot1", createRng(1)), 60);
  assert.ok(shots.length >= 4, `only ${shots.length} shots in a minute`);
  assert.equal(outside, 0);
});

test("bot: a layup it claims is one the server will accept (close, driving at the rim)", () => {
  let layups = 0;
  for (let seed = 1; seed <= 6; seed++) {
    for (const s of simulate(new BotBrain("bot1", createRng(seed)), 60).shots) {
      if (!s.layup) continue;
      layups++;
      assert.ok(layupEligible(s.x, s.z, "A", s.vx, s.vz), `layup from (${s.x.toFixed(2)}, ${s.z.toFixed(2)})`);
    }
  }
  assert.ok(layups > 0, "never tried a layup");
});

test("bot: H-O-R-S-E, not its turn: never shoots", () => {
  const { shots } = simulate(new BotBrain("bot1", createRng(2)), 30, { phase: "matching", turnId: "someone", spot: { x: 2, z: -9 } });
  assert.equal(shots.length, 0);
});

test("bot: H-O-R-S-E matching on its turn: walks to the spot, then shoots once", () => {
  const spot = { x: 3, z: -9.5 };
  const { shots } = simulate(new BotBrain("bot1", createRng(3)), 15, { phase: "matching", turnId: "bot1", spot });
  assert.equal(shots.length, 1);
  assert.ok(Math.hypot(shots[0]!.x - spot.x, shots[0]!.z - spot.z) <= HORSE_SPOT_RADIUS, "shot from the spot");
});

test("bot: H-O-R-S-E setting on its turn: sets from inside the arc", () => {
  const { shots } = simulate(new BotBrain("bot1", createRng(4)), 15, { phase: "setting", turnId: "bot1", spot: null });
  assert.equal(shots.length, 1);
  assert.ok(insideThreePoint("A", shots[0]!.x, shots[0]!.z));
});
