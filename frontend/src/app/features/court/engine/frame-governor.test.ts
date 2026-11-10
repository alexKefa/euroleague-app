// Run: (backend) npm run test:court
import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameGovernor } from "./frame-governor";

/** Feed `seconds` of frames at `fps`; returns every pixel ratio change. */
function run(g: FrameGovernor, start: number, seconds: number, fps: number): { t: number; changes: number[] } {
  const changes: number[] = [];
  const dt = 1000 / fps;
  let t = start;
  for (let i = 0; i < seconds * fps; i++) {
    t += dt;
    const next = g.frame(t, dt);
    if (next !== null) changes.push(next);
  }
  return { t, changes };
}

test("governor: a smooth 60 fps never changes quality", () => {
  const g = new FrameGovernor(2, 1);
  assert.deepEqual(run(g, 0, 30, 60).changes, []);
  assert.equal(g.stats().dpr, 2);
});

test("governor: sustained slow frames lower the pixel ratio by one step", () => {
  const g = new FrameGovernor(2, 1);
  const { changes } = run(g, 0, 10, 30);
  assert.equal(changes[0], 1.75);
});

test("governor: slow frames during the first 3 s (shader compile) are ignored", () => {
  const g = new FrameGovernor(2, 1);
  const { changes } = run(g, 0, 3, 20);
  assert.deepEqual(changes, []);
});

test("governor: a tab switch (one huge frame) is not a slow window", () => {
  const g = new FrameGovernor(2, 1);
  let { t } = run(g, 0, 5, 60);
  assert.equal(g.frame(t + 5000, 5000), null);
  t += 5000;
  assert.deepEqual(run(g, t, 10, 60).changes, []);
});

test("governor: never goes below the floor", () => {
  const g = new FrameGovernor(1.5, 1);
  // Every drop helps (+8 fps right away) but the phone stays slow.
  let fps = 20;
  let t = 0;
  const all: number[] = [];
  for (let i = 0; i < 4000; i++) {
    const dt = 1000 / fps;
    t += dt;
    const next = g.frame(t, dt);
    if (next !== null) {
      all.push(next);
      fps += 8;
    }
  }
  assert.deepEqual(all, [1.25, 1]);
  assert.equal(g.stats().dpr, 1);
});

test("governor: a drop that didn't help (30 Hz cap) is undone and the governor stops", () => {
  const g = new FrameGovernor(2, 1);
  const r = run(g, 0, 30, 30); // capped at 30 no matter the resolution
  assert.deepEqual(r.changes, [1.75, 2]);
  assert.equal(g.stats().dpr, 2);
  assert.deepEqual(run(g, r.t, 20, 30).changes, []);
});

test("governor: stats report fps and the 1% low", () => {
  const g = new FrameGovernor(2, 1);
  let t = 0;
  for (let i = 0; i < 600; i++) {
    const dt = i % 100 === 0 ? 50 : 1000 / 60; // a 50 ms hitch every 100 frames
    t += dt;
    g.frame(t, dt);
  }
  const s = g.stats();
  assert.ok(s.fps > 50 && s.fps < 61, `fps ${s.fps}`);
  assert.ok(s.low1 <= 21, `1% low ${s.low1}`);
});
