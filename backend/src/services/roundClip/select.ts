// Round clips: which game, pick and card each scene features. Pure — the
// data layer (data.ts) feeds these a round's numbers. Thresholds come from
// the spec: a game needs MIN_PICKS picks before any percentage is shown.

export const MIN_PICKS = 5;

export interface GamePickStats {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  tipoffAt: Date;
  picks: number;
  pickedHome: number;
  homeFairProb: number | null;
}

export interface PullCandidate {
  userId: string;
  name: string;
  imageUrl: string | null;
  tier: string;
  finish: string;
  unlockedAt: Date;
}

const homeWon = (g: GamePickStats) => g.homeScore > g.awayScore;
const pickedWinner = (g: GamePickStats) => (homeWon(g) ? g.pickedHome : g.picks - g.pickedHome);
const pct = (share: number) => Math.round(share * 100);
// A tie has no winner to feature (it can't happen in a real game, but dev data has one).
const decided = (games: GamePickStats[]) => games.filter((g) => g.homeScore !== g.awayScore);

/** The highest-scoring game by `score`; equal scores go to the later tip-off (the fresher story). */
function best<T extends GamePickStats>(games: T[], score: (g: T) => number): T | null {
  let top: T | null = null;
  for (const g of games) {
    if (!top || score(g) > score(top) || (score(g) === score(top) && g.tipoffAt > top.tipoffAt)) top = g;
  }
  return top;
}

/**
 * The round's biggest upset in the community's picks: the largest share on
 * the loser (> 50%) among games with enough picks. When no game has enough
 * picks, the biggest upset by pre-game odds instead, without a percentage.
 */
export function pickHook(allGames: GamePickStats[]): { gameId: string; pickedLoserPct: number | null } | null {
  const games = decided(allGames);
  const eligible = games.filter((g) => g.picks >= MIN_PICKS);
  if (eligible.length > 0) {
    const loserShare = (g: GamePickStats) => (g.picks - pickedWinner(g)) / g.picks;
    const top = best(eligible.filter((g) => loserShare(g) > 0.5), loserShare);
    return top ? { gameId: top.gameId, pickedLoserPct: pct(loserShare(top)) } : null;
  }
  const winnerProb = (g: GamePickStats) => (homeWon(g) ? g.homeFairProb! : 1 - g.homeFairProb!);
  const withOdds = games.filter((g) => g.homeFairProb !== null && winnerProb(g) < 0.5);
  const top = best(withOdds, (g) => -winnerProb(g));
  return top ? { gameId: top.gameId, pickedLoserPct: null } : null;
}

/**
 * The game with the smallest share of correct pickers that at least one
 * person still got right. A minority call only (under half correct): the
 * scene says "Only N% said…".
 */
export function pickBoldCall(games: GamePickStats[], excludeGameId: string | null): { gameId: string; correctPct: number } | null {
  const correctShare = (g: GamePickStats) => pickedWinner(g) / g.picks;
  const eligible = decided(games).filter((g) => g.gameId !== excludeGameId && g.picks >= MIN_PICKS && pickedWinner(g) >= 1 && correctShare(g) < 0.5);
  const top = best(eligible, (g) => -correctShare(g));
  return top ? { gameId: top.gameId, correctPct: pct(correctShare(top)) } : null;
}

function pullRank(c: PullCandidate): number {
  if (c.tier === "legendary") return c.finish === "foil" ? 3 : 2;
  return c.tier === "rare" ? 1 : 0;
}

/** Foil legendary > legendary > rare; the earlier pull wins a tie. Commons never feature. */
export function pickPull(cards: PullCandidate[]): PullCandidate | null {
  let top: PullCandidate | null = null;
  for (const c of cards) {
    if (pullRank(c) === 0) continue;
    if (!top || pullRank(c) > pullRank(top) || (pullRank(c) === pullRank(top) && c.unlockedAt < top.unlockedAt)) top = c;
  }
  return top;
}
