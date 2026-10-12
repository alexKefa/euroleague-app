// Game story cards (2026-10-09): pick the most remarkable angle of a final
// game. Pure (no database). Each angle is a candidate only past its
// threshold; its score is value / threshold, the highest wins, ties go in
// ANGLE_ORDER. "numbers" is the always-available fallback (score 0).
// Every story also carries a key note: what won the game (2026-10-12).
// Checked by scripts/check-game-story.ts.
import type {
  EdgeData,
  EdgeKey,
  GameFacts,
  KeyNote,
  LineFacts,
  LineupSummary,
  Story,
  StoryBody,
  TapeRow,
  TeamFacts,
} from "./types.js";

export const LINEUP_MIN_PM = 10;
export const LINEUP_MIN_SECONDS = 360;
export const EXPLOSION_POINTS = 28;
export const EXPLOSION_PIR = 32;
export const COMEBACK_MIN = 12;
export const CLUTCH_MAX_MARGIN = 3;

// An edge's threshold: the winner's margin in that stat that makes it the
// story of the game (ratio 1). Calibrated to EuroLeague box scores, where
// e.g. a 5-three edge is 15 points and a 12-0 run is rare.
export const EDGE_THRESHOLD: Record<EdgeKey, number> = {
  run: 12,
  quarter: 12,
  threes: 5,
  boards: 10,
  turnovers: 6,
  freeThrows: 9,
  assists: 9,
  shooting: 12, // FG% points
};
// Below this ratio an edge is too small to be "what won it"; the strip
// names the winner's leader instead.
export const KEY_NOTE_MIN_RATIO = 0.5;

const ANGLE_ORDER = ["edge", "lineup", "explosion", "comeback", "clutch"] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function winnerOf(f: GameFacts): TeamFacts {
  return f.home.score >= f.away.score ? f.home : f.away;
}
export function loserOf(f: GameFacts): TeamFacts {
  return winnerOf(f).id === f.home.id ? f.away : f.home;
}

const teamLines = (f: GameFacts, teamId: string) => f.lines.filter((l) => l.teamId === teamId);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

interface Totals {
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  reb: number;
  ast: number;
  tov: number;
}

function totals(f: GameFacts, teamId: string): Totals | null {
  const ls = teamLines(f, teamId);
  if (ls.length === 0) return null;
  const s = (k: keyof LineFacts) => sum(ls.map((l) => Number(l[k]) || 0));
  return {
    fgm: s("fg2m") + s("fg3m"),
    fga: s("fg2a") + s("fg3a"),
    fg3m: s("fg3m"),
    fg3a: s("fg3a"),
    ftm: s("ftm"),
    fta: s("fta"),
    reb: s("rebounds"),
    ast: s("assists"),
    tov: s("turnovers"),
  };
}

const pct = (m: number, a: number) => (a > 0 ? Math.round((100 * m) / a) : 0);

/** Every edge the winner had, biggest ratio first. */
export function edges(f: GameFacts): EdgeData[] {
  const w = winnerOf(f);
  const l = loserOf(f);
  const out: EdgeData[] = [];
  const add = (key: EdgeKey, winner: number, loser: number, diff: number, period: number | null = null) => {
    if (diff > 0) out.push({ key, winner, loser, diff, ratio: diff / EDGE_THRESHOLD[key], period });
  };

  const run = f.runs.filter((r) => r.teamId === w.id).sort((a, b) => b.points - a.points)[0];
  if (run) {
    const theirs = Math.max(0, ...f.runs.filter((r) => r.teamId === l.id).map((r) => r.points));
    add("run", run.points, theirs, run.points, run.period);
  }

  const wq = w.id === f.home.id ? f.quarters.home : f.quarters.away;
  const lq = w.id === f.home.id ? f.quarters.away : f.quarters.home;
  let best: { i: number; diff: number } | null = null;
  for (let i = 0; i < Math.min(wq.length, lq.length); i++) {
    const diff = wq[i] - lq[i];
    if (!best || diff > best.diff) best = { i, diff };
  }
  if (best) add("quarter", wq[best.i], lq[best.i], best.diff, best.i + 1);

  const tw = totals(f, w.id);
  const tl = totals(f, l.id);
  if (tw && tl) {
    add("threes", tw.fg3m, tl.fg3m, tw.fg3m - tl.fg3m);
    add("boards", tw.reb, tl.reb, tw.reb - tl.reb);
    add("turnovers", tw.tov, tl.tov, tl.tov - tw.tov);
    add("freeThrows", tw.ftm, tl.ftm, tw.ftm - tl.ftm);
    add("assists", tw.ast, tl.ast, tw.ast - tl.ast);
    const pw = pct(tw.fgm, tw.fga);
    const pl = pct(tl.fgm, tl.fga);
    add("shooting", pw, pl, pw - pl);
  }
  // Stable: ties keep the order above (runs and quarters first).
  return out.sort((a, b) => b.ratio - a.ratio);
}

