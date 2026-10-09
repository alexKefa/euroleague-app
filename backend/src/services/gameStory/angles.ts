// Game story cards (2026-10-09): pick the most remarkable angle of a final
// game. Pure (no database). Each angle is a candidate only past its
// threshold; its score is value / threshold, the highest wins, ties go in
// ANGLE_ORDER. "numbers" is the always-available fallback (score 0).
// Checked by scripts/check-game-story.ts.
import type {
  BenchData,
  GameFacts,
  LineFacts,
  LineupSummary,
  LineupTypeRow,
  Story,
  TeamFacts,
} from "./types.js";

export const BENCH_MIN_POINTS = 35;
export const BENCH_MIN_SHARE = 0.45;
export const LINEUP_MIN_PM = 10;
export const LINEUP_MIN_SECONDS = 360;
export const EXPLOSION_POINTS = 28;
export const EXPLOSION_PIR = 32;
export const COMEBACK_MIN = 12;
export const CLUTCH_MAX_MARGIN = 3;

const ANGLE_ORDER = ["bench", "lineup", "explosion", "comeback", "clutch"] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function winnerOf(f: GameFacts): TeamFacts {
  return f.home.score >= f.away.score ? f.home : f.away;
}

const teamLines = (f: GameFacts, teamId: string) => f.lines.filter((l) => l.teamId === teamId);
const hasStarterFlags = (lines: LineFacts[]) => lines.length > 0 && lines.every((l) => l.isStarter !== null);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Bench vs starters for one team, or null without starter flags. */
function benchSplit(f: GameFacts, teamId: string): { bench: number; starters: number } | null {
  const lines = teamLines(f, teamId);
  if (!hasStarterFlags(lines)) return null;
  return {
    bench: sum(lines.filter((l) => !l.isStarter).map((l) => l.points)),
    starters: sum(lines.filter((l) => l.isStarter).map((l) => l.points)),
  };
}

/** Each distinct five of the game, summed across its stints. */
function lineups(f: GameFacts): LineupSummary[] {
  type Acc = { teamId: string; codes: string[]; seconds: number; pf: number; pa: number; possFor: number; possAgainst: number };
  const byKey = new Map<string, Acc>();
  for (const s of f.stints) {
    const codes = [...s.playerCodes].sort();
    const key = `${s.teamId}|${codes.join(",")}`;
    const acc = byKey.get(key) ?? { teamId: s.teamId, codes, seconds: 0, pf: 0, pa: 0, possFor: 0, possAgainst: 0 };
    acc.seconds += s.seconds;
    acc.pf += s.ptsFor;
    acc.pa += s.ptsAgainst;
    acc.possFor += s.possFor;
    acc.possAgainst += s.possAgainst;
    byKey.set(key, acc);
  }
  const names = new Map(f.lines.map((l) => [l.playerCode, l.name]));
  return [...byKey.values()].map((a) => ({
    teamId: a.teamId,
    playerCodes: a.codes,
    names: a.codes.map((c) => names.get(c) ?? c),
    seconds: a.seconds,
    ptsFor: a.pf,
    ptsAgainst: a.pa,
    plusMinus: a.pf - a.pa,
    netRating: a.possFor > 0 && a.possAgainst > 0 ? round1(100 * (a.pf / a.possFor - a.pa / a.possAgainst)) : null,
    possessions: Math.round((a.possFor + a.possAgainst) / 2),
    startersOnCourt: startersOn(f, a.teamId, a.codes),
  }));
}

function startersOn(f: GameFacts, teamId: string, codes: string[]): number | null {
  const lines = teamLines(f, teamId);
  if (!hasStarterFlags(lines)) return null;
  const starters = new Set(lines.filter((l) => l.isStarter).map((l) => l.playerCode));
  return codes.filter((c) => starters.has(c)).length;
}

/** Plus-minus by how many of the team's starters were on court. */
export function lineupTypeRows(f: GameFacts, teamId: string): LineupTypeRow[] {
  const rows: LineupTypeRow[] = [
    { label: "0-1", seconds: 0, ptsFor: 0, ptsAgainst: 0 },
    { label: "2-3", seconds: 0, ptsFor: 0, ptsAgainst: 0 },
    { label: "4-5", seconds: 0, ptsFor: 0, ptsAgainst: 0 },
  ];
  for (const s of f.stints) {
    if (s.teamId !== teamId) continue;
    const n = startersOn(f, teamId, s.playerCodes);
    if (n === null) return [];
    const row = rows[n <= 1 ? 0 : n <= 3 ? 1 : 2];
    row.seconds += s.seconds;
    row.ptsFor += s.ptsFor;
    row.ptsAgainst += s.ptsAgainst;
  }
  return rows.filter((r) => r.seconds > 0);
}

