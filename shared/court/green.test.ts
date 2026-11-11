// Run: (backend) npm run test:court
// The 2K rule: a green (perfect) release goes in from anywhere on the court,
// checked against the real Rapier simulation the server uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import RAPIER from "../../frontend/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs";
import { CourtPhysics, type RapierApi } from "./sim.js";
import { computeShotLaunch, shotDistance } from "./shot.js";
import { GREEN_MAX_DISTANCE } from "./constants.js";
import { FENCE, clampPlayerPosition, rimCenter } from "./geometry.js";

await RAPIER.init();
const phys = new CourtPhysics(RAPIER as unknown as RapierApi);
const rim = rimCenter("A");

test("green jumpers go in from every in-range spot (1 m grid, behind the board included)", () => {
  const misses: string[] = [];
  for (let x = FENCE.minX + 0.5; x <= FENCE.maxX - 0.5; x += 1) {
    for (let z = FENCE.minZ + 0.5; z <= FENCE.maxZ - 0.5; z += 1) {
      const p = clampPlayerPosition(x, z);
      if (shotDistance(p.x, p.z, "A") > GREEN_MAX_DISTANCE) continue;
      if (!phys.simulate(computeShotLaunch(p.x, p.z, "A", 0, 1)).made) misses.push(`(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
    }
  }
  assert.deepEqual(misses, []);
});

test("green layups go in from every angle, baseline drives included", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const misses: string[] = [];
  for (let i = 0; i < 150; i++) {
    const a = rand() * Math.PI * 2;
    const d = 0.3 + rand() * 2.9;
    const x = rim.x + Math.sin(a) * d;
    const z = rim.z + Math.cos(a) * d;
    if (!phys.simulate(computeShotLaunch(x, z, "A", 0, i, "layup")).made) misses.push(`(${x.toFixed(2)}, ${z.toFixed(2)})`);
  }
  assert.deepEqual(misses, []);
});

test("just off the green (white zone) still usually drops from three", () => {
  let made = 0;
  const n = 200;
  for (let i = 0; i < n; i++) {
    const a = ((i / n) * 2 - 1) * 1.2;
    const x = rim.x + Math.sin(a) * 7;
    const z = rim.z + Math.cos(a) * 7;
    // About halfway into the white zone, late (green 0.022 + 0.015 past it).
    if (phys.simulate(computeShotLaunch(x, z, "A", 0.037 / 0.4, i + 1)).made) made++;
  }
  assert.ok(made / n >= 0.4 && made / n <= 0.9, `white-zone threes made ${made}/${n}`);
});

test("half-court heaves rarely go in, even dead-centre", () => {
  let made = 0;
  const n = 200;
  for (let i = 0; i < n; i++) {
    const p = clampPlayerPosition(rim.x + ((i % 9) - 4), 0);
    if (phys.simulate(computeShotLaunch(p.x, p.z, "A", 0, i + 1)).made) made++;
  }
  assert.ok(made / n <= 0.12, `heaves made ${made}/${n}`);
});
