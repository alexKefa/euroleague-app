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

/** The team's top scorer between two snapshots (before = null: from tip-off). Ties go to the higher game total. */
export function topScorer(players: PlayerPoints[], teamId: string, before: Map<string, number> | null): Scorer | null {
  let best: { p: PlayerPoints; gained: number } | null = null;
  for (const p of players) {
    if (p.teamId !== teamId) continue;
    const gained = p.points - (before?.get(p.playerId) ?? 0);
    if (gained <= 0) continue;
    if (!best || gained > best.gained || (gained === best.gained && p.points > best.p.points)) best = { p, gained };
  }
  return best ? { name: surname(best.p.playerName), points: best.gained } : null;
}

// Everyone's points at the end of each quarter, per game, so the next
// quarter's leaders are the difference. Process-local like liveGamesSync's
// own scoring snapshot: after a restart the earlier quarter is missing and
// the push names the top scorers so far instead (`sinceTipoff`).
const atQuarterEnd = new Map<string, Map<number, Map<string, number>>>();

/**
 * Each side's top scorer of quarter q, remembering everyone's points now as
 * the end of q. `sinceTipoff` when q's start isn't known (a restart mid-game).
 */
export function quarterLeaders(
  gameId: string,
  q: number,
  players: PlayerPoints[],
  homeTeamId: string,
  awayTeamId: string
): { home: Scorer | null; away: Scorer | null; sinceTipoff: boolean } {
  const ends = atQuarterEnd.get(gameId) ?? new Map<number, Map<string, number>>();
  atQuarterEnd.set(gameId, ends);
  if (!ends.has(q)) ends.set(q, new Map(players.map((p) => [p.playerId, p.points])));
  const before = q === 1 ? null : (ends.get(q - 1) ?? null);
  const sinceTipoff = q > 1 && before === null;
  return { home: topScorer(players, homeTeamId, before), away: topScorer(players, awayTeamId, before), sinceTipoff };
}

/** Drops a finished game's snapshots. */
export function forgetGame(gameId: string): void {
  atQuarterEnd.delete(gameId);
}

// ---- Words. Plain text, no icons. Team codes are display codes. ----

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
    en: (q: number) => (q === 2 ? "Halftime." : `End of Q${q}.`),
    el: (q: number) => (q === 2 ? "Ημίχρονο." : `Τέλος ${ORDINAL_EL[q - 1]} περιόδου.`),
  },
  soFar: { en: "So far:", el: "Μέχρι τώρα:" },
  final: { en: "Final.", el: "Τελικό." },
  pts: { en: "pts", el: "πόντοι" },
} as const;

/** "Vezenkov 9 pts, Nunn 7 pts" (home side first), or "" when nobody scored. */
export function scorersLine(scorers: (Scorer | null)[], lang: PushLang): string {
  return scorers
    .filter((s): s is Scorer => s !== null)
    .map((s) => `${s.name} ${s.points} ${COPY.pts[lang]}`)
    .join(", ");
}

export function startBody(lang: PushLang): string {
  return COPY.start[lang];
}

/**
 * "Halftime. Vezenkov 9 pts, Nunn 7 pts." The running total is the push's
 * title; the quarter's own score isn't shown (2026-10-16, user call).
 */
export function quarterBody(q: number, leaders: { home: Scorer | null; away: Scorer | null; sinceTipoff: boolean }, lang: PushLang): string {
  const scorers = scorersLine([leaders.home, leaders.away], lang);
  return scorers ? `${COPY.quarterEnd[lang](q)} ${leaders.sinceTipoff ? `${COPY.soFar[lang]} ` : ""}${scorers}.` : COPY.quarterEnd[lang](q);
}

/** "Final. Vezenkov 24 pts, Nunn 21 pts." */
export function finalBody(top: { home: Scorer | null; away: Scorer | null }, lang: PushLang): string {
  const scorers = scorersLine([top.home, top.away], lang);
  return scorers ? `${COPY.final[lang]} ${scorers}.` : COPY.final[lang];
}
