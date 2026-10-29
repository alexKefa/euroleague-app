// Pure rules for "Four Quarters" card duels: card scoring, form and rarity
// multipliers, category draws, lineup checks, Elo, divisions and prize
// eligibility. No db imports (type-only import below), so it runs under plain
// tsx in duelEngine.test.ts. The duel lifecycle lives in the duel services.
// Spec: docs/superpowers/specs/2026-10-29-four-quarters-duels-design.md
import type { InjuryStatus } from "./statDuel.js";

export const LINEUP_SIZE = 5;
export const MAX_ACTIVE_DUELS = 5;
export const DUEL_WIN_PRIZE = 15;
export const MAX_PAID_WINS_PER_DAY = 5;
export const QUARTER_MS = 24 * 60 * 60 * 1000;
export const CHALLENGE_TTL_MS = 72 * 60 * 60 * 1000;
export const DEADLINE_WARNING_MS = 2 * 60 * 60 * 1000;
export const START_RATING = 1000;

export type DuelCategory = "scoring" | "boards" | "playmaking" | "defense" | "efficiency" | "all_around";
export const DUEL_CATEGORIES: readonly DuelCategory[] = ["scoring", "boards", "playmaking", "defense", "efficiency", "all_around"];

/** Multiplier that brings each category's raw per-game value to a comparable score. */
export const CATEGORY_SCALES: Record<DuelCategory, number> = {
  scoring: 2.82,
  boards: 8,
  playmaking: 15.38,
  defense: 28.57,
  efficiency: 2.56,
  all_around: 1.71,
};

export type FormBadge = "ice_cold" | "cold" | "steady" | "hot" | "on_fire";

export interface BaseLine {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  pir: number;
}

export interface DuelCard {
  collectibleId: string;
  name: string;
  teamId: string;
  imageUrl: string | null;
  tier: string;
  isMvp: boolean;
  isFoil: boolean;
  base: BaseLine;
  rarityMult: number;
  formMult: number;
  formBadge: FormBadge | null;
  injury: InjuryStatus | null;
  injuryMult: number;
}

export type Division = "rookie" | "starter" | "sixth_man" | "all_star" | "mvp";

export function rarityMult(tier: string, isMvp: boolean, isFoil: boolean): number {
  let m = isMvp ? 1.3 : tier === "legendary" ? 1.2 : tier === "rare" ? 1.1 : 1;
  if (isFoil) m += 0.1;
  return Math.round(m * 100) / 100;
}

/** Recent PIR vs season PIR. Needs at least 3 recent games, otherwise no badge. */
export function formFor(seasonPir: number, recentPir: number | null, recentGames: number): { badge: FormBadge | null; mult: number } {
  if (recentPir == null || recentGames < 3) return { badge: null, mult: 1 };
  const diff = recentPir - seasonPir;
  if (diff >= 5) return { badge: "on_fire", mult: 1.15 };
  if (diff >= 2) return { badge: "hot", mult: 1.08 };
  if (diff <= -5) return { badge: "ice_cold", mult: 0.85 };
  if (diff <= -2) return { badge: "cold", mult: 0.93 };
  return { badge: "steady", mult: 1 };
}

export function categoryValue(base: BaseLine, cat: DuelCategory): number {
  switch (cat) {
    case "scoring": return base.pts;
    case "boards": return base.reb;
    case "playmaking": return base.ast;
    case "defense": return base.stl + base.blk;
    case "efficiency": return base.pir;
    case "all_around": return base.pts + base.reb + base.ast;
  }
}

export function quarterScore(card: DuelCard, cat: DuelCategory): number {
  const raw = categoryValue(card.base, cat) * CATEGORY_SCALES[cat] * card.rarityMult * card.formMult * card.injuryMult;
  return Math.round(raw * 10) / 10;
}

/** Four distinct categories in play order (partial Fisher-Yates). */
export function drawCategories(rng: () => number = Math.random): DuelCategory[] {
  const pool = [...DUEL_CATEGORIES];
  for (let i = 0; i < 4; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 4);
}

/** The unused slot with the lowest quarter score; ties go to the lower index. */
export function weakestRemaining(lineup: DuelCard[], usedSlots: number[], cat: DuelCategory): number {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < lineup.length; i++) {
    if (usedSlots.includes(i)) continue;
    const s = quarterScore(lineup[i], cat);
    if (s < bestScore) {
      best = i;
      bestScore = s;
    }
  }
  return best;
}

/** The one slot left after four quarters have each used a card. */
export function benchSlot(usedSlots: number[]): number {
  for (let i = 0; i < LINEUP_SIZE; i++) if (!usedSlots.includes(i)) return i;
  return -1;
}

export function validateLineup(cards: { playerKey: string; tier: string }[]): "INVALID_LINEUP" | null {
  if (cards.length !== LINEUP_SIZE) return "INVALID_LINEUP";
  if (cards.some((c) => c.tier === "coach")) return "INVALID_LINEUP";
  if (new Set(cards.map((c) => c.playerKey)).size !== LINEUP_SIZE) return "INVALID_LINEUP";
  return null;
}

export function eloDeltas(ra: number, rb: number, resultA: 1 | 0.5 | 0, kA: number, kB: number): { a: number; b: number } {
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const eb = 1 - ea;
  // + 0 turns -0 into 0
  return {
    a: Math.round(kA * (resultA - ea)) + 0,
    b: Math.round(kB * (1 - resultA - eb)) + 0,
  };
}

export function kFactor(lifetimeGames: number, pairRecentGames: number): number {
  const k = lifetimeGames < 10 ? 32 : 20;
  return pairRecentGames >= 3 ? k / 2 : k;
}

export function divisionFor(rating: number): Division {
  if (rating >= 1300) return "mvp";
  if (rating >= 1200) return "all_star";
  if (rating >= 1100) return "sixth_man";
  if (rating >= 950) return "starter";
  return "rookie";
}

/** Calendar month in Europe/Athens, as YYYY-MM. */
export function seasonKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit" }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  return `${y}-${m}`;
}

/** New month: pull the last rating halfway back to the start rating. */
export function softReset(lastRating: number | null): number {
  if (lastRating == null) return START_RATING;
  return Math.round((lastRating + START_RATING) / 2);
}

export function prizeEligible(o: { result: "win" | "draw" | "loss"; paidWinsToday: number; paidVsOpponentToday: number }): boolean {
  return o.result === "win" && o.paidWinsToday < MAX_PAID_WINS_PER_DAY && o.paidVsOpponentToday < 1;
}
