// Run: (backend) npm run test:court
import { test } from "node:test";
import assert from "node:assert/strict";
import { rimCenter } from "./geometry.js";
import {
  HORSE_TURN_MS,
  canStart,
  initialHorseState,
  lettersOf,
  reduce,
  shotGate,
  type HorseEffect,
  type HorseState,
} from "./horse.js";

const rim = rimCenter("A");
const INSIDE = { x: 0, z: rim.z + 4 };
const OUTSIDE = { x: 0, z: rim.z + 7.5 };

interface Run {
  state: HorseState;
  effects: HorseEffect[];
}

function startGame(ids: string[], now = 0): Run {
  return reduce(
    initialHorseState(),
    { type: "start", by: ids[0]!, ownerId: ids[0]!, players: ids.map((id, i) => ({ id, joinOrder: i, connected: true })) },
    now
  );
}

/** shotFired + shotResult for `id`. */
function fire(state: HorseState, id: string, made: boolean, at: { x: number; z: number }, now = 1000): Run {
  const a = reduce(state, { type: "shotFired", playerId: id }, now);
  const b = reduce(a.state, { type: "shotResult", playerId: id, made, x: at.x, z: at.z }, now + 500);
  return { state: b.state, effects: [...a.effects, ...b.effects] };
}

function hasEvent(effects: HorseEffect[], kind: string, playerId?: string): boolean {
  return effects.some((e) => e.type === "event" && e.kind === kind && (playerId === undefined || e.playerId === playerId));
}

const gateView = (s: HorseState) => ({ phase: s.phase, turnId: s.turnId, spot: s.spot, resolving: !!s.resolving });

test("start: needs 2 connected players", () => {
  assert.equal(canStart([{ id: "A", joinOrder: 0, connected: true }], "A", "A"), false);
  assert.equal(
    canStart(
      [
        { id: "A", joinOrder: 0, connected: true },
        { id: "B", joinOrder: 1, connected: false },
      ],
      "A",
      "A"
    ),
    false
  );
  assert.equal(
    canStart(
      [
        { id: "A", joinOrder: 0, connected: true },
        { id: "B", joinOrder: 1, connected: true },
      ],
      "A",
      "A"
    ),
    true
  );
  const solo = reduce(initialHorseState(), { type: "start", by: "A", ownerId: "A", players: [{ id: "A", joinOrder: 0, connected: true }] }, 0);
  assert.equal(solo.state.phase, "free");
});

test("start: owner starts; if the owner is away the earliest joiner starts", () => {
  const players = [
    { id: "O", joinOrder: 0, connected: false },
    { id: "B", joinOrder: 2, connected: true },
    { id: "C", joinOrder: 1, connected: true },
  ];
  assert.equal(canStart(players, "O", "C"), true);
  assert.equal(canStart(players, "O", "B"), false);
  const present = players.map((p) => ({ ...p, connected: true }));
  assert.equal(canStart(present, "O", "O"), true);
  assert.equal(canStart(present, "O", "C"), false);
});

test("start: order is join order, first setter is order[0]", () => {
  const r = reduce(
    initialHorseState(),
    {
      type: "start",
      by: "B",
      ownerId: "B",
      players: [
        { id: "A", joinOrder: 2, connected: true },
        { id: "B", joinOrder: 0, connected: true },
        { id: "C", joinOrder: 1, connected: true },
      ],
    },
    0
  );
  assert.deepEqual(r.state.order, ["B", "C", "A"]);
  assert.equal(r.state.phase, "setting");
  assert.equal(r.state.setterId, "B");
  assert.equal(r.state.turnId, "B");
  assert.ok(r.effects.some((e) => e.type === "event" && e.kind === "turn" && e.playerId === "B" && e.remainingMs === HORSE_TURN_MS));
});

test("start: ignored while a game is running", () => {
  const g = startGame(["A", "B"]);
  const again = reduce(g.state, { type: "start", by: "A", ownerId: "A", players: [{ id: "A", joinOrder: 0, connected: true }, { id: "B", joinOrder: 1, connected: true }] }, 500);
  assert.deepEqual(again.state, g.state);
  assert.deepEqual(again.effects, []);
});

test("setting make: spot set, matchers queued after the setter", () => {
  const g = startGame(["A", "B", "C"]);
  const r = fire(g.state, "A", true, INSIDE);
  assert.equal(r.state.phase, "matching");
  assert.ok(r.state.spot && Math.abs(r.state.spot.x - INSIDE.x) < 1e-9 && Math.abs(r.state.spot.z - INSIDE.z) < 1e-9);
  assert.equal(r.state.spot!.hoop, "A");
  assert.equal(r.state.turnId, "B");
  assert.deepEqual(r.state.matchQueue, ["C"]);
  assert.ok(hasEvent(r.effects, "set", "A"));
});

