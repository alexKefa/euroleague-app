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

// Some synced box scores have no minutes at all (null). Null means unknown,
// not "didn't play": such a row counts when it has any stat in it. Only an
// explicit 0, or an empty null-minutes line, is a did-not-play row.
function played(r: PlayerGameLogEntry): boolean {
  const s = r.stats;
  if (s.minutes !== null) return s.minutes > 0;
  return [s.points, s.rebounds, s.assists, s.steals, s.blocksFavour, s.turnovers, s.valuation, s.fieldGoalsAttempted2, s.fieldGoalsAttempted3, s.freeThrowsAttempted].some(
    (v) => v !== null && v !== 0
  );
}

/** Games the player actually played in, newest first. */
export function playedGames(rows: PlayerGameLogEntry[]): PlayerGameLogEntry[] {
  return rows
    .filter(played)
    .sort((a, b) => Date.parse(b.game.tipoffAt) - Date.parse(a.game.tipoffAt));
}

// The game log has no per-row team, and the player's *current* team is wrong
// for last season's games or after a transfer. The player's own club shows up
// in nearly every row, each opponent only once or twice, so the more frequent
// side of each game is the player's. The current team only breaks ties.
function sideCounts(rows: PlayerGameLogEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const id of [r.game.homeTeam.id, r.game.awayTeam.id]) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function opponentOf(row: PlayerGameLogEntry, counts: Map<string, number>, playerTeamId: string) {
  const home = counts.get(row.game.homeTeam.id) ?? 0;
  const away = counts.get(row.game.awayTeam.id) ?? 0;
  const playerIsHome = home !== away ? home > away : row.game.homeTeam.id === playerTeamId;
  return playerIsHome ? row.game.awayTeam : row.game.homeTeam;
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
    case "vsTeam": {
      const counts = sideCounts(played);
      return played.filter((r) => opponentOf(r, counts, playerTeamId).id === period.teamId);
    }
  }
}

/** The opponent in one game of this log (for labels like "Last game · vs X"). */
export function opponentInGame(rows: PlayerGameLogEntry[], row: PlayerGameLogEntry, playerTeamId: string) {
  return opponentOf(row, sideCounts(playedGames(rows)), playerTeamId);
}

export function opponentsFaced(rows: PlayerGameLogEntry[], playerTeamId: string): { id: string; code: string; name: string }[] {
  const byId = new Map<string, { id: string; code: string; name: string }>();
  const played = playedGames(rows);
  const counts = sideCounts(played);
  for (const r of played) {
    const o = opponentOf(r, counts, playerTeamId);
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
      // Averaged only over games that recorded minutes; null when none did.
      min: (() => {
        const withMin = games.filter((g) => g.stats.minutes !== null);
        return withMin.length ? withMin.reduce((t, g) => t + (g.stats.minutes ?? 0), 0) / withMin.length : null;
      })(),
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
