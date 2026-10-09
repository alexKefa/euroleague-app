// Node checks for battles v5 power (no test suite in this repo).
// Run from backend/: npx tsx src/scripts/check-battle-power.ts
import assert from "node:assert/strict";
import { computeBattlePower, winProbability } from "../services/battlePower.js";

function check(name: string, fn: () => void) {
  fn();
  console.log("ok", name);
}

const base = { tier: "common", finish: "standard", seasonPir: 15, recentPir: null, recentGames: 0, injury: null } as const;

check("rarity bases", () => {
  assert.equal(computeBattlePower({ ...base, tier: "common" }).rarity, 0);
  assert.equal(computeBattlePower({ ...base, tier: "rare" }).rarity, 15);
  assert.equal(computeBattlePower({ ...base, tier: "legendary" }).rarity, 30);
  assert.equal(computeBattlePower({ ...base, tier: "legendary", finish: "foil" }).rarity, 40);
  assert.equal(computeBattlePower({ ...base, tier: "mystery" }).rarity, 0);
});

check("power = rarity + pir + form", () => {
  assert.equal(computeBattlePower({ ...base, tier: "legendary", finish: "foil" }).power, 55);
  assert.equal(computeBattlePower({ ...base, tier: "rare", seasonPir: 12.34 }).pir, 12.3);
});

check("form: halved, capped at 4, needs 3 recent games", () => {
  assert.equal(computeBattlePower({ ...base, recentPir: 19, recentGames: 5 }).form, 2); // (19-15)/2
  assert.equal(computeBattlePower({ ...base, recentPir: 35, recentGames: 5 }).form, 4); // capped
  assert.equal(computeBattlePower({ ...base, recentPir: 0, recentGames: 5 }).form, -4); // capped
  assert.equal(computeBattlePower({ ...base, recentPir: 25, recentGames: 2 }).form, 0); // too few games
  assert.equal(computeBattlePower({ ...base, recentPir: null, recentGames: 5 }).form, 0);
  assert.equal(computeBattlePower({ ...base, recentPir: 19, recentGames: 5 }).power, 17);
});

check("injury hits the PIR + form part only", () => {
  const p = computeBattlePower({ ...base, tier: "legendary", injury: "out" });
  assert.equal(p.injuryFactor, 0.75);
  assert.equal(p.power, 41.3); // 30 + 15 * 0.75 = 41.25, one decimal
  assert.equal(computeBattlePower({ ...base, injury: "probable" }).injuryFactor, 1);
});

check("power floor 1", () => {
  assert.equal(computeBattlePower({ ...base, seasonPir: -3 }).power, 1);
  assert.equal(computeBattlePower({ ...base, seasonPir: 0 }).power, 1);
});

check("win probability", () => {
  assert.equal(winProbability(55, 15), 55 / 70);
  assert.equal(winProbability(30, 30), 0.5);
  assert.equal(winProbability(1, 1), 0.5);
});
