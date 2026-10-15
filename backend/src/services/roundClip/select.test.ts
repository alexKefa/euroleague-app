import { test } from "node:test";
import assert from "node:assert/strict";
import { clipAlias, clipTeamNames } from "./teams.js";
import { pickBoldCall, pickHook, pickPull, type GamePickStats, type PullCandidate } from "./select.js";

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
