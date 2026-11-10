// Run: (backend) npm run test:court
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAYER_SPEED } from "./constants.js";
import { FENCE } from "./geometry.js";
import { jerseyNumber, kitColors } from "./kit.js";
import {
  CLOSE_REPLACED,
  EMOTE_IDS,
  PHRASE_IDS,
  REACTION_GAP_MS,
  isReactionId,
  reactionAllowed,
  CODE_ALPHABET,
  closeAction,
  MOVE_SPEED_TOLERANCE,
  generateCourtCode,
  isValidCourtCode,
  normalizeCourtCode,
  normalizeYaw,
  validateMove,
} from "./protocol.js";

test("court codes: 6 chars from the unambiguous alphabet", () => {
  for (const ch of "01OIL") assert.ok(!CODE_ALPHABET.includes(ch), `${ch} must not be used`);
  let seed = 1;
  const rnd = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
  for (let i = 0; i < 500; i++) assert.ok(isValidCourtCode(generateCourtCode(rnd)));
  assert.ok(!isValidCourtCode("ABC12O")); // contains 1 and O
  assert.ok(!isValidCourtCode("ABCDE"));
  assert.ok(!isValidCourtCode(42));
  assert.equal(normalizeCourtCode(" abc 23x\n"), "ABC23X");
});

test("moves: normal running is accepted, teleports are rejected", () => {
  const from = { x: 0, z: -5 };
  const step = PLAYER_SPEED * 0.05; // one 20 Hz tick at full speed
  assert.deepEqual(validateMove(from, { x: 0, z: -5 + step }, 0.05), { x: 0, z: -5 + step });
  assert.ok(validateMove(from, { x: 0, z: -5 + PLAYER_SPEED * MOVE_SPEED_TOLERANCE * 0.05 + 0.3 }, 0.05));
  assert.equal(validateMove(from, { x: 0, z: 1 }, 0.05), null);
  // A long gap is capped: a paused tab can't jump across the court.
  assert.equal(validateMove(from, { x: 0, z: 2 }, 30), null);
  assert.equal(validateMove(from, { x: Number.NaN, z: 0 }, 0.05), null);
});

test("moves are clamped inside the fence", () => {
  const edge = { x: FENCE.maxX - 0.45, z: -5 };
  const r = validateMove(edge, { x: FENCE.maxX + 0.1, z: -5 }, 0.1)!;
  assert.ok(r.x < FENCE.maxX);
});

test("yaw normalisation", () => {
  assert.equal(normalizeYaw(Number.NaN), 0);
  assert.ok(Math.abs(normalizeYaw(3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(normalizeYaw(-3 * Math.PI / 2) - Math.PI / 2) < 1e-9);
});

test("kit: near-black primaries swap with a brighter secondary", () => {
  assert.deepEqual(kitColors("#000000", "#FFFFFF"), { primary: "#FFFFFF", secondary: "#000000" });
  assert.deepEqual(kitColors("#CF152D", "#0B2240"), { primary: "#CF152D", secondary: "#0B2240" });
  assert.equal(kitColors(null, null).primary, "#FF6B35");
});

test("jersey numbers are stable and 0-99", () => {
  const n = jerseyNumber("a41e5bde-9032-4923-8721-85d0ad4f3330");
  assert.equal(n, jerseyNumber("a41e5bde-9032-4923-8721-85d0ad4f3330"));
  assert.ok(n >= 0 && n <= 99);
});

test("closeAction: opened elsewhere never auto-rejoins (no tab tug-of-war)", () => {
  assert.equal(closeAction(CLOSE_REPLACED, { visible: true, connectedMs: 600_000 }), "replaced");
});

test("closeAction: a healthy session that dropped for good rejoins on its own", () => {
  assert.equal(closeAction(4003, { visible: true, connectedMs: 60_000 }), "rejoin");
  assert.equal(closeAction(1006, { visible: true, connectedMs: 10_000 }), "rejoin");
});

test("closeAction: in the background, rejoin waits until the page is visible", () => {
  assert.equal(closeAction(4003, { visible: false, connectedMs: 60_000 }), "rejoinWhenVisible");
});

test("closeAction: a session that died within 10 s shows the button instead (no rejoin loop)", () => {
  assert.equal(closeAction(4003, { visible: true, connectedMs: 9_999 }), "stay");
  assert.equal(closeAction(4002, { visible: false, connectedMs: 0 }), "stay");
});

test("emotes: only known emote and phrase ids are accepted", () => {
  for (const id of [...EMOTE_IDS, ...PHRASE_IDS]) assert.ok(isReactionId(id), id);
  for (const bad of ["", "WAVE", "hello", "<script>", 3, null, undefined, {}]) assert.equal(isReactionId(bad), false, String(bad));
  assert.equal(EMOTE_IDS.length, 6);
  assert.equal(PHRASE_IDS.length, 6);
});

test("emotes: at most one per REACTION_GAP_MS per player", () => {
  assert.equal(reactionAllowed(undefined, 1000), true);
  assert.equal(reactionAllowed(1000, 1000 + REACTION_GAP_MS - 1), false);
  assert.equal(reactionAllowed(1000, 1000 + REACTION_GAP_MS), true);
});