/** Winner vs loser across the box score, for the comparison bars. */
export function tape(f: GameFacts): TapeRow[] {
  const tw = totals(f, winnerOf(f).id);
  const tl = totals(f, loserOf(f).id);
  if (!tw || !tl) return [];
  const row = (key: TapeRow["key"], w: number, l: number, winner: string, loser: string, lowerIsBetter = false): TapeRow => {
    const share = w + l > 0 ? w / (w + l) : 0.5;
    return { key, winner, loser, winnerShare: lowerIsBetter ? 1 - share : share, winnerBetter: lowerIsBetter ? w < l : w > l };
  };
  return [
    row("shooting", pct(tw.fgm, tw.fga), pct(tl.fgm, tl.fga), `${pct(tw.fgm, tw.fga)}%`, `${pct(tl.fgm, tl.fga)}%`),
    row("threes", tw.fg3m, tl.fg3m, `${tw.fg3m}/${tw.fg3a}`, `${tl.fg3m}/${tl.fg3a}`),
    row("boards", tw.reb, tl.reb, String(tw.reb), String(tl.reb)),
    row("assists", tw.ast, tl.ast, String(tw.ast), String(tl.ast)),
    row("turnovers", tw.tov, tl.tov, String(tw.tov), String(tl.tov), true),
    row("freeThrows", tw.ftm, tl.ftm, `${tw.ftm}/${tw.fta}`, `${tl.ftm}/${tl.fta}`),
  ];
}

/** The winner's best player on the night, by PIR then points. */
export function leaderOf(f: GameFacts): LineFacts | null {
  return [...teamLines(f, winnerOf(f).id)].sort((a, b) => b.pir - a.pir || b.points - a.points)[0] ?? null;
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
  }));
}

function bestLineup(f: GameFacts): LineupSummary | null {
  const eligible = lineups(f).filter((l) => l.seconds >= LINEUP_MIN_SECONDS);
  eligible.sort((a, b) => b.plusMinus - a.plusMinus || b.seconds - a.seconds);
  return eligible[0] ?? null;
}

export function evaluateEdge(f: GameFacts): StoryBody | null {
  const top = edges(f)[0];
  if (!top || top.ratio < 1) return null;
  return { angle: "edge", score: top.ratio, data: { ...top, tape: tape(f) } };
}

export function evaluateLineup(f: GameFacts): StoryBody | null {
  const best = bestLineup(f);
  if (!best || best.plusMinus < LINEUP_MIN_PM) return null;
  return { angle: "lineup", score: best.plusMinus / LINEUP_MIN_PM, data: { lineup: best, tape: tape(f) } };
}

export function evaluateExplosion(f: GameFacts): StoryBody | null {
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

export function evaluateComeback(f: GameFacts): StoryBody | null {
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

export function evaluateClutch(f: GameFacts): StoryBody | null {
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

function numbers(f: GameFacts): StoryBody {
  const top = (teamId: string) => [...teamLines(f, teamId)].sort((a, b) => b.points - a.points)[0] ?? null;
  return {
    angle: "numbers",
    score: 0,
    data: { topScorers: { home: top(f.home.id), away: top(f.away.id) }, tape: tape(f) },
  };
}

/** What won it: the winner's top edge, unless that is already the headline. */
export function keyNoteFor(f: GameFacts, body: StoryBody): KeyNote | null {
  if (body.angle !== "edge") {
    const top = edges(f)[0];
    if (top && top.ratio >= KEY_NOTE_MIN_RATIO) return { kind: "edge", edge: top };
  }
  const leader = leaderOf(f);
  return leader ? { kind: "leader", line: leader } : null;
}

export function pickStory(f: GameFacts): Story {
  const evaluators = { edge: evaluateEdge, lineup: evaluateLineup, explosion: evaluateExplosion, comeback: evaluateComeback, clutch: evaluateClutch };
  let best: StoryBody | null = null;
  for (const angle of ANGLE_ORDER) {
    const s = evaluators[angle](f);
    if (s && (!best || s.score > best.score)) best = s;
  }
  const body = best ?? numbers(f);
  return { ...body, key: keyNoteFor(f, body) } as Story;
}

/** One angle's story with its key note (sample renders and checks). */
export function withKey(f: GameFacts, body: StoryBody | null): Story | null {
  return body ? ({ ...body, key: keyNoteFor(f, body) } as Story) : null;
}
