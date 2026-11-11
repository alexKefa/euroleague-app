// Monte Carlo make-rate table by distance x release timing, for tuning shot.ts.
// Columns are meter units past the green window (+ late, - early), so "green"
// should always read 100. Not part of either app. Run from the repo root
// after a frontend npm install:
//   backend/node_modules/.bin/tsx shared/court/tune-shots.ts [samples=300]
import RAPIER from "../../frontend/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs";
import { CourtPhysics, RapierApi } from "./sim.js";
import { computeShotLaunch, greenHalfWidth, shotDistance } from "./shot.js";
import { METER_ERROR_SPAN } from "./constants.js";
import { clampPlayerPosition, rimCenter } from "./geometry.js";
await RAPIER.init();
const phys = new CourtPhysics(RAPIER as unknown as RapierApi);
const rim = rimCenter("A");
const N = Number(process.argv[2] ?? 300);
const cols = ["green", 0.015, 0.03, -0.03, 0.06, -0.06, 0.1] as const;
console.log("cols = meter units past the green (+late / -early)");
for (const d of [1.5, 3, 4.6, 6, 7.2, 8.5, 10, 11.5, 13]) {
  const row: string[] = [];
  for (const c of cols) {
    let made = 0;
    let n = 0;
    while (n < N) {
      // Anywhere on the half court at this distance, corners and baseline included.
      const ang = (Math.random() - 0.5) * 2 * Math.PI * 0.62;
      const p = clampPlayerPosition(rim.x + Math.sin(ang) * d, rim.z + Math.cos(ang) * d);
      if (Math.abs(Math.hypot(p.x - rim.x, p.z - rim.z) - d) > 0.05) continue;
      n++;
      const g = greenHalfWidth(shotDistance(p.x, p.z, "A"));
      const meter = c === "green" ? (Math.random() * 2 - 1) * g * 0.999 : Math.sign(c) * (g + Math.abs(c));
      const l = computeShotLaunch(p.x, p.z, "A", meter / METER_ERROR_SPAN, (Math.random() * 2 ** 32) >>> 0);
      if (phys.simulate(l).made) made++;
    }
    row.push(`${c}:${Math.round((100 * made) / N)}`);
  }
  console.log(`d=${d}`.padEnd(7), row.join("  "));
}
