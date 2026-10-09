// Node checks for game story cards (no test suite in this repo).
// Run from backend/: npx tsx src/scripts/check-game-story.ts
import assert from "node:assert/strict";
import {
  evaluateBench,
  evaluateClutch,
  evaluateComeback,
  evaluateExplosion,
  evaluateLineup,
  lineupTypeRows,
  pickStory,
} from "../services/gameStory/angles.js";
import type { GameFacts, LineFacts, StintFacts } from "../services/gameStory/types.js";

function check(name: string, fn: () => void) {
  fn();
  console.log("ok", name);
}

const HOME = "home-id";
const AWAY = "away-id";

function line(teamId: string, code: string, points: number, extra: Partial<LineFacts> = {}): LineFacts {
  return {
    playerCode: code, name: `Player ${code}`, teamId, isStarter: false, points, rebounds: 3, offRebounds: 1, assists: 2,
    steals: 1, blocks: 0, pir: Math.round(points * 1.1), plusMinus: 0, minutes: 20, fg2m: 2, fg2a: 4, fg3m: 1, fg3a: 3,
    ftm: 1, fta: 2, prevHighPoints: 40, prevHighPir: 45, last5Points: [8, 9, 10, 11, 12], ...extra,
  };
}

// Home wins 80-70. 5 starters x 8 = 40, bench 4 x 10 = 40 (share 50%).
function baseFacts(over: Partial<GameFacts> = {}): GameFacts {
  const homeStarters = [1, 2, 3, 4, 5].map((i) => line(HOME, `h${i}`, 8, { isStarter: true }));
  const homeBench = [6, 7, 8, 9].map((i) => line(HOME, `h${i}`, 10));
  const away = [1, 2, 3, 4, 5, 6, 7].map((i) => line(AWAY, `a${i}`, 10, { isStarter: i <= 5 }));
  return {
    gameId: "game-1", season: "2026-27", round: 4, tipoffAt: "2026-10-08T18:00:00.000Z",
    home: { id: HOME, code: "PAN", name: "Panathinaikos", primaryColor: "#007A3D", secondaryColor: "#FFFFFF", logoUrl: null, score: 80 },
    away: { id: AWAY, code: "FEN", name: "Fenerbahce", primaryColor: "#002D72", secondaryColor: "#FFD200", logoUrl: null, score: 70 },
    overtime: false,
    lines: [...homeStarters, ...homeBench, ...away],
    stints: [],
    margins: [],
    clutchPoints: [],
    clutchPlays: [],
    ...over,
  };
}

const stint = (teamId: string, codes: string[], seconds: number, ptsFor: number, ptsAgainst: number): StintFacts => ({
  teamId, playerCodes: [...codes].sort(), seconds, ptsFor, ptsAgainst, possFor: seconds / 30, possAgainst: seconds / 30,
});

check("bench triggers at 35", () => {
  const lowShare = (benchEach: number) =>
    baseFacts({
      lines: [
        ...[1, 2, 3, 4, 5].map((i) => line(HOME, `h${i}`, 20, { isStarter: true })), // starters 100 -> share low
        ...[6, 7, 8, 9, 10].map((i) => line(HOME, `h${i}`, benchEach)),
        line(AWAY, "a1", 10, { isStarter: true }),
      ],
      home: { ...baseFacts().home, score: 100 + benchEach * 5 },
    });
  assert.equal(evaluateBench(lowShare(6.8)), null); // 34 pts, share 34/134 < 45%
  const s = evaluateBench(lowShare(7)); // 35 pts
  assert.ok(s);
  assert.equal(s!.score, 1);
});

check("bench share rule", () => {
  const s = evaluateBench(baseFacts()); // 40 bench of 80 = 50%; points 40 >= 35 too -> max ratio
  assert.ok(s);
  assert.equal(Math.round(s!.score * 1000) / 1000, Math.round(Math.max(40 / 35, 0.5 / 0.45) * 1000) / 1000);
});

check("lineup needs 360s and +10", () => {
  const five = ["h1", "h2", "h3", "h4", "h6"];
  assert.equal(evaluateLineup(baseFacts({ stints: [stint(HOME, five, 300, 20, 8)] })), null);
  const s = evaluateLineup(baseFacts({ stints: [stint(HOME, five, 400, 20, 8)] }));
  assert.ok(s);
  assert.equal(s!.score, 1.2);
  // Sums repeated stints of the same five.
  const t = evaluateLineup(baseFacts({ stints: [stint(HOME, five, 200, 10, 4), stint(HOME, [...five].reverse(), 200, 10, 4)] }));
  assert.ok(t);
  assert.equal(t!.score, 1.2);
});

