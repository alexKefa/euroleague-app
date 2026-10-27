// Pure decision logic for album Series 2 "Moments" (2026-10-27): which
// performances become cards, when a round is ready, and the Series 1 first
// rule for guaranteed-new pulls. No db imports, so it runs under plain tsx
// in momentsLogic.test.ts. The db side lives in services/moments.ts.
// Spec: docs/superpowers/specs/2026-10-27-album-series-2-moments-design.md

/** Cards created per round: the MVP as a legendary, the next five as rares. */
export const MOMENTS_PER_ROUND = { legendary: 1, rare: 5 } as const;

/** 2027-01-01 00:00 Europe/Athens (UTC+2 in winter). */
export const MOMENTS_LAUNCH_AT = new Date("2026-12-31T22:00:00Z");

export function isMomentsLaunched(now: Date): boolean {
  return now.getTime() >= MOMENTS_LAUNCH_AT.getTime();
}

/** Feed name to card name: "PETERS, ALEC" -> "Alec Peters", same rule the catalog scripts use. */
export function formatPlayerName(rawName: string): string {
  const [last, first] = rawName.split(",").map((s) => s.trim());
  if (!first) return rawName;
  const toTitle = (s: string) =>
    s
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
  return `${toTitle(first)} ${toTitle(last)}`;
}

export interface PlayerLine {
  playerId: string;
  teamId: string;
  gameId: string;
  pir: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  minutes: number | null;
}

export interface RoundGame {
  gameId: string;
  tipoffAt: Date;
  status: string;
  hasStats: boolean;
}

// PIR, then points, then minutes (nulls lowest), then player id so the
// order is deterministic.
function compareLines(a: PlayerLine, b: PlayerLine): number {
  const n = (v: number | null) => v ?? -Infinity;
  return n(b.pir) - n(a.pir) || n(b.points) - n(a.points) || n(b.minutes) - n(a.minutes) || a.playerId.localeCompare(b.playerId);
}

/**
 * The round's moment cards, MVP first. A player with two games in the round
 * (double-round weeks) counts once, with their best line.
 */
export function pickRoundMoments(
  lines: PlayerLine[],
  perRound: { legendary: number; rare: number }
): { line: PlayerLine; role: "mvp" | "top" }[] {
  const best = new Map<string, PlayerLine>();
  for (const l of lines) {
    const cur = best.get(l.playerId);
    if (!cur || compareLines(l, cur) < 0) best.set(l.playerId, l);
  }
  return [...best.values()]
    .sort(compareLines)
    .slice(0, perRound.legendary + perRound.rare)
    .map((line, i) => ({ line, role: i < perRound.legendary ? "mvp" : "top" }));
}

const POSTPONED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_GAMES_AFTER_GRACE = 8;

/**
 * A round is ready once every game is final with box-score stats, or 7 days
 * after its last scheduled tipoff with at least 8 games final with stats (a
 * postponed game's performances are then left out). `gameIds` are the
 * games whose lines count.
 */
export function isRoundReady(games: RoundGame[], now: Date): { ready: boolean; gameIds: string[] } {
  const done = games.filter((g) => g.status === "final" && g.hasStats).map((g) => g.gameId);
  if (games.length === 0) return { ready: false, gameIds: [] };
  if (done.length === games.length) return { ready: true, gameIds: done };
  const lastTipoff = Math.max(...games.map((g) => g.tipoffAt.getTime()));
  const ready = now.getTime() - lastTipoff >= POSTPONED_GRACE_MS && done.length >= MIN_GAMES_AFTER_GRACE;
  return { ready, gameIds: ready ? done : [] };
}

/**
 * Series 1 first: from the cards a guaranteed-new pull could land on, keep
 * only Series 1 while any are left, so Series 2 can't make Series 1
 * unfinishable.
 */
export function pickSeriesFirst<T>(missing: T[], seriesOf: (item: T) => number): T[] {
  const s1 = missing.filter((m) => seriesOf(m) === 1);
  return s1.length > 0 ? s1 : missing;
}
