// Monte Carlo make-rate table by distance x timing error, for tuning shot.ts.
// Not part of either app. Run from the repo root after a frontend npm install:
//   backend/node_modules/.bin/tsx shared/court/tune-shots.ts [samples=300]
import RAPIER from "../../frontend/node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs";
import { CourtPhysics, RapierApi } from "./sim.js";
import { computeShotLaunch, idealVelocity, releasePoint } from "./shot.js";
import { rimCenter } from "./geometry.js";
await RAPIER.init();
const phys = new CourtPhysics(RAPIER as unknown as RapierApi);
const rim = rimCenter("A");
const N = Number(process.argv[2] ?? 300);
for (const d of [0.5, 1.5, 3, 4.6, 6, 7.2]) {
  const row: string[] = [];
  for (const e of ["clean", 0, 0.1, 0.2, 0.3, 0.45, -0.2, -0.45, 1] as const) {
    let made = 0;
    for (let i = 0; i < N; i++) {
      const ang = (Math.random() - 0.5) * 2.4;
      const x = rim.x + Math.sin(ang) * d, z = rim.z + Math.cos(ang) * d;
      let l = computeShotLaunch(x, z, "A", e === "clean" ? 0 : e, (Math.random() * 2 ** 32) >>> 0);
      if (e === "clean") { const o = releasePoint(x, z, "A"); l = { ...l, origin: o, velocity: idealVelocity(o, rim) }; }
      if (phys.simulate(l).made) made++;
    }
    row.push(`${e}:${Math.round((100 * made) / N)}`);
  }
  console.log(`d=${d}`.padEnd(7), row.join("  "));
}
