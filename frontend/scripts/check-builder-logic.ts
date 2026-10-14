// Pure-logic checks for the Analytics Builder (no test suite in this repo).
// Run: cd backend && npx tsx ../frontend/scripts/check-builder-logic.ts
import { compileFormula, evaluateFormula } from "../src/app/features/analytics-builder/formula";
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

if (failures.length) {
  for (const f of failures) console.error("FAIL", f);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
