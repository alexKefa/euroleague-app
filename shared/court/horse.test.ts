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

// ---------------- Task 2: timing, disconnects, leaving, edge cases ----------------

const tick = (s: HorseState, now: number) => reduce(s, { type: "tick" }, now);
const input = (s: HorseState, type: "disconnect" | "reconnect" | "leave", playerId: string, now: number) => reduce(s, { type, playerId }, now);

test("resolution: no shots and no timeout while the ball is in the air", () => {
  const g = startGame(["A", "B"]);
  const fired = reduce(g.state, { type: "shotFired", playerId: "A" }, 1000);
  assert.ok(fired.state.resolving);
  assert.equal(shotGate(gateView(fired.state), "A", INSIDE.x, INSIDE.z), "busy");
  const later = tick(fired.state, 60000);
  assert.equal(later.state.turnId, "A");
  assert.equal(later.state.setterId, "A");
  assert.ok(later.state.resolving);
  assert.equal(hasEvent(later.effects, "turn"), false);
});

test("setting timeout counts as a miss", () => {
  const g = startGame(["A", "B", "C"]);
  assert.equal(tick(g.state, 19999).state.setterId, "A");
  const r = tick(g.state, 20000);
  assert.equal(r.state.setterId, "B");
  assert.equal(r.state.turnId, "B");
});

test("matching timeout gives a letter", () => {
  const g = startGame(["A", "B", "C"]);
  const set = fire(g.state, "A", true, INSIDE); // B's turn from t=1500
  const r = tick(set.state, 1500 + HORSE_TURN_MS);
  assert.equal(r.state.players["B"]!.letters, 1);
  assert.equal(r.state.turnId, "C");
});

test("disconnected player's turn is skipped without a letter", () => {
  const g = startGame(["A", "B", "C"]);
  const set = fire(g.state, "A", true, INSIDE);
  const r = input(set.state, "disconnect", "B", 2000);
  assert.equal(r.state.turnId, "C");
  assert.equal(r.state.players["B"]!.letters, 0);
  assert.equal(r.state.players["B"]!.eliminated, false);
});

test("30 s disconnected eliminates", () => {
  const g = startGame(["A", "B", "C"]);
  const d = input(g.state, "disconnect", "B", 0);
  assert.equal(tick(d.state, 29999).state.players["B"]!.eliminated, false);
  const r = tick(d.state, 30000);
  assert.equal(r.state.players["B"]!.eliminated, true);
  assert.ok(hasEvent(r.effects, "eliminated", "B"));
});

test("reconnect in time rejoins the rotation", () => {
  const g = startGame(["A", "B", "C"]);
  const d = input(g.state, "disconnect", "B", 0);
  const back = input(d.state, "reconnect", "B", 10000);
  assert.equal(back.state.players["B"]!.disconnectedAt, null);
  const set = fire(back.state, "A", true, INSIDE, 11000);
  assert.equal(set.state.turnId, "B");
  assert.deepEqual(set.state.matchQueue, ["C"]);
});

test("reconnect after elimination does not revive", () => {
  const g = startGame(["A", "B", "C"]);
  const d = input(g.state, "disconnect", "B", 0);
  const out = tick(d.state, 30000);
  const back = input(out.state, "reconnect", "B", 31000);
  assert.equal(back.state.players["B"]!.eliminated, true);
});

test("leave eliminates immediately", () => {
  const g = startGame(["A", "B", "C"]);
  const r = input(g.state, "leave", "C", 500);
  assert.equal(r.state.players["C"]!.eliminated, true);
  assert.ok(hasEvent(r.effects, "eliminated", "C"));
  assert.equal(r.state.phase, "setting");
});

test("shooter leaves while their shot is in the air", () => {
  const g = startGame(["A", "B", "C"]);
  const set = fire(g.state, "A", true, INSIDE);
  const fired = reduce(set.state, { type: "shotFired", playerId: "B" }, 3000);
  const left = input(fired.state, "leave", "B", 3100);
  const landed = reduce(left.state, { type: "shotResult", playerId: "B", made: false, x: INSIDE.x, z: INSIDE.z }, 3500);
  assert.equal(landed.state.resolving, null);
  assert.equal(landed.state.turnId, "C");
});

test("two players, one disconnects: the other wins after 30 s", () => {
  const g = startGame(["A", "B"]);
  const d = input(g.state, "disconnect", "B", 0);
  // A sets; nobody can match, so A sets again.
  const set = fire(d.state, "A", true, INSIDE);
  assert.equal(set.state.turnId, "A");
  assert.equal(set.state.phase, "setting");
  const r = tick(set.state, 30000);
  assert.equal(r.state.phase, "over");
  assert.equal(r.state.winnerId, "A");
});

