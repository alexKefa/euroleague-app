// Pure-logic checks for the Analytics Builder (no test suite in this repo).
// Run: cd backend && npx tsx ../frontend/scripts/check-builder-logic.ts
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

if (failures.length) {
  for (const f of failures) console.error("FAIL", f);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
