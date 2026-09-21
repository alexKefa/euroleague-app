// Cosmetic court zone per position for a read-only squad preview — same
// "Center near the key at the top, Guard toward open floor at the bottom"
// convention as features/fantasy/fantasy.ts's own ROW_TOP, but a fresh,
// simpler set of numbers rather than importing that file's: this preview
// renders much smaller avatars with no info-box, so it doesn't inherit
// that file's tight clipping calibration, and — unlike the roster builder,
// which only ever shows the *viewer's own* squad built through the
// formation picker — another user's saved lineup has no guarantee its 5
// starters split into one of the app's 5 supported formations at all (the
// backend only enforces the overall 4G/4F/2C quota across all 10 outfield
// players, never a per-slot position — see CLAUDE.md's Fantasy Five
// section), so the layout below has to cope with any position mix.
// Pulled in from an initial 82/50/18 (real bug, reported live: players
// rendered outside the court box) — each chip is an avatar plus a name
// line plus a PIR line, taller than the single-line label this was first
// eyeballed against, so 18/82 left too little top/bottom margin for that
// stack's own half-height once centered via -translate-y-1/2.
export const COURT_POSITION_TOP: Record<string, number> = { Guard: 74, Forward: 48, Center: 24 };

// Evenly spreads `count` items across the court's width with margin at
// both edges. Unlike fantasy.ts's rowXPositions (hardcoded for 1/2/3 since
// a supported formation never puts more than 3 starters at one position),
// this handles any count for the reason above. Margin widened 15 -> 18
// alongside the COURT_POSITION_TOP fix above, same overflow report.
export function spreadCourtX(count: number): number[] {
  if (count <= 1) return [50];
  const margin = 18;
  const span = 100 - margin * 2;
  return Array.from({ length: count }, (_, i) => margin + (span * i) / (count - 1));
}
