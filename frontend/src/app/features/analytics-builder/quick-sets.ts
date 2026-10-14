import type { PlayerAdvancedStatsRow } from "../../core/models";
import { selectPool } from "./percentiles";

export const QUICK_SET_SIZE = 5;

export function topByPir(rows: readonly PlayerAdvancedStatsRow[], n = QUICK_SET_SIZE): string[] {
  return [...rows]
    .sort((a, b) => (b.stats.valuation ?? -Infinity) - (a.stats.valuation ?? -Infinity))
    .slice(0, n)
    .map((r) => r.player.id);
}

// Top 5 by PIR at a position, drawn from the same pool as percentiles:
// rotation players once enough qualify, everyone who has played before then.
export function positionSet(rows: readonly PlayerAdvancedStatsRow[], position: string): string[] {
  return topByPir(selectPool(rows).filter((r) => r.player.position === position));
}
