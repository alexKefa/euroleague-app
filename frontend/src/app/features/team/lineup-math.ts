// Per-100-possession ratings and pace (2026-10-09), shared by the team
// analytics cards and the lineup builder so they use one formula.
// Possessions per stint come from the backend (FGA - OREB + TO + 0.44*FTA).
// Pure: checked by scripts/check-lineup-math.ts.

function rating(pts: number, poss: number): number | null {
  return poss > 0 ? (pts / poss) * 100 : null;
}

export function offRating(ptsFor: number, possFor: number): number | null {
  return rating(ptsFor, possFor);
}

export function defRating(ptsAgainst: number, possAgainst: number): number | null {
  return rating(ptsAgainst, possAgainst);
}

export function netRating(ptsFor: number, possFor: number, ptsAgainst: number, possAgainst: number): number | null {
  const o = rating(ptsFor, possFor);
  const d = rating(ptsAgainst, possAgainst);
  return o == null || d == null ? null : o - d;
}

/** Possessions per 40 minutes. */
export function pace(possFor: number, possAgainst: number, seconds: number): number | null {
  return seconds > 0 ? (possFor + possAgainst) / 2 / (seconds / 2400) : null;
}
