// Node checks for the lineup builder's input handling (no test suite in this repo).
// Run from backend/: npx tsx src/scripts/check-lineup-builder.ts
import assert from "node:assert/strict";
import { normalizePlayerCodes } from "../services/lineupBuilder.js";

function check(name: string, fn: () => void) {
  fn();
  console.log("ok", name);
}

check("codes sort + dedupe", () => {
  assert.deepEqual(normalizePlayerCodes(" 2 , 1 "), ["1", "2"]);
  assert.deepEqual(normalizePlayerCodes("1,1,2"), ["1", "2"]);
  assert.deepEqual(normalizePlayerCodes("011212,P1"), ["011212", "P1"]);
  assert.deepEqual(normalizePlayerCodes("5,4,3,2,1"), ["1", "2", "3", "4", "5"]);
});

check("codes reject", () => {
  for (const bad of [undefined, "", "1", "1,1", "1,2,3,4,5,6", "1,,2", "1,2;3", "1,a b"]) {
    assert.equal(normalizePlayerCodes(bad), null, String(bad));
  }
});

console.log("all lineup-builder checks passed");
