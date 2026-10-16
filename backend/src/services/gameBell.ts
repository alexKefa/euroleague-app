// The bell on a game (2026-10-16, "can't watch the game"): when a quarter
// ends, who led it, and the words of the tip-off / quarter / final pushes.
// No DB and no sending here (services/teamPush.ts does that), so it runs
// under `npx tsx --test`.
import type { PushLang } from "./push.js";

/** A player's running points, as the live box score has them. */
export interface PlayerPoints {
  playerId: string;
  teamId: string;
  playerName: string;
  points: number;
}

export interface Scorer {
  name: string;
  points: number;
}

/** The game state the quarter rules need (a subset of teamPush's PushGame). */
export interface QuarterState {
  status: string;
  quarter: number | null;
  gameClockSeconds: number | null;
  homeQuarters?: number[] | null;
  awayQuarters?: number[] | null;
}

/**
 * The regulation quarter (1–3) that has just ended: the current one once its
 * clock reads 0:00, else the previous one once the next has begun, whichever
 * the feed shows first. Q4's end is the final (or overtime), which have their
 * own pushes. Callers send once per quarter (push_log), so seeing the same
 * quarter on several ticks is fine.
 */
export function endedQuarter(g: QuarterState): number | null {
  if (g.status !== "live" || g.quarter === null) return null;
  const q = g.gameClockSeconds === 0 ? g.quarter : g.quarter - 1;
  return q >= 1 && q <= 3 ? q : null;
}

/** Points each side scored in quarter q, and the score once it ended, from the feed's per-quarter breakdown. */
export function quarterScore(g: QuarterState, q: number): { home: number; away: number; homeTotal: number; awayTotal: number } | null {
  const h = g.homeQuarters;
  const a = g.awayQuarters;
  if (!h || !a || h.length < q || a.length < q) return null;
  const sum = (arr: number[]) => arr.slice(0, q).reduce((s, n) => s + n, 0);
  return { home: h[q - 1], away: a[q - 1], homeTotal: sum(h), awayTotal: sum(a) };
}

/** "VEZENKOV, SASHA" → "Vezenkov"; a name without a comma keeps its last word. */
export function surname(name: string): string {
  const comma = name.indexOf(",");
  const last = comma === -1 ? (name.trim().split(/\s+/).pop() ?? name) : name.slice(0, comma).trim();
  return last.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * The team's top scorer of the game so far, with their game total (quarter
 * pushes and the final both show totals, 2026-10-16 user call). Ties go to
 * whoever the box score lists first.
 */
export function topScorer(players: PlayerPoints[], teamId: string): Scorer | null {
  let best: PlayerPoints | null = null;
  for (const p of players) {
    if (p.teamId === teamId && p.points > 0 && (!best || p.points > best.points)) best = p;
  }
  return best ? { name: surname(best.playerName), points: best.points } : null;
}

// ---- Words. Plain text; game pushes open with a basketball (2026-10-16,
// user call). Team codes are display codes.

/** Leads every game push's title. */
export const BALL = "🏀 ";

export interface ScoreLine {
  HOME: string;
  AWAY: string;
  hs: number;
  as: number;
}

export const scoreTitle = (s: ScoreLine) => `${s.HOME} ${s.hs}–${s.as} ${s.AWAY}`;

const ORDINAL_EL = ["1ης", "2ης", "3ης"];

const COPY = {
  start: { en: "The game has started.", el: "Ο αγώνας ξεκίνησε." },
  quarterEnd: {
    en: (q: number) => (q === 2 ? "Halftime" : `End of Q${q}`),
    el: (q: number) => (q === 2 ? "Ημίχρονο" : `Τέλος ${ORDINAL_EL[q - 1]} περιόδου`),
  },
  final: { en: "Final", el: "Τελικό" },
  pts: { en: "pts", el: "πόντοι" },
} as const;

/** "Vezenkov 9 pts, Nunn 7 pts" (home side first), or "" when nobody scored. */
export function scorersLine(scorers: (Scorer | null)[], lang: PushLang): string {
  return scorers
    .filter((s): s is Scorer => s !== null)
    .map((s) => `${s.name} ${s.points} ${COPY.pts[lang]}`)
    .join(", ");
}

/** "🏀 OLY – PAO" */
export function startTitle(s: ScoreLine): string {
  return `${BALL}${s.HOME} – ${s.AWAY}`;
}

export function startBody(lang: PushLang): string {
  return COPY.start[lang];
}

/** "🏀 Halftime · OLY 45–40 PAO": the title, bold on the phone, carries the running total. */
export function quarterTitle(q: number, s: ScoreLine, lang: PushLang): string {
  return `${BALL}${COPY.quarterEnd[lang](q)} · ${scoreTitle(s)}`;
}

/**
 * "Vezenkov 17 pts, Nunn 15 pts.": each side's top scorer of the game so
 * far, with game totals; no per-quarter numbers (2026-10-16, user call).
 * "" when nobody has scored.
 */
export function quarterBody(leaders: { home: Scorer | null; away: Scorer | null }, lang: PushLang): string {
  const scorers = scorersLine([leaders.home, leaders.away], lang);
  return scorers ? `${scorers}.` : "";
}

/** "🏀 Final · OLY 81–77 PAO" */
export function finalTitle(s: ScoreLine, lang: PushLang): string {
  return `${BALL}${COPY.final[lang]} · ${scoreTitle(s)}`;
}

/** "Vezenkov 24 pts, Nunn 21 pts.", or "" when nobody scored. */
export function finalBody(top: { home: Scorer | null; away: Scorer | null }, lang: PushLang): string {
  const scorers = scorersLine([top.home, top.away], lang);
  return scorers ? `${scorers}.` : "";
}
