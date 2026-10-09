// Node checks for the lineup rating maths (no test suite in this repo).
// Run from frontend/: ../backend/node_modules/.bin/tsx scripts/check-lineup-math.ts
import assert from "node:assert/strict";
import { defRating, netRating, offRating, pace } from "../src/app/features/team/lineup-math";

const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} != ${b}`);

function check(name: string, fn: () => void) {
  fn();
  console.log("ok", name);
}

check("rating null on zero possessions", () => {
  assert.equal(netRating(10, 0, 5, 5), null);
  assert.equal(offRating(0, 0), null);
  assert.equal(defRating(3, 0), null);
  assert.equal(pace(0, 0, 0), null);
  assert.equal(pace(10, 10, 0), null);
});

check("net", () => {
  close(netRating(110, 100, 100, 100), 10);
  close(offRating(55, 50), 110);
  close(defRating(45, 50), 90);
});

check("pace", () => {
  close(pace(50, 50, 2400), 50); // 50 possessions in 40 minutes
  close(pace(25, 25, 1200), 50);
});

console.log("all lineup-math checks passed");
