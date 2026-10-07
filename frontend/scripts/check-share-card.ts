// Node checks for the share-card stat logic (no test suite in this repo).
// Run from frontend/: ../backend/node_modules/.bin/tsx scripts/check-share-card.ts
import assert from "node:assert/strict";
import type { PlayerGameLogEntry } from "../src/app/core/models";
import {
  computeLine,
  formatValue,
  gamesForPeriod,
  opponentsFaced,
  playedGames,
  splitName,
  winner,
} from "../src/app/features/share-card/share-card.logic";

const PAO = "pao";
const team = (id: string, name = id.toUpperCase()) => ({ id, code: id.toUpperCase(), name, primaryColor: null, logoUrl: null });
let n = 0;
function row(over: { opp?: string; day: number; min?: number | null; pts?: number; reb?: number; ast?: number; tov?: number; pir?: number; m3?: number; a3?: number; m2?: number; a2?: number; ftm?: number; fta?: number }): PlayerGameLogEntry {
  n++;
  const opp = over.opp ?? "oly";
  return {
    game: { id: `g${n}`, round: n, tipoffAt: `2026-10-${String(over.day).padStart(2, "0")}T18:00:00Z`, homeScore: 80, awayScore: 70, homeTeam: team(PAO), awayTeam: team(opp) },
    stats: {
      minutes: over.min === undefined ? 30 : over.min,
      points: over.pts ?? 10, rebounds: over.reb ?? 4, assists: over.ast ?? 5, steals: 1, blocksFavour: 0,
      turnovers: over.tov ?? 2, valuation: over.pir ?? 12,
      fieldGoalsMade2: over.m2 ?? 3, fieldGoalsAttempted2: over.a2 ?? 6,
      fieldGoalsMade3: over.m3 ?? 1, fieldGoalsAttempted3: over.a3 ?? 4,
      freeThrowsMade: over.ftm ?? 1, freeThrowsAttempted: over.fta ?? 2,
    },
  } as PlayerGameLogEntry;
}
function check(name: string, fn: () => void) {
  fn();
  console.log("ok", name);
}

const rows = [
  row({ day: 1, pts: 10, opp: "oly" }),
  row({ day: 3, pts: 20, opp: "rma" }),
  row({ day: 5, pts: 30, opp: "oly" }),
  row({ day: 7, pts: 0, min: 0 }), // DNP
  row({ day: 9, pts: 12, opp: "fen" }),
  row({ day: 11, pts: 14, opp: "bar" }),
  row({ day: 13, pts: 16, opp: "mon" }),
];

check("DNP rows excluded and newest first", () => {
  const p = playedGames(rows);
  assert.equal(p.length, 6);
  assert.equal(p[0].stats.points, 16);
});

check("unknown minutes (null) still count as played when the line has stats", () => {
  const noMin = [row({ day: 1, min: null, pts: 15 }), row({ day: 2, min: null, pts: 9 })];
  assert.equal(playedGames(noMin).length, 2);
  const line = computeLine(gamesForPeriod(noMin, { kind: "season" }, PAO), false);
  assert.equal(line.values.pts, 12);
  assert.equal(line.values.min, null); // no minutes recorded -> "–", not 0.0
});

check("season average", () => {
  const line = computeLine(gamesForPeriod(rows, { kind: "season" }, PAO), false);
  assert.equal(line.games, 6);
  assert.equal(line.values.pts, (10 + 20 + 30 + 12 + 14 + 16) / 6);
  assert.equal(formatValue("pts", line.values.pts, false), "17.0");
});

check("last 5 takes the 5 newest played games", () => {
  const g = gamesForPeriod(rows, { kind: "last5" }, PAO);
  assert.equal(g.length, 5);
  assert.equal(computeLine(g, false).values.pts, (20 + 30 + 12 + 14 + 16) / 5);
});

check("last game is a single raw line", () => {
  const g = gamesForPeriod(rows, { kind: "lastGame" }, PAO);
  assert.equal(g.length, 1);
  const line = computeLine(g, true);
  assert.equal(line.single, true);
  assert.equal(formatValue("pts", line.values.pts, true), "16");
});

check("vs team filters by opponent", () => {
  const g = gamesForPeriod(rows, { kind: "vsTeam", teamId: "oly" }, PAO);
  assert.equal(g.length, 2);
  assert.equal(computeLine(g, false).values.pts, 20);
});

check("opponents faced: unique, sorted, played games only", () => {
  const o = opponentsFaced(rows, PAO);
  assert.deepEqual(o.map((t) => t.id), ["bar", "fen", "mon", "oly", "rma"]);
});

check("transferred player: own side inferred per row, not from the current team", () => {
  // Last season's log at the old club (oly), while the current team is pao.
  const old = (opp: string, day: number, home: boolean): PlayerGameLogEntry => {
    const r = row({ day, opp });
    r.game.homeTeam = team(home ? "oly" : opp);
    r.game.awayTeam = team(home ? opp : "oly");
    return r;
  };
  const log = [old("rma", 1, true), old("fen", 2, false), old("bar", 3, true), old("pao", 4, false)];
  assert.deepEqual(opponentsFaced(log, PAO).map((t) => t.id), ["bar", "fen", "pao", "rma"]);
  assert.equal(gamesForPeriod(log, { kind: "vsTeam", teamId: "pao" }, PAO).length, 1);
  assert.equal(gamesForPeriod(log, { kind: "vsTeam", teamId: "oly" }, PAO).length, 0);
});

check("percentages from totals", () => {
  const g = [row({ day: 20, m3: 1, a3: 1 }), row({ day: 21, m3: 0, a3: 3 })];
  const line = computeLine(g, false);
  assert.equal(line.values.threePct, 25);
  assert.equal(formatValue("threePct", line.values.threePct, false), "25%");
});

check("zero attempts -> dash, never NaN", () => {
  const line = computeLine([row({ day: 22, m3: 0, a3: 0 })], true);
  assert.equal(line.values.threePct, null);
  assert.equal(formatValue("threePct", null, false), "–");
});

check("empty games -> all null", () => {
  const line = computeLine([], false);
  assert.equal(line.games, 0);
  assert.equal(line.values.pts, null);
  assert.equal(formatValue("pts", null, false), "–");
});

check("winner: higher wins, TOV lower wins, ties none", () => {
  assert.equal(winner("pts", 14.2, 12.8), "a");
  assert.equal(winner("reb", 2.8, 3.1), "b");
  assert.equal(winner("tov", 2, 3), "a");
  assert.equal(winner("ast", 6, 6), null);
  assert.equal(winner("pts", null, 4), "b");
  assert.equal(winner("pts", null, null), null);
});

check("splitName", () => {
  assert.deepEqual(splitName("SLOUKAS, KOSTAS"), { first: "Kostas", last: "Sloukas" });
  assert.deepEqual(splitName("NUNN, KENDRICK"), { first: "Kendrick", last: "Nunn" });
  assert.deepEqual(splitName("LESSORT"), { first: "", last: "Lessort" });
});