function bestLineup(f: GameFacts): LineupSummary | null {
  const eligible = lineups(f).filter((l) => l.seconds >= LINEUP_MIN_SECONDS);
  eligible.sort((a, b) => b.plusMinus - a.plusMinus || b.seconds - a.seconds);
  return eligible[0] ?? null;
}

export function evaluateBench(f: GameFacts): Story | null {
  const w = winnerOf(f);
  const split = benchSplit(f, w.id);
  if (!split) return null;
  const team = split.bench + split.starters;
  const share = team > 0 ? split.bench / team : 0;
  if (split.bench < BENCH_MIN_POINTS && share < BENCH_MIN_SHARE) return null;
  const data: BenchData = {
    teamId: w.id,
    benchPoints: split.bench,
    starterPoints: split.starters,
    teamPoints: team,
    share,
    scorers: teamLines(f, w.id)
      .filter((l) => !l.isStarter && (l.points > 0 || (l.minutes ?? 1) > 0))
      .sort((a, b) => b.points - a.points),
    byType: lineupTypeRows(f, w.id),
  };
  return { angle: "bench", score: Math.max(split.bench / BENCH_MIN_POINTS, share / BENCH_MIN_SHARE), data };
}

export function evaluateLineup(f: GameFacts): Story | null {
  const best = bestLineup(f);
  if (!best || best.plusMinus < LINEUP_MIN_PM) return null;
  return { angle: "lineup", score: best.plusMinus / LINEUP_MIN_PM, data: { lineup: best, byType: lineupTypeRows(f, best.teamId) } };
}

export function evaluateExplosion(f: GameFacts): Story | null {
  let pick: { line: LineFacts; stat: "points" | "pir"; ratio: number } | null = null;
  for (const l of f.lines) {
    const p = l.points / EXPLOSION_POINTS;
    const r = l.pir / EXPLOSION_PIR;
    const stat = p >= r ? "points" : "pir";
    const ratio = Math.max(p, r);
    if (ratio >= 1 && (!pick || ratio > pick.ratio)) pick = { line: l, stat, ratio };
  }
  if (!pick) return null;
  const value = pick.stat === "points" ? pick.line.points : pick.line.pir;
  const prev = pick.stat === "points" ? pick.line.prevHighPoints : pick.line.prevHighPir;
  return {
    angle: "explosion",
    score: pick.ratio,
    data: { line: pick.line, stat: pick.stat, value, careerHigh: prev !== null && value > prev },
  };
}

export function evaluateComeback(f: GameFacts): Story | null {
  if (f.margins.length === 0) return null;
  const w = winnerOf(f);
  const sign = w.id === f.home.id ? 1 : -1;
  const margins = f.margins.map((m) => ({ t: m.t, margin: m.margin * sign }));
  const low = margins.reduce((a, b) => (b.margin < a.margin ? b : a));
  const deficit = -low.margin;
  if (deficit < COMEBACK_MIN) return null;
  return {
    angle: "comeback",
    score: deficit / COMEBACK_MIN,
    data: { teamId: w.id, deficit, finalMargin: Math.abs(f.home.score - f.away.score), margins, lowAt: low.t },
  };
}

export function evaluateClutch(f: GameFacts): Story | null {
  const margin = Math.abs(f.home.score - f.away.score);
  if (margin > CLUTCH_MAX_MARGIN && !f.overtime) return null;
  const base = margin <= CLUTCH_MAX_MARGIN ? CLUTCH_MAX_MARGIN / Math.max(margin, 1) : 0;
  const hero = [...f.clutchPoints].sort((a, b) => b.points - a.points)[0] ?? null;
  return {
    angle: "clutch",
    score: base + (f.overtime ? 1 : 0),
    data: { margin, overtime: f.overtime, hero, plays: f.clutchPlays.slice(-5) },
  };
}

function numbers(f: GameFacts): Story {
  const top = (teamId: string) => [...teamLines(f, teamId)].sort((a, b) => b.points - a.points)[0] ?? null;
  return {
    angle: "numbers",
    score: 0,
    data: {
      topScorers: { home: top(f.home.id), away: top(f.away.id) },
      bench: { home: benchSplit(f, f.home.id), away: benchSplit(f, f.away.id) },
      bestLineup: bestLineup(f),
    },
  };
}

export function pickStory(f: GameFacts): Story {
  const evaluators = { bench: evaluateBench, lineup: evaluateLineup, explosion: evaluateExplosion, comeback: evaluateComeback, clutch: evaluateClutch };
  let best: Story | null = null;
  for (const angle of ANGLE_ORDER) {
    const s = evaluators[angle](f);
    if (s && (!best || s.score > best.score)) best = s;
  }
  return best ?? numbers(f);
}
