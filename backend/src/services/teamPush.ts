// Team & pinned-game push (2026-10-12): tip-off soon, close finish / OT,
// and final score, for fans of either team (users.favorite_team_id) and,
// for close/final, anyone who pinned the game or a player in it
// (watch_pins). Called from sync/liveGamesSync.ts through handleGamePushes;
// never throws into the sync. Each user gets each alert once
// (sendPushOnce + push_log). Spec: docs/superpowers/specs/2026-10-12-team-push-design.md
// Checked by scripts/check-team-push.ts.
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { sendPushOnce, type PushLang, type PushMessage } from "./push.js";
import { usersWithPref, type PushPrefKey } from "./pushPreferences.js";
import { formatName } from "./gameStory/plays.js";

export type TeamPushKind = "team_tipoff" | "team_close" | "team_final";

export interface PushGame {
  id: string;
  status: string;
  quarter: number | null;
  gameClockSeconds: number | null;
  tipoffAt: string;
  homeScore: number;
  awayScore: number;
  homeTeamId: string;
  awayTeamId: string;
  homeCode: string; // teams.code (feed code); shown through displayCode()
  awayCode: string;
}

// The public abbreviation fans know, keyed by our internal teams.code. A
// copy of frontend shared/team-display-code.ts (an Angular pipe file the
// backend can't import) — keep the two in sync.
const DISPLAY_CODES: Record<string, string> = {
  IST: "EFS", MIL: "MIL", BES: "BJK", RED: "CZV", DUB: "DUB", BAR: "BAR", MUN: "BAY", ULK: "FBT", HTA: "HTA", BAS: "KBA",
  ASV: "ASV", TEL: "MTA", OLY: "OLY", PAN: "PAO", PRS: "PBB", PAR: "PAR", MAD: "RMB", PAM: "VBC", VIR: "VIR", ZAL: "ZAL", MCO: "MCO",
};
const displayCode = (code: string) => DISPLAY_CODES[code] ?? code;

const TIPOFF_MIN = 10;
const TIPOFF_MAX = 20;
const CLOSE_CLOCK = 120;
const CLOSE_MARGIN = 3;

/** A scheduled game tipping off 10–20 minutes from now. */
export function tipoffDue(g: PushGame, now: Date = new Date()): boolean {
  if (g.status !== "scheduled") return false;
  const minutes = (new Date(g.tipoffAt).getTime() - now.getTime()) / 60_000;
  return minutes >= TIPOFF_MIN && minutes <= TIPOFF_MAX;
}

/** Live and tight in the last 2:00 of Q4 or later, or into overtime. */
export function closeAlert(g: PushGame): "close" | "ot" | null {
  if (g.status !== "live" || g.quarter === null) return null;
  if (g.quarter >= 5) return "ot";
  if (g.quarter === 4 && g.gameClockSeconds !== null && g.gameClockSeconds <= CLOSE_CLOCK && Math.abs(g.homeScore - g.awayScore) <= CLOSE_MARGIN) {
    return "close";
  }
  return null;
}

/** push_log key: one per game per kind, so a close finish and OT share one alert. */
export function pushKey(kind: TeamPushKind, g: PushGame): string {
  return `${kind === "team_tipoff" ? "tipoff" : kind === "team_close" ? "close" : "final"}:${g.id}`;
}

const PREF: Record<TeamPushKind, PushPrefKey> = { team_tipoff: "teamTipoff", team_close: "teamClose", team_final: "teamFinal" };

/** Fans (every kind) plus pinners (close/final), each filtered by their own preference. */
export async function recipientsFor(kind: TeamPushKind, g: PushGame): Promise<string[]> {
  const rows = await db.execute<{ id: string; via: "fan" | "pin" }>(sql`
    select id, 'fan' as via from users where favorite_team_id in (${g.homeTeamId}, ${g.awayTeamId})
    ${kind === "team_tipoff" ? sql`` : sql`union select distinct user_id, 'pin' from watch_pins where game_id = ${g.id}`}
  `);
  const fans = await usersWithPref(rows.filter((r) => r.via === "fan").map((r) => r.id), PREF[kind]);
  const pinners = kind === "team_tipoff" ? [] : await usersWithPref(rows.filter((r) => r.via === "pin").map((r) => r.id), "pinned");
  return [...new Set([...fans, ...pinners])];
}

const COPY = {
  team_tipoff: {
    title: { en: "Tip-off soon", el: "Ξεκινάει σε λίγο" },
    body: { en: "{HOME} vs {AWAY} starts in 15 minutes. Make your picks.", el: "{HOME} - {AWAY} ξεκινάει σε 15 λεπτά. Κάνε τις προβλέψεις σου." },
  },
  team_close: {
    title: { en: "Close finish", el: "Θρίλερ στο φινάλε" },
    body: { en: "Close finish: {HOME} {hs}–{as} {AWAY}, {clock} left.", el: "Θρίλερ: {HOME} {hs}–{as} {AWAY}, απομένουν {clock}." },
  },
  team_ot: {
    title: { en: "Overtime", el: "Παράταση" },
    body: { en: "{HOME}–{AWAY} is going to overtime.", el: "{HOME}–{AWAY}: πάμε στην παράταση." },
  },
  team_final: {
    title: { en: "Final", el: "Τελικό" },
    body: { en: "Final: {HOME} {hs}–{as} {AWAY}.", el: "Τελικό: {HOME} {hs}–{as} {AWAY}." },
  },
  player: { en: " {name}: {pts} pts.", el: " {name}: {pts} πόντοι." },
} as const;

