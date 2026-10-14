// Pure-logic checks for the Analytics Builder (no test suite in this repo).
// Run: cd backend && npx tsx ../frontend/scripts/check-builder-logic.ts
import { compileFormula, evaluateFormula } from "../src/app/features/analytics-builder/formula";
import { percentileOf, selectPool, sortedValues, topPercent } from "../src/app/features/analytics-builder/percentiles";
import type { PlayerAdvancedStatsRow } from "../src/app/core/models";
import { STAT_CATALOG, formatStat, statByAlias, statByKey } from "../src/app/shared/stat-catalog";

const failures: string[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
function eq(actual: unknown, expected: unknown): void {
  if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(value: unknown): void {
  if (!value) throw new Error(`expected truthy, got ${JSON.stringify(value)}`);
}

// --- Stat catalog ---
check("catalog has 25 stats", () => eq(STAT_CATALOG.length, 25));
check("aliases unique + identifier-safe", () => {
  const a = STAT_CATALOG.map((s) => s.alias);
  eq(new Set(a).size, a.length);
  ok(a.every((x) => /^[A-Z][A-Z0-9_]*$/.test(x)));
});
check("alias lookup is case-insensitive", () => eq(statByAlias("reb")?.key, "reboundsPerGame"));
check("gamesPlayed not percentiled", () => eq(statByKey("gamesPlayed")?.percentiled, false));
check("turnovers lower is better", () => {
  ok(statByKey("turnoversPerGame")?.lowerIsBetter);
  ok(statByKey("turnoverRatio")?.lowerIsBetter);
});
check("formatStat", () => {
  eq(formatStat("pct", 45.61), "45.6%");
  eq(formatStat("dec1", 12.34), "12.3");
  eq(formatStat("int", 12), "12");
  eq(formatStat("dec1", null), "—");
});

// --- Formulas ---
const ctx = { pointsPerGame: 16, reboundsPerGame: 3, assistsPerGame: 6, minutesPerGame: 32, stealsPerGame: 1, blocksPerGame: null };
const run = (src: string) => {
  const c = compileFormula(src);
  if ("error" in c) throw new Error(c.error.code);
  return evaluateFormula(c.node, ctx);
};
check("alias formula", () => eq(run("PTS + REB + AST"), 25));
check("lowercase alias", () => eq(run("pts / min * 40"), 20));
check("legacy camelCase still works", () => eq(run("pointsPerGame + assistsPerGame"), 22));
check("null propagates", () => eq(run("STL + BLK"), null));
check("divide by zero → null", () => eq(run("PTS / 0"), null));
const err = (src: string) => {
  const c = compileFormula(src);
  return "error" in c ? c.error : null;
};
check("unknown field code", () => {
  const e = err("PTS + FOO");
  eq(e?.code, "unknownField");
  eq(e?.params?.text, "FOO");
});
check("empty", () => eq(err("  ")?.code, "empty"));
check("missing paren", () => eq(err("(PTS + REB")?.code, "missingParen"));
check("ends early", () => eq(err("PTS +")?.code, "endsEarly"));
check("trailing text", () => eq(err("PTS REB")?.code, "trailingText"));
check("bad char", () => eq(err("PTS % 2")?.code, "unexpectedChar"));

// --- Percentiles ---
function fakeRows(values: (number | null)[], opts: { gp?: number; min?: number } = {}): PlayerAdvancedStatsRow[] {
  return values.map((v, i) => ({
    player: { id: "p" + i, name: "P" + i },
    team: { id: "t" },
    stats: { pointsPerGame: v, gamesPlayed: opts.gp ?? 6, minutesPerGame: opts.min ?? 20 },
  })) as unknown as PlayerAdvancedStatsRow[];
}
check("percentile mid", () => eq(percentileOf([1, 2, 3, 4], 3, false), 63));
check("percentile max", () => eq(percentileOf([1, 2, 3, 4], 4, false), 88));
check("lower is better inverts", () => eq(percentileOf([1, 2, 3, 4], 1, true), 88));
check("value outside pool", () => {
  eq(percentileOf([1, 2, 3], 10, false), 100);
  eq(percentileOf([1, 2, 3], 0, false), 0);
});
check("null value", () => eq(percentileOf([1, 2], null, false), null));
check("empty pool", () => eq(percentileOf([], 5, false), null));
check("sortedValues drops nulls", () => eq(sortedValues(fakeRows([3, null, 1]), (r) => r.stats.pointsPerGame).join(), "1,3"));
check("pool fallback below 40", () => eq(selectPool(fakeRows(Array(10).fill(10), { gp: 6, min: 20 })).length, 10));
check("pool filters when 40+ qualify", () => {
  const rows = [...fakeRows(Array(40).fill(10), { gp: 6, min: 20 }), ...fakeRows([10], { gp: 2, min: 20 })];
  eq(selectPool(rows).length, 40);
});
check("fallback pool drops 0-game rows", () => eq(selectPool([...fakeRows([1, 2]), ...fakeRows([3], { gp: 0 })]).length, 2));
check("topPercent floor", () => {
  eq(topPercent(100), 1);
  eq(topPercent(92), 8);
});

if (failures.length) {
  for (const f of failures) console.error("FAIL", f);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
