// Battles v5 power (2026-10-09, direct request: "number 1 criteria to be
// rarity of card (foil will be even stronger) - then the averages of player
// (pir) - then current form of player"). Replaces the v4 stat duel
// (services/statDuel.ts) for every new battle; v4/v3 battles keep their
// own display. Pure: checked by scripts/check-battle-power.ts.
//
// power = rarity base + (season PIR + form) x injury factor, floor 1.
// The winner is a weighted draw, your power / (both powers), so a higher
// tier is heavily favored but a star common can still upset a weak
// legendary. Injury only cuts the PIR part: an injured legendary keeps its
// rarity edge.
import type { InjuryStatus } from "./statDuel.js";

export const RARITY_BASE: Record<string, number> = { common: 0, rare: 15, legendary: 30 };
export const FOIL_BASE = 40;
// Form = (recent PIR - season PIR) x FORM_SCALE, capped at +/-FORM_CAP, and
// only once there are FORM_MIN_GAMES recent games.
export const FORM_SCALE = 0.5;
export const FORM_CAP = 4;
export const FORM_MIN_GAMES = 3;
const INJURY_FACTOR: Record<InjuryStatus, number> = { out: 0.75, doubtful: 0.85, questionable: 0.9, probable: 1 };

export interface BattlePowerInput {
  tier: string;
  finish?: string | null;
  seasonPir: number;
  recentPir: number | null;
  recentGames: number;
  injury: InjuryStatus | null;
}

export interface BattlePower {
  rarity: number;
  pir: number;
  form: number;
  injuryFactor: number;
  power: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeBattlePower(input: BattlePowerInput): BattlePower {
  const rarity = input.finish === "foil" ? FOIL_BASE : (RARITY_BASE[input.tier] ?? 0);
  const pir = round1(input.seasonPir);
  const form =
    input.recentPir != null && input.recentGames >= FORM_MIN_GAMES
      ? round1(Math.max(-FORM_CAP, Math.min(FORM_CAP, (input.recentPir - input.seasonPir) * FORM_SCALE)))
      : 0;
  const injuryFactor = input.injury ? INJURY_FACTOR[input.injury] : 1;
  const power = Math.max(1, round1(rarity + (pir + form) * injuryFactor));
  return { rarity, pir, form, injuryFactor, power };
}

/** Chance the first side wins the weighted draw. */
export function winProbability(power: number, otherPower: number): number {
  return power / (power + otherPower);
}