check("lineupTypeRows buckets by starters on court", () => {
  const f = baseFacts({
    stints: [
      stint(HOME, ["h6", "h7", "h8", "h9", "h1"], 600, 20, 10), // 1 starter
      stint(HOME, ["h1", "h2", "h6", "h7", "h8"], 300, 5, 9), // 2 starters
      stint(HOME, ["h1", "h2", "h3", "h4", "h5"], 900, 15, 14), // 5 starters
    ],
  });
  const rows = lineupTypeRows(f, HOME);
  assert.deepEqual(rows.map((r) => [r.label, r.seconds, r.ptsFor, r.ptsAgainst]), [
    ["0-1", 600, 20, 10],
    ["2-3", 300, 5, 9],
    ["4-5", 900, 15, 14],
  ]);
});

check("explosion uses larger ratio", () => {
  const pts = evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 30, { pir: 20, isStarter: true })] }));
  assert.ok(pts);
  assert.equal((pts!.data as { stat: string }).stat, "points");
  const pir = evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 20, { pir: 40, isStarter: true })] }));
  assert.ok(pir);
  assert.equal((pir!.data as { stat: string }).stat, "pir");
  assert.equal(evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 27, { pir: 31 })] })), null);
});

check("career high only above previous", () => {
  const at = evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 30, { pir: 10, prevHighPoints: 30 })] }));
  assert.equal((at!.data as { careerHigh: boolean }).careerHigh, false);
  const above = evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 31, { pir: 10, prevHighPoints: 30 })] }));
  assert.equal((above!.data as { careerHigh: boolean }).careerHigh, true);
  const none = evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 31, { pir: 10, prevHighPoints: null })] }));
  assert.equal((none!.data as { careerHigh: boolean }).careerHigh, false); // no history -> no claim
});

check("comeback from margins", () => {
  const margins = [{ t: 0, margin: 0 }, { t: 600, margin: -14 }, { t: 2400, margin: 10 }];
  const s = evaluateComeback(baseFacts({ margins }));
  assert.ok(s);
  assert.equal(s!.score, 14 / 12);
  assert.equal((s!.data as { deficit: number }).deficit, 14);
  assert.equal(evaluateComeback(baseFacts({ margins: [{ t: 0, margin: -11 }] })), null);
  // Away winner: deficit is a positive home margin.
  const away = baseFacts({ home: { ...baseFacts().home, score: 70 }, away: { ...baseFacts().away, score: 80 }, margins: [{ t: 5, margin: 13 }] });
  assert.equal((evaluateComeback(away)!.data as { deficit: number }).deficit, 13);
});

check("clutch margin or OT", () => {
  const close = (margin: number, ot = false) =>
    baseFacts({ home: { ...baseFacts().home, score: 70 + margin }, away: { ...baseFacts().away, score: 70 }, overtime: ot });
  assert.equal(evaluateClutch(close(2))!.score, 1.5);
  assert.equal(evaluateClutch(close(5)), null);
  assert.ok(evaluateClutch(close(5, true)));
  assert.equal(evaluateClutch(close(2, true))!.score, 2.5);
});

check("highest score wins, ties by table order", () => {
  // Bench (score ~1.14) vs comeback 14/12 (~1.17) -> comeback.
  const f = baseFacts({ margins: [{ t: 1, margin: -14 }] });
  assert.equal(pickStory(f).angle, "comeback");
  // Equal scores: bench 35/35=1 and comeback 12/12=1 -> bench first in table order.
  const tie = baseFacts({
    lines: [...[1, 2, 3, 4, 5].map((i) => line(HOME, `h${i}`, 20, { isStarter: true })), ...[6, 7, 8, 9, 10].map((i) => line(HOME, `h${i}`, 7))],
    home: { ...baseFacts().home, score: 135 },
    margins: [{ t: 1, margin: -12 }],
  });
  assert.equal(pickStory(tie).angle, "bench");
});

check("fallback when nothing qualifies", () => {
  const f = baseFacts({ lines: [line(HOME, "h1", 10, { isStarter: true }), line(AWAY, "a1", 9, { isStarter: true })] });
  const s = pickStory(f);
  assert.equal(s.angle, "numbers");
  assert.equal(s.score, 0);
});

check("missing data skips angles", () => {
  const noFlags = baseFacts();
  noFlags.lines = noFlags.lines.map((l) => ({ ...l, isStarter: null }));
  assert.equal(evaluateBench(noFlags), null);
  assert.equal(evaluateLineup(baseFacts({ stints: [] })), null);
  assert.equal(evaluateComeback(baseFacts({ margins: [] })), null);
  assert.ok(pickStory(noFlags)); // still a story
});

console.log("all game-story checks passed");
