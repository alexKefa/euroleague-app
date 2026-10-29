// Run: npx tsx --test src/services/duelEngine.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_SCALES,
  DUEL_CATEGORIES,
  rarityMult,
  formFor,
  categoryValue,
  quarterScore,
  drawCategories,
  weakestRemaining,
  benchSlot,
  validateLineup,
  eloDeltas,
  kFactor,
  divisionFor,
  seasonKey,
  softReset,
  prizeEligible,
  type BaseLine,
  type DuelCard,
} from "./duelEngine.js";

const r2 = (x: number) => Math.round(x * 100) / 100;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const zero: BaseLine = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, pir: 0 };
const mkCard = (pts: number, over: Partial<DuelCard> = {}): DuelCard => ({
  collectibleId: `c${pts}`,
  name: "P",
  teamId: "t",
  imageUrl: null,
  tier: "common",
  isMvp: false,
  isFoil: false,
  base: { ...zero, pts },
  rarityMult: 1,
  formMult: 1,
  formBadge: null,
  injury: null,
  injuryMult: 1,
  ...over,
});

test("rarityMult", () => {
  assert.equal(r2(rarityMult("common", false, false)), 1);
  assert.equal(r2(rarityMult("rare", false, false)), 1.1);
  assert.equal(r2(rarityMult("legendary", false, false)), 1.2);
  assert.equal(r2(rarityMult("legendary", true, false)), 1.3);
  assert.equal(r2(rarityMult("legendary", false, true)), 1.3);
  assert.equal(r2(rarityMult("legendary", true, true)), 1.4);
});

test("formFor", () => {
  assert.deepEqual(formFor(12, 17, 5), { badge: "on_fire", mult: 1.15 });
  assert.deepEqual(formFor(12, 16.9, 5), { badge: "hot", mult: 1.08 });
  assert.equal(formFor(12, 14, 5).badge, "hot");
  assert.deepEqual(formFor(12, 13.9, 5), { badge: "steady", mult: 1 });
  assert.deepEqual(formFor(12, 10, 5), { badge: "cold", mult: 0.93 });
  assert.equal(formFor(12, 7.1, 5).badge, "cold");
  assert.deepEqual(formFor(12, 7, 5), { badge: "ice_cold", mult: 0.85 });
  assert.deepEqual(formFor(12, 30, 2), { badge: null, mult: 1 });
  assert.deepEqual(formFor(0, null, 0), { badge: null, mult: 1 });
});

test("scores", () => {
  const card = mkCard(18, { formMult: 1.15, base: { ...zero, pts: 18, stl: 1.2, blk: 0.8 } });
  assert.equal(quarterScore(card, "scoring"), Math.round(18 * CATEGORY_SCALES.scoring * 1.15 * 10) / 10);
  assert.equal(categoryValue(card.base, "defense"), 2);
  for (const c of DUEL_CATEGORIES) assert.equal(quarterScore(mkCard(0), c), 0);
});

test("drawCategories", () => {
  for (let s = 1; s <= 200; s++) {
    const d = drawCategories(mulberry32(s));
    assert.equal(d.length, 4);
    assert.equal(new Set(d).size, 4);
    for (const c of d) assert.ok(DUEL_CATEGORIES.includes(c));
  }
});

test("weakestRemaining and benchSlot", () => {
  const lineup = [mkCard(10), mkCard(5), mkCard(20), mkCard(7), mkCard(9)];
  assert.equal(weakestRemaining(lineup, [0, 2], "scoring"), 1);
  const tied = [mkCard(10), mkCard(5), mkCard(5), mkCard(5), mkCard(9)];
  assert.equal(weakestRemaining(tied, [0], "scoring"), 1);
  assert.equal(benchSlot([0, 1, 2, 3]), 4);
});

test("validateLineup", () => {
  const k = (n: number) => ({ playerKey: `p${n}`, tier: "common" });
  assert.equal(validateLineup([1, 2, 3, 4, 5].map(k)), null);
  assert.equal(validateLineup([1, 2, 3, 4].map(k)), "INVALID_LINEUP");
  assert.equal(validateLineup([1, 2, 3, 4, 4].map(k)), "INVALID_LINEUP");
  assert.equal(validateLineup([...[1, 2, 3, 4].map(k), { playerKey: "c", tier: "coach" }]), "INVALID_LINEUP");
});

test("elo and K", () => {
  assert.deepEqual(eloDeltas(1000, 1000, 1, 32, 32), { a: 16, b: -16 });
  assert.deepEqual(eloDeltas(1200, 1000, 1, 32, 20), { a: 8, b: -5 });
  assert.deepEqual(eloDeltas(1000, 1000, 0.5, 32, 32), { a: 0, b: 0 });
  assert.equal(kFactor(9, 0), 32);
  assert.equal(kFactor(10, 0), 20);
  assert.equal(kFactor(10, 3), 10);
  assert.equal(kFactor(5, 3), 16);
});

test("divisions, seasons, soft reset", () => {
  assert.equal(divisionFor(949), "rookie");
  assert.equal(divisionFor(950), "starter");
  assert.equal(divisionFor(1099), "starter");
  assert.equal(divisionFor(1100), "sixth_man");
  assert.equal(divisionFor(1299), "all_star");
  assert.equal(divisionFor(1300), "mvp");
  assert.equal(seasonKey(new Date("2026-10-31T22:30:00Z")), "2026-11");
  assert.equal(seasonKey(new Date("2026-10-31T21:30:00Z")), "2026-10");
  assert.equal(softReset(null), 1000);
  assert.equal(softReset(1200), 1100);
  assert.equal(softReset(901), 951);
});

test("prizeEligible", () => {
  assert.equal(prizeEligible({ result: "win", paidWinsToday: 4, paidVsOpponentToday: 0 }), true);
  assert.equal(prizeEligible({ result: "win", paidWinsToday: 5, paidVsOpponentToday: 0 }), false);
  assert.equal(prizeEligible({ result: "win", paidWinsToday: 0, paidVsOpponentToday: 1 }), false);
  assert.equal(prizeEligible({ result: "draw", paidWinsToday: 0, paidVsOpponentToday: 0 }), false);
});
