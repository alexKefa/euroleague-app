import type { PlayerSeasonStats } from "../core/models";

/**
 * Every per-player season stat the advanced-stats payload carries, in one
 * place (2026-10-14): the Analytics Builder's column picker, formula
 * identifiers, legend and percentiles all read from here. Kept free of
 * Angular imports so the builder's logic check script can load it.
 */
export type StatKey = Exclude<keyof PlayerSeasonStats, "playerId" | "teamId" | "season">;
export type StatGroup = "scoring" | "shooting" | "playmaking" | "rebounding" | "defense" | "usage";
export type StatFormat = "int" | "dec1" | "pct";

export interface StatDef {
  key: StatKey;
  // Formula identifier; uppercase and identifier-safe (FG_PCT, not FG%).
  alias: string;
  labelKey: string;
  legendKey: string;
  group: StatGroup;
  format: StatFormat;
  lowerIsBetter?: boolean;
  // False for counts that aren't a quality measure (games played).
  percentiled: boolean;
}

export const STAT_GROUPS: readonly StatGroup[] = ["scoring", "shooting", "playmaking", "rebounding", "defense", "usage"];

const def = (
  key: StatKey,
  alias: string,
  labelKey: string,
  legendKey: string,
  group: StatGroup,
  format: StatFormat,
  extra: { lowerIsBetter?: boolean; percentiled?: boolean } = {}
): StatDef => ({ key, alias, labelKey, legendKey, group, format, lowerIsBetter: extra.lowerIsBetter, percentiled: extra.percentiled ?? true });

export const STAT_CATALOG: readonly StatDef[] = [
  def("gamesPlayed", "GP", "stats.colGp", "builder.legendGamesPlayed", "scoring", "int", { percentiled: false }),
  def("minutesPerGame", "MIN", "stats.colMin", "builder.legendMinutesPerGame", "scoring", "dec1"),
  def("pointsPerGame", "PTS", "stats.colPts", "builder.legendPointsPerGame", "scoring", "dec1"),
  def("reboundsPerGame", "REB", "builder.stat.REB", "builder.legendReboundsPerGame", "rebounding", "dec1"),
  def("assistsPerGame", "AST", "builder.stat.AST", "builder.legendAssistsPerGame", "playmaking", "dec1"),
  def("stealsPerGame", "STL", "builder.stat.STL", "builder.legendStealsPerGame", "defense", "dec1"),
  def("blocksPerGame", "BLK", "builder.stat.BLK", "builder.legendBlocksPerGame", "defense", "dec1"),
  def("turnoversPerGame", "TOV", "builder.stat.TOV", "builder.legendTurnoversPerGame", "playmaking", "dec1", { lowerIsBetter: true }),
  def("fieldGoalPct", "FG_PCT", "builder.stat.FG_PCT", "builder.legendFieldGoalPct", "shooting", "pct"),
  def("threePointPct", "TP_PCT", "builder.stat.TP_PCT", "builder.legendThreePointPct", "shooting", "pct"),
  def("freeThrowPct", "FT_PCT", "builder.stat.FT_PCT", "builder.legendFreeThrowPct", "shooting", "pct"),
  def("valuation", "PIR", "stats.colPir", "builder.legendValuation", "scoring", "dec1"),
  def("effectiveFieldGoalPct", "EFG_PCT", "stats.colEfg", "builder.legendEffectiveFieldGoalPct", "shooting", "pct"),
  def("trueShootingPct", "TS_PCT", "stats.colTs", "builder.legendTrueShootingPct", "shooting", "pct"),
  def("offensiveReboundPct", "OREB_PCT", "stats.colOreb", "builder.legendOffensiveReboundPct", "rebounding", "pct"),
  def("defensiveReboundPct", "DREB_PCT", "stats.colDreb", "builder.legendDefensiveReboundPct", "rebounding", "pct"),
  def("totalReboundPct", "TREB_PCT", "builder.stat.TREB_PCT", "builder.legendTotalReboundPct", "rebounding", "pct"),
  def("assistToTurnoverRatio", "AST_TO", "stats.colAstTo", "builder.legendAssistToTurnoverRatio", "playmaking", "dec1"),
  def("assistRatio", "AST_RATIO", "builder.stat.AST_RATIO", "builder.legendAssistRatio", "playmaking", "pct"),
  def("turnoverRatio", "TOV_RATIO", "stats.colTov", "builder.legendTurnoverRatio", "playmaking", "pct", { lowerIsBetter: true }),
  def("twoPointAttemptRate", "TWO_PA_RATE", "builder.stat.TWO_PA_RATE", "builder.legendTwoPointAttemptRate", "shooting", "pct"),
  def("threePointAttemptRate", "THREE_PA_RATE", "builder.stat.THREE_PA_RATE", "builder.legendThreePointAttemptRate", "shooting", "pct"),
  def("freeThrowRate", "FT_RATE", "builder.stat.FT_RATE", "builder.legendFreeThrowRate", "shooting", "pct"),
  def("possessionsPerGame", "POSS", "stats.colPace", "builder.legendPossessionsPerGame", "usage", "dec1"),
  def("usagePercentage", "USG", "stats.colUsg", "builder.legendUsagePercentage", "usage", "pct"),
];

const BY_KEY = new Map<string, StatDef>(STAT_CATALOG.map((s) => [s.key, s]));
const BY_ALIAS = new Map<string, StatDef>(STAT_CATALOG.map((s) => [s.alias, s]));

export function statByKey(key: string): StatDef | undefined {
  return BY_KEY.get(key);
}

export function statByAlias(alias: string): StatDef | undefined {
  return BY_ALIAS.get(alias.toUpperCase());
}

export function formatStat(format: StatFormat, v: number | null): string {
  if (v == null) return "—";
  if (format === "int") return String(Math.round(v));
  if (format === "pct") return `${v.toFixed(1)}%`;
  return v.toFixed(1);
}