const fill = (t: string, vars: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
const clockLabel = (s: number | null) => (s === null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

export function message(
  kind: TeamPushKind,
  g: PushGame,
  lang: PushLang,
  extra: { ot?: boolean; player?: { name: string; points: number } } = {}
): PushMessage {
  const copy = kind === "team_close" && (extra.ot || (g.quarter ?? 0) >= 5) ? COPY.team_ot : COPY[kind];
  const vars = { HOME: displayCode(g.homeCode), AWAY: displayCode(g.awayCode), hs: g.homeScore, as: g.awayScore, clock: clockLabel(g.gameClockSeconds) };
  let body = fill(copy.body[lang], vars);
  if (kind === "team_final" && extra.player) {
    body += fill(COPY.player[lang], { name: formatName(extra.player.name), pts: extra.player.points });
  }
  return { title: fill(copy.title[lang], vars), body, url: `/games/${g.id}`, tag: `game-${g.id}` };
}

// Resolves when sent and never rejects (failures are logged), so callers can
// fire and forget.
function send(kind: TeamPushKind, g: PushGame, build: (lang: PushLang, userId: string) => PushMessage | null): Promise<void> {
  return recipientsFor(kind, g)
    .then((ids) => sendPushOnce(kind, pushKey(kind, g), ids, build))
    .then(() => undefined)
    .catch((err) => console.error(`[team push] ${kind} ${g.id} failed:`, err));
}

export function notifyTipoff(g: PushGame): Promise<void> {
  return send("team_tipoff", g, (lang) => message("team_tipoff", g, lang));
}

export function notifyClose(g: PushGame): Promise<void> {
  const ot = closeAlert(g) === "ot";
  return send("team_close", g, (lang) => message("team_close", g, lang, { ot }));
}

/** Adds the user's pinned player's points, when they pinned one in this game. */
export function notifyFinal(g: PushGame): Promise<void> {
  return db.execute<{ user_id: string; name: string; points: number | null }>(sql`
    select wp.user_id, p.name, s.points from watch_pins wp
    join players p on p.id = wp.target_id
    left join player_game_stats s on s.player_id = wp.target_id and s.game_id = wp.game_id
    where wp.game_id = ${g.id} and wp.kind = 'player'
  `)
    .then((rows) => {
      const pinned = new Map(rows.map((r) => [r.user_id, { name: r.name, points: r.points ?? 0 }]));
      return send("team_final", g, (lang, userId) => message("team_final", g, lang, { player: pinned.get(userId) }));
    })
    .catch((err) => console.error(`[team push] final ${g.id} failed:`, err));
}

/**
 * The live sync's one hook (2026-10-12), called every tick for each game in
 * its polling window with the state before and after the tick: tip-off
 * soon, a close finish / OT, or the move to final. Resolves when the sends
 * finish and never rejects; the sync doesn't await it. A tip-off moved
 * after its alert went out isn't re-sent (one key per game).
 */
export function handleGamePushes(prev: PushGame | null, next: PushGame, now: Date = new Date()): Promise<void> {
  const jobs: Promise<void>[] = [];
  try {
    if (tipoffDue(next, now)) jobs.push(notifyTipoff(next));
    if (closeAlert(next)) jobs.push(notifyClose(next));
    if (next.status === "final" && prev?.status !== "final") jobs.push(notifyFinal(next));
  } catch (err) {
    console.error(`[team push] ${next.id} failed:`, err);
  }
  return Promise.all(jobs).then(() => undefined);
}

// Team codes for the copy, loaded once per process (21 clubs, never change).
let codes: Map<string, string> | null = null;
export async function teamCodes(): Promise<Map<string, string>> {
  if (!codes) {
    const rows = await db.execute<{ id: string; code: string }>(sql`select id, code from teams`);
    codes = new Map(rows.map((r) => [r.id, r.code]));
  }
  return codes;
}

/** A games row, as the live sync holds it, as a PushGame. */
export function pushGameFrom(
  row: {
    id: string;
    status: string;
    quarter: number | null;
    gameClockSeconds: number | null;
    tipoffAt: Date | string;
    homeScore: number | null;
    awayScore: number | null;
    homeTeamId: string;
    awayTeamId: string;
  },
  codeById: Map<string, string>
): PushGame {
  return {
    id: row.id,
    status: row.status,
    quarter: row.quarter,
    gameClockSeconds: row.gameClockSeconds,
    tipoffAt: new Date(row.tipoffAt).toISOString(),
    homeScore: row.homeScore ?? 0,
    awayScore: row.awayScore ?? 0,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    homeCode: codeById.get(row.homeTeamId) ?? "",
    awayCode: codeById.get(row.awayTeamId) ?? "",
  };
}