test("setting miss: setter role passes", () => {
  const g = startGame(["A", "B", "C"]);
  const r = fire(g.state, "A", false, INSIDE);
  assert.equal(r.state.phase, "setting");
  assert.equal(r.state.setterId, "B");
  assert.equal(r.state.turnId, "B");
});

test("shotGate: setting outside the arc is rejected", () => {
  const g = startGame(["A", "B"]);
  assert.equal(shotGate(gateView(g.state), "A", OUTSIDE.x, OUTSIDE.z), "outsideArc");
  assert.equal(shotGate(gateView(g.state), "A", INSIDE.x, INSIDE.z), null);
  assert.equal(shotGate(gateView(g.state), "B", INSIDE.x, INSIDE.z), "notYourTurn");
  assert.equal(shotGate(gateView(initialHorseState()), "anyone", OUTSIDE.x, OUTSIDE.z), null);
});

test("shotGate: matching off the spot is rejected", () => {
  const g = startGame(["A", "B"]);
  const r = fire(g.state, "A", true, INSIDE);
  assert.equal(shotGate(gateView(r.state), "B", INSIDE.x + 1.2, INSIDE.z), "offSpot");
  assert.equal(shotGate(gateView(r.state), "B", INSIDE.x + 0.9, INSIDE.z), null);
});

test("matching miss: letter", () => {
  const g = startGame(["A", "B", "C"]);
  const set = fire(g.state, "A", true, INSIDE);
  const r = fire(set.state, "B", false, INSIDE, 3000);
  assert.equal(r.state.players["B"]!.letters, 1);
  assert.ok(r.effects.some((e) => e.type === "event" && e.kind === "letter" && e.playerId === "B" && e.letters === "H"));
});

test("matching make: no letter, matched event", () => {
  const g = startGame(["A", "B", "C"]);
  const set = fire(g.state, "A", true, INSIDE);
  const r = fire(set.state, "B", true, INSIDE, 3000);
  assert.equal(r.state.players["B"]!.letters, 0);
  assert.ok(hasEvent(r.effects, "matched", "B"));
});

test("round end: setter rotates to the next active after the setter", () => {
  const g = startGame(["A", "B", "C"]);
  const set = fire(g.state, "A", true, INSIDE);
  const b = fire(set.state, "B", true, INSIDE, 3000);
  const c = fire(b.state, "C", false, INSIDE, 5000);
  assert.equal(c.state.phase, "setting");
  assert.equal(c.state.setterId, "B");
  assert.equal(c.state.turnId, "B");
  assert.equal(c.state.spot, null);
});

test("five letters eliminates", () => {
  let s = startGame(["A", "B", "C"]).state;
  s = { ...s, players: { ...s.players, B: { ...s.players["B"]!, letters: 4 } } };
  const set = fire(s, "A", true, INSIDE);
  const r = fire(set.state, "B", false, INSIDE, 3000);
  assert.equal(r.state.players["B"]!.eliminated, true);
  assert.equal(r.state.players["B"]!.letters, 5);
  assert.ok(hasEvent(r.effects, "eliminated", "B"));
  // C matches, round ends: B is skipped as the next setter.
  const c = fire(r.state, "C", true, INSIDE, 5000);
  assert.equal(c.state.setterId, "C");
  // C sets: only A matches.
  const cs = fire(c.state, "C", true, INSIDE, 7000);
  assert.deepEqual([cs.state.turnId, ...cs.state.matchQueue], ["A"]);
});

test("last player standing wins", () => {
  let s = startGame(["A", "B"]).state;
  s = { ...s, players: { ...s.players, B: { ...s.players["B"]!, letters: 4 } } };
  const set = fire(s, "A", true, INSIDE);
  const r = fire(set.state, "B", false, INSIDE, 3000);
  assert.equal(r.state.phase, "over");
  assert.equal(r.state.winnerId, "A");
  assert.ok(hasEvent(r.effects, "winner", "A"));
  const save = r.effects.find((e) => e.type === "save");
  assert.ok(save && save.type === "save");
  assert.deepEqual(
    save.result.players.map((p) => [p.id, p.placement]).sort(),
    [
      ["A", 1],
      ["B", 2],
    ]
  );
  assert.ok(r.effects.some((e) => e.type === "returnToFree" && e.afterMs === 10000));
});

test("lettersOf", () => {
  assert.equal(lettersOf(0), "");
  assert.equal(lettersOf(3), "HOR");
  assert.equal(lettersOf(5), "HORSE");
});
