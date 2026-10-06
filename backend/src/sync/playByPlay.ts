// Play-by-play parsing (2026-10-06) for the team page's lineups, on/off and
// clutch numbers. Source: live.euroleague.net/api/PlayByPlay, the same
// public feed family as Header/Boxscore in liveGamesSync.ts. The feed has
// every substitution (IN/OUT), so who was on court is tracked exactly
// rather than estimated.
//
// Pure functions only: fetching and DB writes live in gameExtrasSync.ts.

const PBP_URL = "https://live.euroleague.net/api/PlayByPlay";
const PERIOD_KEYS = ["FirstQuarter", "SecondQuarter", "ThirdQuarter", "ForthQuarter", "ExtraTime"] as const;
const REGULATION_PERIOD_SECONDS = 600;
const OVERTIME_PERIOD_SECONDS = 300;

interface RawPlay {
  NUMBEROFPLAY: number;
  CODETEAM: string | null;
  PLAYER_ID: string | null;
  PLAYTYPE: string;
  MARKERTIME: string | null;
  MINUTE: number | null;
}

export interface PbpResponse {
  CodeTeamA: string;
  CodeTeamB: string;
  FirstQuarter?: RawPlay[];
  SecondQuarter?: RawPlay[];
  ThirdQuarter?: RawPlay[];
  ForthQuarter?: RawPlay[];
  ExtraTime?: RawPlay[];
}

/**
 * GET a live.euroleague.net JSON feed. null = the feed has nothing (yet);
 * throws on anything else, so a rate limit (429, seen 2026-10-06 after ~80
 * quick requests) is never mistaken for "no data". Retries 429/5xx with
 * backoff, honouring Retry-After.
 */
export async function fetchFeedJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) throw new Error(`${res.status} from ${url}`);
      const retryAfter = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, (retryAfter > 0 ? retryAfter : 15 * (attempt + 1)) * 1000));
      continue;
    }
    if (!res.ok) return null;
    const text = await res.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}

export function fetchPlayByPlay(seasonCode: string, gameCode: number): Promise<PbpResponse | null> {
  return fetchFeedJson<PbpResponse>(`${PBP_URL}?gamecode=${gameCode}&seasoncode=${seasonCode}`);
}

export type Side = "A" | "B"; // A = home, B = away (same convention as Header)

export interface PbpEvent {
  seq: number;
  period: number; // 1-4, 5+ = overtimes
  clockSeconds: number; // remaining in the period
  elapsedSeconds: number; // since tipoff
  side: Side | null;
  teamCode: string | null;
  playerCode: string | null;
  playType: string;
  points: number;
  homeScoreBefore: number;
  awayScoreBefore: number;
}

const POINTS_BY_TYPE: Record<string, number> = { "2FGM": 2, "3FGM": 3, FTM: 1 };

function periodLength(period: number): number {
  return period <= 4 ? REGULATION_PERIOD_SECONDS : OVERTIME_PERIOD_SECONDS;
}

function periodStartElapsed(period: number): number {
  if (period <= 4) return (period - 1) * REGULATION_PERIOD_SECONDS;
  return 4 * REGULATION_PERIOD_SECONDS + (period - 5) * OVERTIME_PERIOD_SECONDS;
}

