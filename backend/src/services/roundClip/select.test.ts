import { test } from "node:test";
import assert from "node:assert/strict";
import { clipAlias, clipTeamNames, clipUsername } from "./teams.js";
import { pickBoldCall, pickHook, pickPull, pickPulls, pullWindow, type GamePickStats, type PullCandidate } from "./select.js";

const HOME = "home-team";
const AWAY = "away-team";

// picksOnLoser of `picks` picked the loser; the home side always loses here.
function game(id: string, picks: number, picksOnLoser: number, opts: Partial<GamePickStats> = {}): GamePickStats {
  return {
    gameId: id,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    homeScore: 81,
    awayScore: 87,
    tipoffAt: new Date("2026-10-14T18:00:00Z"),
    picks,
    pickedHome: picksOnLoser,
    homeFairProb: null,
    ...opts,
  };
}

test("alias joins the title and the favourite team's city in both languages", () => {
  assert.deepEqual(clipAlias("oracle", "OLY"), { en: "The Oracle of Piraeus", el: "Ο Μάντης του Πειραιά" });
});

test("alias is the bare title without a favourite team or for an unknown club", () => {
  assert.deepEqual(clipAlias("goldenHands", null), { en: "Golden Hands", el: "Χρυσά Χέρια" });
  assert.deepEqual(clipAlias("loneWolf", "XYZ"), { en: "The Lone Wolf", el: "Ο Μοναχικός Λύκος" });
});

test("team names come from the clip table, unknown clubs fall back to the DB name", () => {
  assert.deepEqual(clipTeamNames("ULK", "Fenerbahce Beko Istanbul"), { en: "Fenerbahce", el: "Φενέρμπαχτσε" });
  assert.deepEqual(clipTeamNames("XYZ", "New Club Riga"), { en: "New Club Riga", el: "New Club Riga" });
});

test("hook is the game with the largest share on the loser among games with at least 5 picks", () => {
  const games = [game("a", 18, 14), game("b", 10, 6), game("c", 4, 4)];
  assert.deepEqual(pickHook(games), { gameId: "a", pickedLoserPct: 78 });
});

test("exactly half on the loser is not an upset", () => {
  assert.equal(pickHook([game("a", 10, 5), game("b", 10, 2)]), null);
});

test("with too few picks everywhere the hook falls back to the biggest upset by odds", () => {
  const games = [
    game("a", 3, 1, { homeFairProb: 0.6 }), // away won at 0.4
    game("b", 2, 1, { homeFairProb: 0.8 }), // away won at 0.2
    game("c", 1, 0, { homeFairProb: 0.3 }), // away won at 0.7, not an upset
  ];
  assert.deepEqual(pickHook(games), { gameId: "b", pickedLoserPct: null });
  assert.equal(pickHook([game("a", 3, 1)]), null);
});

test("bold call is the game with the smallest correct share that someone got right", () => {
  // home loses, so correct = picks - pickedHome
  const games = [game("a", 25, 22), game("b", 8, 8), game("c", 10, 6)];
  assert.deepEqual(pickBoldCall(games, null), { gameId: "a", correctPct: 12 });
  assert.deepEqual(pickBoldCall(games, "a"), { gameId: "c", correctPct: 40 });
});

function card(name: string, tier: string, finish: string, at: string): PullCandidate {
  return { userId: "u", name, imageUrl: null, tier, finish, unlockedAt: new Date(at) };
}

test("pull prefers a foil legendary, then a legendary, then a rare", () => {
  const std = card("Std", "legendary", "standard", "2026-10-14T10:00:00Z");
  const foil = card("Foil", "legendary", "foil", "2026-10-15T10:00:00Z");
  const rare = card("Rare", "rare", "standard", "2026-10-13T10:00:00Z");
  assert.equal(pickPull([std, foil, rare])?.name, "Foil");
  assert.equal(pickPull([rare, std])?.name, "Std");
  assert.equal(pickPull([]), null);
});

test("a tied score is never featured, since it has no winner", () => {
  const tied = game("tie", 20, 18, { homeScore: 77, awayScore: 77 });
  assert.equal(pickHook([tied]), null);
  assert.equal(pickBoldCall([tied], null), null);
});

test("a game most people got right is not a bold call", () => {
  // 7 of 13 correct = 54%
  assert.equal(pickBoldCall([game("a", 13, 6)], null), null);
});

test("a featured user is shown by username unless they opted out or still have a generated handle", () => {
  assert.equal(clipUsername("nikos_23", true), "nikos_23");
  assert.equal(clipUsername("nikos_23", false), null);
  assert.equal(clipUsername("clutch-user-482913", true), null);
});

function pulled(userId: string, name: string, tier: string, finish: string, at: string): PullCandidate {
  return { userId, name, imageUrl: null, tier, finish, unlockedAt: new Date(at) };
}

test("several legendary pullers each feature once, foil first, at most three", () => {
  const cards = [
    pulled("a", "A-std", "legendary", "standard", "2026-10-11T10:00:00Z"),
    pulled("b", "B-foil", "legendary", "foil", "2026-10-12T10:00:00Z"),
    pulled("a", "A-foil", "legendary", "foil", "2026-10-13T10:00:00Z"),
    pulled("c", "C-std", "legendary", "standard", "2026-10-10T10:00:00Z"),
    pulled("d", "D-std", "legendary", "standard", "2026-10-14T10:00:00Z"),
    pulled("e", "E-rare", "rare", "standard", "2026-10-09T10:00:00Z"),
  ];
  assert.deepEqual(pickPulls(cards).map((c) => c.name), ["B-foil", "A-foil", "C-std"]);
});

test("without a legendary only the single best rare features", () => {
  const cards = [pulled("a", "A-rare", "rare", "standard", "2026-10-11T10:00:00Z"), pulled("b", "B-rare", "rare", "standard", "2026-10-10T10:00:00Z")];
  assert.deepEqual(pickPulls(cards).map((c) => c.name), ["B-rare"]);
  assert.deepEqual(pickPulls([]), []);
});

test("consecutive rounds' pull windows don't overlap", () => {
  const r4 = pullWindow(new Date("2026-10-02T20:00:00Z"), new Date("2026-10-07T18:00:00Z"), new Date("2026-10-09T20:00:00Z"));
  const r5 = pullWindow(new Date("2026-10-09T20:00:00Z"), new Date("2026-10-13T18:00:00Z"), new Date("2026-10-14T20:00:00Z"));
  assert.equal(r4.end.toISOString(), r5.start.toISOString());
  const duarte = new Date("2026-10-10T05:39:59Z");
  const inWindow = (w: { start: Date; end: Date }) => duarte > w.start && duarte <= w.end;
  assert.equal([r4, r5].filter(inWindow).length, 1);
});

test("the first round's pull window opens three days before its first game", () => {
  const w = pullWindow(null, new Date("2026-09-24T16:00:00Z"), new Date("2026-09-25T20:00:00Z"));
  assert.equal(w.start.toISOString(), "2026-09-21T16:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-09-26T20:00:00.000Z");
});
