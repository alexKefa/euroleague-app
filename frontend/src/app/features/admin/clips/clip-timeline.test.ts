import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClipTeam, RoundClipData } from "../../../core/models";
import { buildTimeline, clipDuration, sceneAt } from "./clip-timeline";
import { clipText, roundLabelFor } from "./clip-text";

const team = (code: string): ClipTeam => ({ code, name: { en: code, el: code }, color: null, logo: null });
const alias = { en: "The Oracle", el: "Ο Μάντης" };

function data(overrides: Partial<RoundClipData> = {}): RoundClipData {
  return {
    season: "2026-27",
    round: 6,
    results: [{ home: team("OLY"), away: team("PAM"), homeScore: 81, awayScore: 87 }],
    hook: { winner: team("PAM"), loser: team("OLY"), score: "87–81", pickedLoserPct: 78 },
    topPredictor: { alias, correct: 9, total: 10, points: 214 },
    boldCall: { winner: team("ULK"), loser: team("BAR"), score: "90–88", correctPct: 12, alias },
    pull: { name: "S. Vezenkov", photo: null, tier: "legendary", foil: false, alias },
    next: { round: 7, picksOpen: true },
    ...overrides,
  };
}

test("a full round plays all six scenes over 18 seconds", () => {
  const t = buildTimeline(data());
  assert.deepEqual(
    t.map((s) => [s.id, s.start]),
    [["hook", 0], ["results", 2], ["topPredictor", 6], ["boldCall", 9], ["payoff", 12], ["cta", 16]]
  );
  assert.equal(t[0].variant, "upset");
  assert.equal(clipDuration(t), 18);
});

test("without an upset the bold call becomes the hook and isn't repeated", () => {
  const t = buildTimeline(data({ hook: null }));
  assert.equal(t[0].id, "hook");
  assert.equal(t[0].variant, "boldCall");
  assert.ok(!t.some((s) => s.id === "boldCall"));
  assert.equal(clipDuration(t), 15);
});

test("with nothing to feature the clip is results, payoff and call to action", () => {
  const t = buildTimeline(data({ hook: null, boldCall: null, topPredictor: null }));
  assert.deepEqual(t.map((s) => s.id), ["results", "payoff", "cta"]);
  assert.equal(clipDuration(t), 10);
});

test("the last scene holds past the end of the clip", () => {
  const t = buildTimeline(data());
  assert.equal(sceneAt(t, 17.9)?.scene.id, "cta");
  assert.equal(sceneAt(t, 30)?.scene.id, "cta");
  assert.equal(sceneAt(t, 2.5)?.scene.id, "results");
  assert.equal(sceneAt(t, 2.5)?.local, 0.5);
});

test("clip copy fills placeholders in the chosen language", () => {
  assert.equal(clipText("hookSaid", "el", { pct: 78 }), "Το 78% των παικτών του Clutch είπε");
  assert.equal(clipText("hookSaid", "en", { pct: 78 }), "78% of Clutch players said");
});

test("round names follow the app's postseason naming", () => {
  assert.equal(roundLabelFor(6, "en"), "Round 6");
  assert.equal(roundLabelFor(6, "el"), "Αγωνιστική 6");
  assert.equal(roundLabelFor(41, "en"), "Playoffs · Game 1");
  assert.equal(roundLabelFor(47, "el"), "Φάιναλ Φορ · Τελικός");
});
