import type { PlayerGameLogEntry } from "../../core/models";

/**
 * Pure stat logic behind the share cards (2026-10-07,
 * docs/superpowers/specs/2026-10-07-share-cards-design.md). No Angular
 * imports, so frontend/scripts/check-share-card.ts runs it under Node.
 */

export type StatKey = "pts" | "reb" | "ast" | "stl" | "blk" | "tov" | "pir" | "min" | "twoPct" | "threePct" | "ftPct";

export const STAT_KEYS: StatKey[] = ["pts", "reb", "ast", "stl", "blk", "tov", "pir", "min", "twoPct", "threePct", "ftPct"];

export const STAT_LABELS: Record<StatKey, string> = {
  pts: "PTS", reb: "REB", ast: "AST", stl: "STL", blk: "BLK", tov: "TOV", pir: "PIR", min: "MIN",
  twoPct: "2P%", threePct: "3P%", ftPct: "FT%",
};

export const DEFAULT_STATS: StatKey[] = ["pts", "reb", "ast", "pir"];

export type Period = { kind: "season" } | { kind: "last5" } | { kind: "lastGame" } | { kind: "vsTeam"; teamId: string };

export interface StatLine {
  games: number;
  values: Record<StatKey, number | null>;
  single: boolean;
}

const PCT_KEYS = new Set<StatKey>(["twoPct", "threePct", "ftPct"]);

/** Games the player actually played in (minutes > 0), newest first. */
export function playedGames(rows: PlayerGameLogEntry[]): PlayerGameLogEntry[] {
  return rows
    .filter((r) => (r.stats.minutes ?? 0) > 0)
    .sort((a, b) => Date.parse(b.game.tipoffAt) - Date.parse(a.game.tipoffAt));
}

function opponentOf(row: PlayerGameLogEntry, playerTeamId: string) {
  return row.game.homeTeam.id === playerTeamId ? row.game.awayTeam : row.game.homeTeam;
}

export function gamesForPeriod(rows: PlayerGameLogEntry[], period: Period, playerTeamId: string): PlayerGameLogEntry[] {
  const played = playedGames(rows);
  switch (period.kind) {
    case "season":
      return played;
    case "last5":
      return played.slice(0, 5);
    case "lastGame":
      return played.slice(0, 1);
    case "vsTeam":
      return played.filter((r) => opponentOf(r, playerTeamId).id === period.teamId);
  }
}

export function opponentsFaced(rows: PlayerGameLogEntry[], playerTeamId: string): { id: string; code: string; name: string }[] {
  const byId = new Map<string, { id: string; code: string; name: string }>();
  for (const r of playedGames(rows)) {
    const o = opponentOf(r, playerTeamId);
    byId.set(o.id, { id: o.id, code: o.code, name: o.name });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function computeLine(games: PlayerGameLogEntry[], single: boolean): StatLine {
  const count = games.length;
  const sum = (pick: (s: PlayerGameLogEntry["stats"]) => number | null) => games.reduce((t, g) => t + (pick(g.stats) ?? 0), 0);
  const avg = (pick: (s: PlayerGameLogEntry["stats"]) => number | null) => (count ? sum(pick) / count : null);
  // Percentages come from totals over the period, not an average of per-game percentages.
  const pct = (made: (s: PlayerGameLogEntry["stats"]) => number | null, att: (s: PlayerGameLogEntry["stats"]) => number | null) => {
    const a = sum(att);
    return count && a > 0 ? (sum(made) / a) * 100 : null;
  };
  return {
    games: count,
    single,
    values: {
      pts: avg((s) => s.points),
      reb: avg((s) => s.rebounds),
      ast: avg((s) => s.assists),
      stl: avg((s) => s.steals),
      blk: avg((s) => s.blocksFavour),
      tov: avg((s) => s.turnovers),
      pir: avg((s) => s.valuation),
      min: avg((s) => s.minutes),
      twoPct: pct((s) => s.fieldGoalsMade2, (s) => s.fieldGoalsAttempted2),
      threePct: pct((s) => s.fieldGoalsMade3, (s) => s.fieldGoalsAttempted3),
      ftPct: pct((s) => s.freeThrowsMade, (s) => s.freeThrowsAttempted),
    },
  };
}

export function formatValue(key: StatKey, value: number | null, single: boolean): string {
  if (value === null || Number.isNaN(value)) return "–";
  if (PCT_KEYS.has(key)) return `${Math.round(value)}%`;
  return single ? String(Math.round(value)) : value.toFixed(1);
}

/** Which side wins a head-to-head line: higher is better, except turnovers. */
export function winner(key: StatKey, a: number | null, b: number | null): "a" | "b" | null {
  if (a === null && b === null) return null;
  if (a === null) return "b";
  if (b === null) return "a";
  if (a === b) return null;
  const aBetter = key === "tov" ? a < b : a > b;
  return aBetter ? "a" : "b";
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());

/** Feed names come as "SURNAME, FIRST". */
export function splitName(feedName: string): { first: string; last: string } {
  const comma = feedName.indexOf(",");
  if (comma === -1) return { first: "", last: titleCase(feedName.trim()) };
  return { first: titleCase(feedName.slice(comma + 1).trim()), last: titleCase(feedName.slice(0, comma).trim()) };
}
