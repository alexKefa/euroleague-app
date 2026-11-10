// Live court scoreboard (shootaround with friends). The server keeps each
// player's tally (it sees every shot), the clients rank and display it on
// the jumbotron and the LED floor. Pure, shared by both apps.

/** Streak length that counts as "on fire" (also lights the floor). */
export const HOT_STREAK = 3;

export interface Tally {
  makes: number;
  attempts: number;
  /** Current run of makes. */
  streak: number;
  best: number;
  threes: number;
}

export const EMPTY_TALLY: Tally = { makes: 0, attempts: 0, streak: 0, best: 0, threes: 0 };

export function applyShot(t: Tally, made: boolean, three: boolean): Tally {
  const streak = made ? t.streak + 1 : 0;
  return {
    makes: t.makes + (made ? 1 : 0),
    attempts: t.attempts + 1,
    streak,
    best: Math.max(t.best, streak),
    threes: t.threes + (made && three ? 1 : 0),
  };
}

/** Whole-number %, or null before the first attempt. */
export function shootingPct(makes: number, attempts: number): number | null {
  return attempts > 0 ? Math.round((100 * makes) / attempts) : null;
}

export interface ScoreLine extends Tally {
  id: string;
  name: string;
  /** Kit colour, for name chips. */
  color: string;
  /** Join order (stable tie-break and left/right on the floor). */
  joinedAt: number;
  connected: boolean;
}

/** Connected players, most makes first; then better %, fewer attempts, earlier join. */
export function rankScores(lines: ScoreLine[]): ScoreLine[] {
  const pct = (l: ScoreLine) => (l.attempts ? l.makes / l.attempts : 0);
  return lines
    .filter((l) => l.connected)
    .sort((a, b) => b.makes - a.makes || pct(b) - pct(a) || a.attempts - b.attempts || a.joinedAt - b.joinedAt);
}

/** The top two for the floor's head-to-head, left = whoever joined first (so names never swap sides). */
export function headToHead(lines: ScoreLine[]): [ScoreLine, ScoreLine] | null {
  const top = rankScores(lines).slice(0, 2);
  if (top.length < 2) return null;
  const [a, b] = top as [ScoreLine, ScoreLine];
  return a.joinedAt <= b.joinedAt ? [a, b] : [b, a];
}
