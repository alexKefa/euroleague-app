import { test } from "node:test";
import assert from "node:assert/strict";
import { endedQuarter, finalBody, finalTitle, quarterBody, quarterScore, quarterTitle, startTitle, surname, topScorer, type PlayerPoints } from "./gameBell.js";

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

test("each side's top scorer is by game total so far, not by the quarter", () => {
  const now = [p("v", "OLY", "VEZENKOV, SASHA", 14), p("f", "OLY", "FOURNIER, EVAN", 11), p("n", "PAO", "NUNN, KENDRICK", 0)];
  assert.deepEqual(topScorer(now, "OLY"), { name: "Vezenkov", points: 14 });
  assert.equal(topScorer(now, "PAO"), null, "nobody on the team has scored");
});

const leaders = { home: { name: "Vezenkov", points: 17 }, away: { name: "Nunn", points: 15 } };

const score = { HOME: "OLY", AWAY: "PAO", hs: 45, as: 40 };

test("quarter pushes: the moment and the total in the title, the quarter's scorers below", () => {
  assert.equal(quarterTitle(2, score, "en"), "🏀 Halftime · OLY 45–40 PAO");
  assert.equal(quarterTitle(1, score, "en"), "🏀 End of Q1 · OLY 45–40 PAO");
  assert.equal(quarterTitle(3, score, "el"), "🏀 Τέλος 3ης περιόδου · OLY 45–40 PAO");
  assert.equal(quarterTitle(2, score, "el"), "🏀 Ημίχρονο · OLY 45–40 PAO");
  assert.equal(quarterBody(leaders, "en"), "Vezenkov 17 pts, Nunn 15 pts.");
  assert.equal(quarterBody(leaders, "el"), "Vezenkov 17 πόντοι, Nunn 15 πόντοι.");
  assert.equal(quarterBody({ home: null, away: null }, "el"), "");
});

test("start and final open with the basketball too", () => {
  assert.equal(startTitle(score), "🏀 OLY – PAO");
  assert.equal(finalTitle({ ...score, hs: 81, as: 77 }, "en"), "🏀 Final · OLY 81–77 PAO");
  assert.equal(finalTitle({ ...score, hs: 81, as: 77 }, "el"), "🏀 Τελικό · OLY 81–77 PAO");
  assert.equal(finalBody({ home: { name: "Vezenkov", points: 24 }, away: { name: "Nunn", points: 21 } }, "en"), "Vezenkov 24 pts, Nunn 21 pts.");
  assert.equal(finalBody({ home: null, away: null }, "el"), "");
});