function parseMarker(marker: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((marker ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// "P011212   " -> "011212", matching players.code.
export function cleanPlayerCode(raw: string | null): string | null {
  const code = (raw ?? "").trim().replace(/^P/, "");
  return code || null;
}

/**
 * Flattens the per-quarter arrays into one ordered event list with a
 * running score. ExtraTime holds every overtime period back to back, each
 * opening with a BP (begin period) marker. Events with no clock (BP/EP
 * markers) inherit the period's start/end.
 *
 * Within a period, events are ordered by game clock, not by the feed's
 * sequence number: the scorer's table sometimes logs a substitution late
 * (seen 2026-10-06: an IN at 6:50 entered after plays at 4:44), and
 * sequence order would put that player on court for the wrong stretch.
 */
export function parseEvents(pbp: PbpResponse): PbpEvent[] {
  const codeA = pbp.CodeTeamA.trim();
  const codeB = pbp.CodeTeamB.trim();
  const events: PbpEvent[] = [];
  let home = 0;
  let away = 0;

  PERIOD_KEYS.forEach((key, idx) => {
    const plays = [...(pbp[key] ?? [])].sort((a, b) => a.NUMBEROFPLAY - b.NUMBEROFPLAY);
    let period = idx + 1;
    let lastClock: number | null = null;
    let sawBeginInOt = false;
    for (const p of plays) {
      const playType = p.PLAYTYPE.trim();
      if (key === "ExtraTime" && playType === "BP") {
        if (sawBeginInOt) period++;
        sawBeginInOt = true;
        lastClock = null;
      }
      let clock = parseMarker(p.MARKERTIME);
      if (clock == null) clock = playType === "EP" ? 0 : (lastClock ?? periodLength(period));
      lastClock = clock;

      const teamCode = (p.CODETEAM ?? "").trim() || null;
      const side: Side | null = teamCode === codeA ? "A" : teamCode === codeB ? "B" : null;
      const points = POINTS_BY_TYPE[playType] ?? 0;
      events.push({
        seq: p.NUMBEROFPLAY,
        period,
        clockSeconds: clock,
        elapsedSeconds: periodStartElapsed(period) + (periodLength(period) - clock),
        side,
        teamCode,
        playerCode: cleanPlayerCode(p.PLAYER_ID),
        playType,
        points,
        homeScoreBefore: 0,
        awayScoreBefore: 0,
      });
    }
  });

  // Stable sort: period, then clock counting down; ties keep feed order.
  events.sort((a, b) => a.period - b.period || b.clockSeconds - a.clockSeconds);
  for (const e of events) {
    e.homeScoreBefore = home;
    e.awayScoreBefore = away;
    if (e.side === "A") home += e.points;
    if (e.side === "B") away += e.points;
  }
  return events;
}

// Per-side counting stats inside a stint, enough for points and an
// estimated possession count (FGA - OREB + TO + 0.44·FTA).
export interface StintSideStats {
  pts: number;
  fga: number;
  fta: number;
  oreb: number;
  tov: number;
}

export interface Stint {
  side: Side;
  playerCodes: string[]; // sorted, exactly 5
  seconds: number;
  own: StintSideStats;
  opp: StintSideStats;
}

const emptySide = (): StintSideStats => ({ pts: 0, fga: 0, fta: 0, oreb: 0, tov: 0 });

function addEvent(stats: StintSideStats, e: PbpEvent): void {
  stats.pts += e.points;
  if (e.playType === "2FGM" || e.playType === "2FGA" || e.playType === "3FGM" || e.playType === "3FGA") stats.fga++;
  if (e.playType === "FTM" || e.playType === "FTA") stats.fta++;
  if (e.playType === "O") stats.oreb++;
  if (e.playType === "TO") stats.tov++;
}

/**
 * Splits a game into stints: stretches where one team's five on court
 * didn't change. Worked out one period at a time so a single bad feed
 * entry (a substitution logged late, or missing) costs at most that
 * period, not the game (2026-10-06: 3 of the first 30 games had one):
 *
 * - The period's opening five: players whose first appearance in the
 *   period is anything but an IN. Falls back to the five on court at the
 *   end of the previous period (or the box-score starters for period 1).
 * - Substitutions sharing a clock reading are applied together, so a
 *   stint never closes on a momentary 4- or 6-man state.
 * - If a side's set ever isn't exactly 5, the rest of that period is
 *   dropped for that side rather than guessed at.
 *
 * Events must already be in game order (see parseEvents).
 */
export function buildStints(
  events: PbpEvent[],
  starters: { A: string[]; B: string[] }
): { stints: Stint[]; droppedSeconds: { A: number; B: number } } {
  const stints: Stint[] = [];
  const droppedSeconds = { A: 0, B: 0 };
  const periods = [...new Set(events.map((e) => e.period))].sort((a, b) => a - b);

  for (const side of ["A", "B"] as Side[]) {
    let carry: Set<string> | null = starters[side].length === 5 ? new Set(starters[side]) : null;

    for (const period of periods) {
      const periodEvents = events.filter((e) => e.period === period);
      const periodStart = periodStartElapsed(period);
      const periodEnd = periodStart + periodLength(period);

      const opening = new Set<string>();
      const seen = new Set<string>();
      for (const e of periodEvents) {
        if (e.side !== side || !e.playerCode || seen.has(e.playerCode)) continue;
        seen.add(e.playerCode);
        if (e.playType !== "IN") opening.add(e.playerCode);
      }
      let onCourt: Set<string> | null = opening.size === 5 ? opening : carry ? new Set(carry) : null;
      if (!onCourt || onCourt.size !== 5) {
        droppedSeconds[side] += periodEnd - periodStart;
        carry = null;
        continue;
      }

      let current: Stint | null = null;
      let stintStart = periodStart;
      let pendingSubAt: number | null = null;
      let broken = false;

      const open = (at: number) => {
        current = { side, playerCodes: [...onCourt!].sort(), seconds: 0, own: emptySide(), opp: emptySide() };
        stintStart = at;
      };
      const close = (at: number) => {
        if (current) {
          current.seconds = Math.max(0, at - stintStart);
          if (current.seconds > 0) stints.push(current);
        }
        current = null;
      };

      open(periodStart);
      for (const e of periodEvents) {
        const isSub = e.side === side && (e.playType === "IN" || e.playType === "OUT") && e.playerCode;
        if (isSub) {
          if (pendingSubAt == null) pendingSubAt = e.elapsedSeconds;
          if (e.playType === "IN") onCourt.add(e.playerCode!);
          else onCourt.delete(e.playerCode!);
          continue;
        }
        if (pendingSubAt != null) {
          close(pendingSubAt);
          if (onCourt.size !== 5) {
            broken = true;
            droppedSeconds[side] += periodEnd - pendingSubAt;
            break;
          }
          open(pendingSubAt);
          pendingSubAt = null;
        }
        if (current && e.side) addEvent(e.side === side ? (current as Stint).own : (current as Stint).opp, e);
      }
      if (broken) {
        carry = null;
        continue;
      }
      // Subs at the very end of a period (no event after them) only
      // matter for who starts the next one.
      close(periodEnd);
      carry = onCourt.size === 5 ? new Set(onCourt) : null;
    }
  }

  return { stints, droppedSeconds };
}
