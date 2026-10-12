// Checks the global search matcher (2026-10-12). The matcher is frontend
// code with no Angular imports, so it runs here under tsx.
// Run from backend/: npx tsx src/scripts/check-search-match.ts
// Spec: docs/superpowers/specs/2026-10-12-global-search-design.md
import assert from "node:assert/strict";
import { normalize, search, type SearchIndex } from "../../../frontend/src/app/shared/search-match.js";

const idx: SearchIndex = {
  players: [
    { id: "p1", name: "SLOUKAS, KOSTAS", teamCode: "PAN", photoUrl: null, active: true },
    { id: "p2", name: "VEZENKOV, SASHA", teamCode: "OLY", photoUrl: null, active: true },
    { id: "p3", name: "PAPAPETROU, IOANNIS", teamCode: "PAN", photoUrl: null, active: true },
  ],
  teams: [
    { id: "t1", code: "PAN", name: "Panathinaikos AKTOR Athens", logoUrl: null },
    { id: "t2", code: "OLY", name: "Olympiacos Piraeus", logoUrl: null },
  ],
  referees: [{ id: "r1", name: "LAMONICA, ROBERT" }],
  games: [
    {
      id: "g1", season: "2026-27", round: 4, tipoffAt: "2026-10-08T18:15:00.000Z", status: "final",
      home: { code: "PAN", name: "Panathinaikos AKTOR Athens" }, away: { code: "ULK", name: "Fenerbahce Beko Istanbul" },
      homeScore: 92, awayScore: 74,
    },
  ],
};

// 40 players whose names start with A, to check the limits.
const bigIdx: SearchIndex = {
  ...idx,
  players: Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, name: `ANDERSON${i}, ADAM`, teamCode: "BAS", photoUrl: null, active: true })),
  teams: Array.from({ length: 10 }, (_, i) => ({ id: `ta${i}`, code: `A${i}`, name: `Alpha ${i}`, logoUrl: null })),
};

const now = new Date("2026-10-12T12:00:00Z");

assert.equal(normalize("Σλούκας"), "sloukas");
assert.equal(normalize("Παπαπέτρου"), "papapetrou");
assert.equal(normalize("ÉLAN Chalon"), "elan chalon");

assert.ok(search(idx, "Σλούκας", now).some((r) => r.title === "Kostas Sloukas"), "Greek surname");
assert.ok(search(idx, "βεζένκοφ", now).some((r) => r.title === "Sasha Vezenkov"), "Greek with v/f fold");
assert.ok(search(idx, "vezenkov", now).some((r) => r.title === "Sasha Vezenkov"), "Latin");
assert.ok(search(idx, "ΠΑΠΑΠΕΤΡΟΥ", now).some((r) => r.title === "Ioannis Papapetrou"), "Greek capitals");
const game = search(idx, "pan ulk", now);
assert.equal(game[0]?.kind, "game", "matchup query should put the game first");
assert.deepEqual(game[0].route, ["/games", "g1"]);
assert.ok(search(idx, "kos slou", now).some((r) => r.title === "Kostas Sloukas"), "every word prefix-matches");
assert.equal(search(idx, "kos zzz", now).filter((r) => r.kind === "player").length, 0, "a non-matching word excludes");
assert.ok(search(idx, "lamon", now).some((r) => r.kind === "referee" && r.route[0] === "/referees"));
assert.ok(search(idx, "olympiacos", now).some((r) => r.kind === "team"));
assert.deepEqual(search(idx, "", now), []);
assert.deepEqual(search(idx, "   ", now), []);

const many = search(bigIdx, "a", now);
assert.ok(many.length <= 12, `too many results: ${many.length}`);
assert.ok(many.filter((r) => r.kind === "player").length <= 5, "more than 5 players");
assert.ok(many.filter((r) => r.kind === "team").length <= 5, "more than 5 teams");

console.log("all search-match checks passed");