test("setter eliminated mid-round: the round finishes, then the role passes on", () => {
  const g = startGame(["A", "B", "C"]);
  const set = fire(g.state, "A", true, INSIDE);
  const left = input(set.state, "leave", "A", 2000);
  assert.equal(left.state.turnId, "B");
  const b = fire(left.state, "B", true, INSIDE, 3000);
  const c = fire(b.state, "C", true, INSIDE, 5000);
  assert.equal(c.state.phase, "setting");
  assert.equal(c.state.setterId, "B");
});

test("only the setter left after the last matcher is eliminated: the setter wins", () => {
  let s = startGame(["A", "B", "C"]).state;
  s = input(s, "leave", "C", 100).state;
  s = { ...s, players: { ...s.players, B: { ...s.players["B"]!, letters: 4 } } };
  const set = fire(s, "A", true, INSIDE);
  const r = fire(set.state, "B", false, INSIDE, 3000);
  assert.equal(r.state.phase, "over");
  assert.equal(r.state.winnerId, "A");
});

test("everyone gone: abandoned, saved with no winner", () => {
  const g = startGame(["A", "B"]);
  const d1 = input(g.state, "disconnect", "A", 0);
  const d2 = input(d1.state, "disconnect", "B", 0);
  const r = tick(d2.state, 30000);
  assert.equal(r.state.phase, "over");
  assert.equal(r.state.winnerId, null);
  const save = r.effects.find((e) => e.type === "save");
  assert.ok(save && save.type === "save" && save.result.winnerId === null);
});

test("placements: winner 1, then latest eliminated first", () => {
  let s = startGame(["A", "B", "C"]).state;
  s = input(s, "leave", "C", 100).state;
  s = { ...s, players: { ...s.players, B: { ...s.players["B"]!, letters: 4 } } };
  const set = fire(s, "A", true, INSIDE);
  const r = fire(set.state, "B", false, INSIDE, 3000);
  const save = r.effects.find((e) => e.type === "save");
  assert.ok(save && save.type === "save");
  const placement = Object.fromEntries(save.result.players.map((p) => [p.id, p.placement]));
  assert.deepEqual(placement, { A: 1, B: 2, C: 3 });
});

// ---------------- Final review fixes ----------------

test("winner event carries the saved standings", () => {
  let s = startGame(["A", "B", "C"]).state;
  s = input(s, "leave", "C", 100).state; // C out early with 0 letters
  s = { ...s, players: { ...s.players, B: { ...s.players["B"]!, letters: 4 } } };
  const set = fire(s, "A", true, INSIDE);
  const r = fire(set.state, "B", false, INSIDE, 3000);
  const win = r.effects.find((e) => e.type === "event" && e.kind === "winner");
  assert.ok(win && win.type === "event");
  assert.deepEqual(win.standings, [
    { id: "A", letters: "", placement: 1 },
    { id: "B", letters: "HORSE", placement: 2 },
    { id: "C", letters: "", placement: 3 },
  ]);
});

test("rekey: a reloaded player keeps their seat, letters and turn", () => {
  let s = startGame(["A", "B", "C"]).state;
  s = { ...s, players: { ...s.players, B: { ...s.players["B"]!, letters: 2 } } };
  const set = fire(s, "A", true, INSIDE); // B's turn
  const r = reduce(set.state, { type: "rekey", from: "B", to: "B2" }, 2000);
  assert.deepEqual(r.state.order, ["A", "B2", "C"]);
  assert.equal(r.state.turnId, "B2");
  assert.equal(r.state.players["B2"]!.letters, 2);
  assert.equal(r.state.players["B2"]!.id, "B2");
  assert.equal(r.state.players["B"], undefined);
  // The old seat leaving afterwards changes nothing.
  const gone = input(r.state, "leave", "B", 2100);
  assert.equal(gone.state.players["B2"]!.eliminated, false);
  assert.equal(gone.state.turnId, "B2");
});

test("rekey: a dropped player who reopens the page rejoins the rotation", () => {
  const g = startGame(["A", "B", "C"]);
  const set = fire(g.state, "A", true, INSIDE);
  const dropped = input(set.state, "disconnect", "B", 2000); // B skipped -> C
  const r = reduce(dropped.state, { type: "rekey", from: "B", to: "B2" }, 5000);
  assert.equal(r.state.players["B2"]!.disconnectedAt, null);
  assert.equal(r.state.turnId, "C");
  const c = fire(r.state, "C", true, INSIDE, 6000); // round ends, setter rotates after A
  assert.equal(c.state.setterId, "B2");
  // 30 s after the original drop: still in.
  assert.equal(tick(c.state, 40000).state.players["B2"]!.eliminated, false);
});

test("rekey: ignored for eliminated or unknown players", () => {
  const g = startGame(["A", "B", "C"]);
  const out = input(g.state, "leave", "C", 100);
  const r = reduce(out.state, { type: "rekey", from: "C", to: "C2" }, 200);
  assert.equal(r.state, out.state);
  const r2 = reduce(g.state, { type: "rekey", from: "Z", to: "Z2" }, 200);
  assert.equal(r2.state, g.state);
});
