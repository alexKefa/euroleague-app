// Node checks for the dashboard's pure round-status logic (no test suite in
// this repo). Run from frontend/: ../backend/node_modules/.bin/tsx scripts/check-round-status.ts
import assert from "node:assert/strict";
import type { Game, Schedule } from "../src/app/core/models";
import {
  buildRoundStatus,
  countdownTone,
  formatCountdown,
  type RoundStatusInput,
} from "../src/app/features/dashboard/round-status.logic";

const now = Date.parse("2026-10-09T15:00:00Z");
const g = (id: string, tipoffAt: string, status = "scheduled") => ({ id, tipoffAt, status }) as unknown as Game;
const sched = (games: Game[], round = 3): Schedule => ({ season: "2026-27", round, games });
const base = (over: Partial<RoundStatusInput>): RoundStatusInput => ({
  schedule: sched([]),
  predictedGameIds: new Set(),
  topScorerGameIds: null,
  fantasy: null,
  spin: null,
  everPicked: true,
  ...over,
});
function check(name: string, fn: () => void) {
  fn();
  console.log("ok", name);
}

const ten = Array.from({ length: 10 }, (_, i) => g(`g${i}`, "2026-10-09T18:15:00Z"));

check("empty round", () => {
  const s = buildRoundStatus(base({ topScorerGameIds: new Set() }), now);
  assert.equal(s.phase, "between");
  assert.deepEqual(s.rows, []);
  assert.equal(s.nextDeadline, null);
});

check("picks open", () => {
  const s = buildRoundStatus(base({ schedule: sched(ten), predictedGameIds: new Set(["g0", "g1", "g2"]) }), now);
  const picks = s.rows.find((r) => r.id === "picks")!;
  assert.equal(picks.done, false);
  assert.deepEqual(picks.count, { done: 3, total: 10 });
  assert.equal(picks.deadline?.toISOString(), "2026-10-09T18:15:00.000Z");
  assert.equal(picks.link, "/predictions");
  assert.equal(s.phase, "open");
  assert.equal(s.nextDeadline?.kind, "picks");
});

check("past tipoff with scheduled status counts as started", () => {
  const games = [g("late", "2026-10-09T14:00:00Z"), g("fut", "2026-10-09T18:15:00Z")];
  const s = buildRoundStatus(base({ schedule: sched(games), predictedGameIds: new Set(["fut"]) }), now);
  assert.equal(s.rows.find((r) => r.id === "picks")!.done, true);
});

check("all started -> between", () => {
  const games = [g("a", "2026-10-09T12:00:00Z", "final"), g("b", "2026-10-09T18:00:00Z", "live")];
  const s = buildRoundStatus(base({ schedule: sched(games) }), now);
  assert.equal(s.phase, "between");
  assert.deepEqual(s.rows, []);
});

const fantasy = (over: object) => ({ round: 3, hasSquad: true, lockAt: "2026-10-09T17:00:00Z", fullTimeoutAvailable: false, carriedOver: false, ...over });

check("fantasy row hidden when lineup round differs", () => {
  const s = buildRoundStatus(base({ schedule: sched(ten), fantasy: fantasy({ round: 2 }) }), now);
  assert.equal(s.rows.some((r) => r.id === "fantasy"), false);
});

check("fantasy carried over", () => {
  const s = buildRoundStatus(base({ schedule: sched(ten), fantasy: fantasy({ carriedOver: true, fullTimeoutAvailable: true }) }), now);
  const f = s.rows.find((r) => r.id === "fantasy")!;
  assert.equal(f.done, true);
  assert.equal(f.carriedFromRound, 2);
  assert.equal(f.fullTimeoutAvailable, true);
  assert.equal(f.deadline, null);
});

check("fantasy open sorts first by deadline", () => {
  const s = buildRoundStatus(base({ schedule: sched(ten), fantasy: fantasy({ hasSquad: false }) }), now);
  assert.equal(s.rows[0].id, "fantasy");
  assert.equal(s.rows[0].deadline?.toISOString(), "2026-10-09T17:00:00.000Z");
  assert.equal(s.nextDeadline?.kind, "fantasy");
});

check("null sources hide their rows", () => {
  const s = buildRoundStatus(base({ schedule: sched(ten) }), now);
  assert.deepEqual(s.rows.map((r) => r.id), ["picks"]);
});

check("spin row", () => {
  const s = buildRoundStatus(base({ schedule: sched(ten), spin: { canSpin: false, nextEligibleAt: "2026-10-10T07:00:00Z" } }), now);
  const sp = s.rows.find((r) => r.id === "spin")!;
  assert.equal(sp.done, true);
  assert.equal(sp.nextAt?.toISOString(), "2026-10-10T07:00:00.000Z");
  assert.equal(sp.link, "/wheel");
});

check("top scorer row", () => {
  const open = buildRoundStatus(base({ schedule: sched(ten), topScorerGameIds: new Set(["other-round"]) }), now);
  const ts = open.rows.find((r) => r.id === "topScorer")!;
  assert.equal(ts.done, false);
  assert.equal(ts.bonus, true);
  assert.deepEqual(ts.count, { done: 0, total: 0 });
  const done = buildRoundStatus(base({ schedule: sched(ten), topScorerGameIds: new Set(["g4"]) }), now);
  assert.equal(done.rows.find((r) => r.id === "topScorer")!.done, true);
});

check("order: open before done", () => {
  const s = buildRoundStatus(
    base({ schedule: sched(ten), spin: { canSpin: false, nextEligibleAt: null }, topScorerGameIds: new Set() }),
    now,
  );
  assert.deepEqual(s.rows.map((r) => r.id), ["picks", "topScorer", "spin"]);
  assert.equal(s.doneCount, 1);
});

check("allDone phase and firstGame deadline", () => {
  const all = new Set(ten.map((x) => x.id));
  const s = buildRoundStatus(
    base({ schedule: sched(ten), predictedGameIds: all, topScorerGameIds: new Set(["g1"]), spin: { canSpin: false, nextEligibleAt: null }, fantasy: fantasy({}) }),
    now,
  );
  assert.equal(s.phase, "allDone");
  assert.equal(s.doneCount, s.rows.length);
  assert.equal(s.nextDeadline?.kind, "firstGame");
  assert.equal(s.nextDeadline?.at.toISOString(), "2026-10-09T18:15:00.000Z");
});

check("firstRun", () => {
  assert.equal(buildRoundStatus(base({ schedule: sched(ten), everPicked: false }), now).firstRun, true);
  assert.equal(buildRoundStatus(base({ schedule: sched(ten) }), now).firstRun, false);
});

check("formatCountdown", () => {
  const u = { d: "d", h: "h" };
  assert.equal(formatCountdown(86_400_000, u), "1d 0h");
  assert.equal(formatCountdown(2 * 86_400_000 + 4 * 3_600_000 + 59_000, u), "2d 4h");
  assert.equal(formatCountdown(4 * 3_600_000 + 12 * 60_000 + 9_000, u), "4:12:09");
  assert.equal(formatCountdown(59_000, u), "0:00:59");
  assert.equal(formatCountdown(-5_000, u), "0:00:00");
});

check("countdownTone", () => {
  assert.equal(countdownTone(599_999), "urgent");
  assert.equal(countdownTone(600_000), "soon");
  assert.equal(countdownTone(3_599_999), "soon");
  assert.equal(countdownTone(3_600_000), "normal");
});
