// Pure rules for the Daily Question (docs/superpowers/specs/2026-10-13-daily-question-design.md):
// the Athens day, the streak, the payout table and how a pair is picked.
// Checked by scripts/daily-question-check.ts.

export type DqStat = "points" | "rebounds" | "assists" | "pir" | "threes";
export type DqTemplate = "last_night" | "last_game" | "last_3";

export const DQ_STATS: DqStat[] = ["points", "rebounds", "assists", "pir", "threes"];
export const DQ_SHOWN_SECONDS = 10;
// What the server accepts: the 10 s on screen plus 2 s for the network.
export const DQ_ANSWER_WINDOW_MS = 12_000;

// Per-game floor (×3 for last_3), so 1-vs-0 questions never appear.
export const STAT_FLOOR: Record<DqStat, number> = { points: 6, rebounds: 3, assists: 2, pir: 5, threes: 1 };

const athensDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD of `at` in Europe/Athens — the game's day boundary. */
export function athensDay(at: Date): string {
  return athensDate.format(at);
}

export function nextStreak(yesterdayStreak: number | null): number {
  return (yesterdayStreak ?? 0) + 1;
}

export const STREAK_STEP = 3;
export const STREAK_CAP = 30;
export const CORRECT_BONUS = 30;

export function pointsFor(
  streak: number,
  correct: boolean
): { streakBonus: number; correctBonus: number; milestone: number; total: number } {
  const streakBonus = Math.min(STREAK_STEP * streak, STREAK_CAP);
  const correctBonus = correct ? CORRECT_BONUS : 0;
  const milestone = streak === 7 ? 75 : streak > 0 && streak % 30 === 0 ? 300 : 0;
  return { streakBonus, correctBonus, milestone, total: streakBonus + correctBonus + milestone };
}

const BANDS: [number, number][] = [
  [1.15, 1.25],
  [1.1, 1.4],
];

/**
 * Two candidates whose values differ by a ratio in the tight band (else the
 * widened one), chosen uniformly with `rand`, in random order. Null when no
 * pair qualifies.
 */
export function pickPair<T extends { value: number }>(candidates: T[], rand: () => number): [T, T] | null {
  for (const [lo, hi] of BANDS) {
    const pairs: [T, T][] = [];
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i].value;
        const b = candidates[j].value;
        if (a <= 0 || b <= 0 || a === b) continue;
        const ratio = Math.max(a, b) / Math.min(a, b);
        if (ratio >= lo && ratio <= hi) pairs.push([candidates[i], candidates[j]]);
      }
    }
    if (pairs.length > 0) {
      const [x, y] = pairs[Math.min(pairs.length - 1, Math.floor(rand() * pairs.length))];
      return rand() < 0.5 ? [x, y] : [y, x];
    }
  }
  return null;
}
