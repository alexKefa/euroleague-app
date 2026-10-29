import { DuelCard, DuelCategory } from "../../core/models";

// Mirrors backend services/battles.ts normalizePlayerName: "Last, First" is
// reordered, lowercased and whitespace-collapsed. Two cards of one player share
// this key (the same-player rule).
export function normalizePlayerName(name: string): string {
  const commaIdx = name.indexOf(",");
  const reordered = commaIdx === -1 ? name : `${name.slice(commaIdx + 1)} ${name.slice(0, commaIdx)}`;
  return reordered.toLowerCase().replace(/\s+/g, " ").trim();
}

// Mirrors backend duelEngine categoryValue / quarterScore.
export function categoryValue(base: DuelCard["base"], cat: DuelCategory): number {
  switch (cat) {
    case "scoring": return base.pts;
    case "boards": return base.reb;
    case "playmaking": return base.ast;
    case "defense": return base.stl + base.blk;
    case "efficiency": return base.pir;
    case "all_around": return base.pts + base.reb + base.ast;
  }
}

export function quarterScore(card: DuelCard, cat: DuelCategory, scales: Record<DuelCategory, number>): number {
  const raw = categoryValue(card.base, cat) * scales[cat] * card.rarityMult * card.formMult * card.injuryMult;
  return Math.round(raw * 10) / 10;
}
