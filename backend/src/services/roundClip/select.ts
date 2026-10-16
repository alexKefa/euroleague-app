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

/**
 * Who the payoff features (2026-10-15, "show more users"): each person's best
 * pull, ranked like pickPull, then (2026-10-16, "show some of them") their
 * other legendaries, at most `max` cards. Legendaries only; when nobody
 * pulled one, just the single best rare.
 */
export function pickPulls(cards: PullCandidate[], max = 5): PullCandidate[] {
  const bestPerUser = new Map<string, PullCandidate>();
  for (const c of cards) {
    const current = bestPerUser.get(c.userId);
    if (pickPull(current ? [current, c] : [c]) === c) bestPerUser.set(c.userId, c);
  }
  const ranked: PullCandidate[] = [];
  const pool = [...bestPerUser.values()];
  for (let top = pickPull(pool); top; top = pickPull(pool)) {
    ranked.push(top);
    pool.splice(pool.indexOf(top), 1);
  }
  const legendaries = ranked.filter((c) => c.tier === "legendary");
  if (legendaries.length === 0) return ranked.slice(0, 1);
  // Room left once everyone's best is in: fill it with their other legendaries.
  const rest = cards.filter((c) => c.tier === "legendary" && !legendaries.includes(c));
  for (let top = pickPull(rest); top && legendaries.length < max; top = pickPull(rest)) {
    legendaries.push(top);
    rest.splice(rest.indexOf(top), 1);
  }
  return legendaries.slice(0, max);
}

const DAY_MS = 86_400_000;

/**
 * Which unlocks count as "pulled this round": from a day after the previous
 * round's last game to a day after this round's last game. Back to back, so
 * a pull features in exactly one round's clip. The first round opens three
 * days before its first game.
 */
export function pullWindow(prevLastTipoff: Date | null, firstTipoff: Date, lastTipoff: Date): { start: Date; end: Date } {
  const start = prevLastTipoff ? new Date(prevLastTipoff.getTime() + DAY_MS) : new Date(firstTipoff.getTime() - 3 * DAY_MS);
  return { start, end: new Date(lastTipoff.getTime() + DAY_MS) };
}
