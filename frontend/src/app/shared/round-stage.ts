/**
 * Which stage a round number is (2026-10-15). The feed numbers the
 * postseason as rounds after the regular season: with 38 regular-season
 * rounds (20 teams, since 2025-26) that's 39-40 play-in, 41-45 playoff
 * Games 1-5, 46 the Final Four semifinals and 47 the final. Mirrored in
 * backend services/roundLabel.ts for push notifications. Angular-free so
 * the round-clip renderer and its tests can use it too.
 */
export const REGULAR_SEASON_ROUNDS = 38;

export type RoundStage = "regular" | "playIn" | "playoffs" | "semifinals" | "final";

/** The stage and the number shown with it (round number, or playoff game number). */
export function roundStage(round: number): { stage: RoundStage; n: number } {
  const after = round - REGULAR_SEASON_ROUNDS;
  if (after <= 0) return { stage: "regular", n: round };
  if (after <= 2) return { stage: "playIn", n: after };
  if (after <= 7) return { stage: "playoffs", n: after - 2 };
  if (after === 8) return { stage: "semifinals", n: 0 };
  return { stage: "final", n: 0 };
}
