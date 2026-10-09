// Game story cards (2026-10-09): pure helpers over one game's scoring
// plays (from pbp_events) and feed names. Checked by
// scripts/check-game-story.ts.
import type { ClutchPlay, MarginPoint } from "./types.js";

/** Feed "WRIGHT, MOSES" -> "Moses Wright" (same rule as the frontend's formatPlayerName). */
export function formatName(name: string): string {
  const comma = name.indexOf(",");
  const ordered = comma === -1 ? name : `${name.slice(comma + 1).trim()} ${name.slice(0, comma).trim()}`;
  return ordered.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

export interface ScoringEvent {
  period: number;
  clock: number; // seconds remaining in the period
  teamId: string | null;
  playerCode: string | null;
  playType: string;
  points: number;
  homeBefore: number;
  awayBefore: number;
}

/** Seconds elapsed in the game; overtimes are 5 minutes. */
export function elapsed(period: number, clock: number): number {
  return period <= 4 ? (period - 1) * 600 + (600 - clock) : 2400 + (period - 5) * 300 + (300 - clock);
}

// Clutch = the NBA definition used by teamAnalytics.ts: last 5:00 of Q4 or
// any overtime, with the score before the play within 5.
const CLUTCH_CLOCK = 300;
const CLUTCH_MARGIN = 5;
// Key plays: lead changes / go-ahead / tying plays in the last 2:00 or OT.
const KEY_PLAY_CLOCK = 120;

export function derivePlays(events: ScoringEvent[], names: Map<string, string>, homeId: string) {
  const sorted = [...events].sort((a, b) => elapsed(a.period, a.clock) - elapsed(b.period, b.clock));
  const margins: MarginPoint[] = [];
  const clutch = new Map<string, { playerName: string; teamId: string; points: number }>();
  const clutchPlays: ClutchPlay[] = [];
  let overtime = false;

  for (const e of sorted) {
    if (e.period > 4) overtime = true;
    if (e.points <= 0) continue;
    const homeAfter = e.homeBefore + (e.teamId === homeId ? e.points : 0);
    const awayAfter = e.awayBefore + (e.teamId === homeId ? 0 : e.points);
    const t = elapsed(e.period, e.clock);
    margins.push({ t, margin: homeAfter - awayAfter });

    const late = (e.period === 4 && e.clock <= CLUTCH_CLOCK) || e.period > 4;
    const name = e.playerCode ? names.get(e.playerCode) ?? null : null;
    if (late && Math.abs(e.homeBefore - e.awayBefore) <= CLUTCH_MARGIN && name && e.teamId) {
      const c = clutch.get(name) ?? { playerName: name, teamId: e.teamId, points: 0 };
      c.points += e.points;
      clutch.set(name, c);
    }
    const keyWindow = (e.period === 4 && e.clock <= KEY_PLAY_CLOCK) || e.period > 4;
    if (keyWindow && Math.sign(homeAfter - awayAfter) !== Math.sign(e.homeBefore - e.awayBefore)) {
      clutchPlays.push({ t, period: e.period, clock: e.clock, teamId: e.teamId, playerName: name, playType: e.playType, homeScore: homeAfter, awayScore: awayAfter });
    }
  }
  return { margins, clutchPoints: [...clutch.values()], clutchPlays, overtime };
}
