// Node checks for the matchup-preview math (no test suite in this repo).
// Run from backend/: npx tsx src/scripts/check-matchup-preview.ts
import assert from "node:assert/strict";
import {
  athensDayDiff,
  buildEdges,
  buildH2H,
  buildTeamForm,
  pickKeyBattle,
  ratio,
  restDays,
  toStrip,
  type FinalGameRow,
  type PlayerAvg,
  type TeamRef,
  type TeamStatLine,
} from "../services/matchupPreview/core.js";

function check(name: string, fn: () => void) {
  fn();
  console.log("ok", name);
}

const team = (id: string): TeamRef => ({ id, code: id, name: `Team ${id}`, primaryColor: null, logoUrl: null });
const teamsById = new Map(["A", "B", "C", "D"].map((id) => [id, team(id)]));

let seq = 0;
// A game for `teamId` against `opp` on day `day` (Oct 2026), won or lost.
function g(teamId: string, opp: string, day: number, won: boolean, home = true): FinalGameRow {
  const [hs, as] = won === home ? [90, 80] : [80, 90];
  return {
    id: `g${++seq}`,
    season: "2026-27",
    tipoffAt: new Date(Date.UTC(2026, 9, day, 18, 0)),
    homeTeamId: home ? teamId : opp,
    awayTeamId: home ? opp : teamId,
    homeScore: hs,
    awayScore: as,
  };
}

check("form newest-first + streak", () => {
  const results = [true, true, false, true, true, true, false]; // oldest -> newest
  const games = results.map((w, i) => g("A", i % 2 ? "B" : "C", i + 1, w, i % 2 === 0));
  const form = buildTeamForm("A", games, teamsById);
  assert.equal(form.games.length, 5);
  assert.equal(form.games[0].won, false);
  assert.equal(form.games[0].tipoffAt, games[6].tipoffAt.toISOString());
  assert.equal(form.games[0].opponent.id, "C");
  assert.equal(form.streak, "L1");
  assert.equal(buildTeamForm("A", games.slice(0, 6), teamsById).streak, "W3");
});

check("streak empty", () => {
  assert.deepEqual(buildTeamForm("A", [], teamsById), { games: [], streak: null });
});

check("h2h perspective", () => {
  const meetings = [g("A", "B", 1, true, true), g("B", "A", 5, true, true), g("A", "B", 9, true, false)];
  const unrelated = [g("A", "C", 3, true), g("B", "D", 4, false)];
  const h2h = buildH2H("B", "A", [...meetings, ...unrelated]);
  assert.equal(h2h.games.length, 3);
  assert.equal(h2h.homeWins, 1);
  assert.equal(h2h.awayWins, 2);
  assert.equal(h2h.games[0].tipoffAt, meetings[2].tipoffAt.toISOString()); // newest first
});

check("rest days Athens", () => {
  assert.equal(athensDayDiff(new Date("2026-10-07T18:45:00Z"), new Date("2026-10-09T15:00:00Z")), 2);
  assert.equal(athensDayDiff(new Date("2026-10-07T21:30:00Z"), new Date("2026-10-09T15:00:00Z")), 1); // 00:30 Oct 8 Athens
  assert.equal(athensDayDiff(new Date("2026-10-24T20:00:00Z"), new Date("2026-10-26T17:00:00Z")), 2); // across DST end
  const prev: FinalGameRow = { ...g("A", "B", 7, true), tipoffAt: new Date("2026-10-07T18:45:00Z") };
  assert.equal(restDays("A", [prev], new Date("2026-10-09T15:00:00Z")), 2);
  assert.equal(restDays("A", [], new Date("2026-10-09T15:00:00Z")), null);
  // Games at or after this tipoff don't count as "previous".
  assert.equal(restDays("A", [{ ...prev, tipoffAt: new Date("2026-10-10T18:00:00Z") }], new Date("2026-10-09T15:00:00Z")), null);
});

const line = (o: Partial<TeamStatLine>): TeamStatLine => ({
  offRating: null, defRating: null, threePct: null, rebPg: null, astPg: null, tovPg: null, ...o,
});

check("edges direction", () => {
  const edges = buildEdges(line({ defRating: 105, tovPg: 12, offRating: 115 }), line({ defRating: 110, tovPg: 12 }));
  assert.deepEqual(edges.map((e) => e.key), ["offRating", "defRating", "threePct", "rebPg", "astPg", "tovPg"]);
  assert.equal(edges.find((e) => e.key === "defRating")!.better, "home");
  assert.equal(edges.find((e) => e.key === "tovPg")!.better, "even");
  assert.equal(edges.find((e) => e.key === "offRating")!.better, null);
  assert.equal(buildEdges(line({ rebPg: 30 }), line({ rebPg: 35 })).find((e) => e.key === "rebPg")!.better, "away");
});

check("edges with nulls", () => {
  const edges = buildEdges(line({}), line({}));
  assert.equal(edges.length, 6);
  assert.ok(edges.every((e) => e.better === null));
  assert.ok(!JSON.stringify(edges).includes("NaN"));
});

check("ratio guards", () => {
  assert.equal(ratio(3, 0), null);
  assert.equal(ratio(1, 4), 0.25);
});

const p = (id: string, teamId: string, position: string, pir: number, extra: Partial<PlayerAvg> = {}): PlayerAvg => ({
  playerId: id, name: id, photoUrl: null, position, games: 4, pts: 10, reb: 5, ast: 3, pir, teamId, injuryStatus: null, ...extra,
});

check("key battle", () => {
  const players = [
    p("ag", "A", "Guard", 18), p("bg", "B", "Guard", 15),
    p("ac", "A", "Center", 20), p("ac2", "A", "Center", 12), p("bc", "B", "Center", 19),
    p("af", "A", "Forward", 25), p("bf1", "B", "Forward", 30, { games: 1 }),
  ];
  const kb = pickKeyBattle("A", "B", players)!;
  assert.equal(kb.position, "Center");
  assert.equal(kb.home.playerId, "ac");
  assert.equal(kb.away.playerId, "bc");
  // A's best center is out -> next-best A center (12+19=31 < Guard 33) -> Guard wins.
  const out = players.map((x) => (x.playerId === "ac" ? { ...x, injuryStatus: "out" as const } : x));
  assert.equal(pickKeyBattle("A", "B", out)!.position, "Guard");
  assert.equal(pickKeyBattle("A", "B", [p("ag", "A", "Guard", 18)]), null);
});

check("strip", () => {
  const games = [g("A", "B", 1, true), g("A", "C", 2, false), g("A", "D", 3, true)];
  const form = buildTeamForm("A", games, teamsById);
  const strip = toStrip({ home: form, away: { games: [], streak: null } }, { homeWins: 0, awayWins: 0, games: [] }, { home: 2, away: 0 });
  assert.deepEqual(strip.home.form, ["W", "L", "W"]);
  assert.deepEqual(strip.away.form, []);
  assert.equal(strip.home.injuries, 2);
  assert.equal(strip.h2h, null);
  assert.deepEqual(toStrip({ home: form, away: form }, { homeWins: 3, awayWins: 1, games: [1] }, { home: 0, away: 0 }).h2h, { homeWins: 3, awayWins: 1 });
});

console.log("all matchup-preview checks passed");
