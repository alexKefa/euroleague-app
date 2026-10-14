import type { PlayerAdvancedStatsRow } from "../../core/models";

// League context for the builder's table tint and chart bars: where a value
// sits among regular rotation players, not among the handful selected.
const MIN_GAMES = 5;
const MIN_MINUTES = 10;
const MIN_POOL = 40;

// Rotation players only; early in the season, when too few qualify,
// everyone who has played at all.
export function selectPool(rows: readonly PlayerAdvancedStatsRow[]): PlayerAdvancedStatsRow[] {
  const regulars = rows.filter((r) => (r.stats.gamesPlayed ?? 0) >= MIN_GAMES && (r.stats.minutesPerGame ?? 0) >= MIN_MINUTES);
  return regulars.length >= MIN_POOL ? regulars : rows.filter((r) => (r.stats.gamesPlayed ?? 0) >= 1);
}

export function sortedValues(pool: readonly PlayerAdvancedStatsRow[], get: (r: PlayerAdvancedStatsRow) => number | null): number[] {
  const values: number[] = [];
  for (const row of pool) {
    const v = get(row);
    if (v != null && Number.isFinite(v)) values.push(v);
  }
  return values.sort((a, b) => a - b);
}

// First index whose value is >= (strict=false) or > (strict=true) target.
function bound(sorted: readonly number[], target: number, strict: boolean): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strict ? sorted[mid] <= target : sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Mid-rank percentile, 0–100; ties count half. Inverted before rounding
// for stats where lower is better.
export function percentileOf(sorted: readonly number[], value: number | null, lowerIsBetter: boolean): number | null {
  if (value == null || sorted.length === 0) return null;
  const below = bound(sorted, value, false);
  const equal = bound(sorted, value, true) - below;
  const raw = ((below + 0.5 * equal) / sorted.length) * 100;
  return Math.round(lowerIsBetter ? 100 - raw : raw);
}

export function topPercent(pct: number): number {
  return Math.max(1, 100 - pct);
}
