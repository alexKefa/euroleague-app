import { test } from "node:test";
import assert from "node:assert/strict";
import { endedQuarter, finalBody, forgetGame, quarterBody, quarterLeaders, quarterScore, surname, topScorer, type PlayerPoints } from "./gameBell.js";

const live = (quarter: number, clock: number | null) => ({ status: "live", quarter, gameClockSeconds: clock });

test("a quarter ends at 0:00, or once the next one has begun", () => {
  assert.equal(endedQuarter(live(1, 312)), null);
  assert.equal(endedQuarter(live(1, 0)), 1);
  assert.equal(endedQuarter(live(2, 600)), 1);
  assert.equal(endedQuarter(live(2, 0)), 2);
  assert.equal(endedQuarter(live(3, 0)), 3);
});

test("the fourth quarter and overtime are left to the close and final pushes", () => {
  assert.equal(endedQuarter(live(4, 0)), null);
  assert.equal(endedQuarter(live(4, 420)), 3);
  assert.equal(endedQuarter(live(5, 0)), null);
  assert.equal(endedQuarter({ status: "scheduled", quarter: 1, gameClockSeconds: 0 }), null);
  assert.equal(endedQuarter({ status: "final", quarter: 2, gameClockSeconds: 0 }), null);
});

test("a quarter's score comes from the per-quarter breakdown, not the live total", () => {
  const g = { ...live(3, 590), homeQuarters: [22, 23, 2], awayQuarters: [18, 22, 0] };
  assert.deepEqual(quarterScore(g, 2), { home: 23, away: 22, homeTotal: 45, awayTotal: 40 });
  assert.equal(quarterScore({ ...g, homeQuarters: [22] }, 2), null);
});

test("names are surnames in title case", () => {
  assert.equal(surname("VEZENKOV, SASHA"), "Vezenkov");
  assert.equal(surname("DE COLO, NANDO"), "De Colo");
  assert.equal(surname("Kendrick Nunn"), "Nunn");
});

const p = (playerId: string, teamId: string, playerName: string, points: number): PlayerPoints => ({ playerId, teamId, playerName, points });

test("the quarter's top scorer is who gained most since the last quarter ended", () => {
  const before = new Map([
    ["v", 10],
    ["f", 2],
  ]);
  const now = [p("v", "OLY", "VEZENKOV, SASHA", 14), p("f", "OLY", "FOURNIER, EVAN", 11), p("n", "PAO", "NUNN, KENDRICK", 0)];
  assert.deepEqual(topScorer(now, "OLY", before), { name: "Fournier", points: 9 });
  assert.equal(topScorer(now, "PAO", before), null);
});

test("quarter leaders build on the previous quarter's snapshot, and fall back to the game so far without it", () => {
  forgetGame("g1");
  const q1 = [p("v", "OLY", "VEZENKOV, SASHA", 9), p("n", "PAO", "NUNN, KENDRICK", 7)];
  assert.deepEqual(quarterLeaders("g1", 1, q1, "OLY", "PAO"), { home: { name: "Vezenkov", points: 9 }, away: { name: "Nunn", points: 7 }, sinceTipoff: false });
  const q2 = [p("v", "OLY", "VEZENKOV, SASHA", 12), p("f", "OLY", "FOURNIER, EVAN", 6), p("n", "PAO", "NUNN, KENDRICK", 15)];
  assert.deepEqual(quarterLeaders("g1", 2, q2, "OLY", "PAO"), { home: { name: "Fournier", points: 6 }, away: { name: "Nunn", points: 8 }, sinceTipoff: false });

  forgetGame("g2"); // as after a restart mid-game: Q2's start was never seen
  assert.deepEqual(quarterLeaders("g2", 3, q2, "OLY", "PAO"), { home: { name: "Vezenkov", points: 12 }, away: { name: "Nunn", points: 15 }, sinceTipoff: true });
});

const leaders = { home: { name: "Vezenkov", points: 9 }, away: { name: "Nunn", points: 7 }, sinceTipoff: false };

test("quarter pushes read as one short line in each language", () => {
  assert.equal(quarterBody(2, leaders, "en"), "Halftime. Vezenkov 9 pts, Nunn 7 pts.");
  assert.equal(quarterBody(1, leaders, "en"), "End of Q1. Vezenkov 9 pts, Nunn 7 pts.");
  assert.equal(quarterBody(3, { ...leaders, sinceTipoff: true }, "en"), "End of Q3. So far: Vezenkov 9 pts, Nunn 7 pts.");
  assert.equal(quarterBody(1, leaders, "el"), "Τέλος 1ης περιόδου. Vezenkov 9 πόντοι, Nunn 7 πόντοι.");
  assert.equal(quarterBody(2, { home: null, away: null, sinceTipoff: false }, "el"), "Ημίχρονο.");
});

test("the final names each side's top scorer", () => {
  assert.equal(finalBody({ home: { name: "Vezenkov", points: 24 }, away: { name: "Nunn", points: 21 } }, "en"), "Final. Vezenkov 24 pts, Nunn 21 pts.");
  assert.equal(finalBody({ home: null, away: null }, "el"), "Τελικό.");
});
