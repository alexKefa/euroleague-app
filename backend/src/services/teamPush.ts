// Team & game-bell push (2026-10-12): tip-off soon, close finish / OT,
// and final score, for fans of either team (users.favorite_team_id). The
// bell on a game (game_alerts, 2026-10-16) gets tip-off, the end of Q1-Q3
// with each side's top scorer of the quarter, close / OT and the final
// with each side's top scorer; a pin alone no longer pushes. Called from sync/liveGamesSync.ts through handleGamePushes;
// never throws into the sync. Each user gets each alert once
// (sendPushOnce + push_log). Spec: docs/superpowers/specs/2026-10-12-team-push-design.md
// Checked by scripts/check-team-push.ts.
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { sendPushOnce, type PushLang, type PushMessage } from "./push.js";
import { usersWithPref, type PushPrefKey } from "./pushPreferences.js";
import { formatName } from "./gameStory/plays.js";
import { endedQuarter, finalBody, forgetGame, quarterBody, quarterLeaders, quarterScore, scoreTitle, startBody, surname, type PlayerPoints, type Scorer } from "./gameBell.js";

export type TeamPushKind = "team_tipoff" | "team_close" | "team_final" | "game_start" | "game_quarter";

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
  /** Points per quarter so far (games.home_score_by_quarter), for the quarter pushes. */
  homeQuarters?: number[] | null;
  awayQuarters?: number[] | null;
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

const KEY_PREFIX: Record<TeamPushKind, string> = { team_tipoff: "tipoff", team_close: "close", team_final: "final", game_start: "start", game_quarter: "q" };

/** push_log key: one per game per kind (and per quarter), so a close finish and OT share one alert. */
export function pushKey(kind: TeamPushKind, g: PushGame, quarter?: number): string {
  return `${KEY_PREFIX[kind]}${kind === "game_quarter" ? quarter : ""}:${g.id}`;
}

// Fans' preference per kind; bell users all go by "pinned" (Profile: "Games with the bell on").
const FAN_PREF: Partial<Record<TeamPushKind, PushPrefKey>> = { team_tipoff: "teamTipoff", team_close: "teamClose", team_final: "teamFinal" };
const BELL_KINDS: TeamPushKind[] = ["game_start", "game_quarter", "team_close", "team_final"];

/** Fans (tip-off soon, close, final) plus the game's bell users (start, quarters, close, final), each by their own preference. */
export async function recipientsFor(kind: TeamPushKind, g: PushGame): Promise<string[]> {
  const fanPref = FAN_PREF[kind];
  const bell = BELL_KINDS.includes(kind);
  const rows = await db.execute<{ id: string; via: "fan" | "bell" }>(sql`
    select id, 'fan' as via from users where ${fanPref ? sql`favorite_team_id in (${g.homeTeamId}, ${g.awayTeamId})` : sql`false`}
    ${bell ? sql`union select user_id, 'bell' from game_alerts where game_id = ${g.id}` : sql``}
  `);
  const fans = fanPref ? await usersWithPref(rows.filter((r) => r.via === "fan").map((r) => r.id), fanPref) : [];
  const belled = bell ? await usersWithPref(rows.filter((r) => r.via === "bell").map((r) => r.id), "pinned") : [];
  return [...new Set([...fans, ...belled])];
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
  player: { en: " {name}: {pts} pts.", el: " {name}: {pts} πόντοι." },
} as const;

const fill = (t: string, vars: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
const clockLabel = (s: number | null) => (s === null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const scoreLine = (g: PushGame, hs = g.homeScore, as = g.awayScore) => ({ HOME: displayCode(g.homeCode), AWAY: displayCode(g.awayCode), hs, as });

export interface MessageExtra {
  ot?: boolean;
  /** The user's pinned player in this game (final only). */
  player?: { name: string; points: number };
  /** Each side's top scorer of the game (final only). */
  top?: { home: Scorer | null; away: Scorer | null };
}

export function message(kind: "team_tipoff" | "team_close" | "team_final" | "game_start", g: PushGame, lang: PushLang, extra: MessageExtra = {}): PushMessage {
  const base = { url: `/games/${g.id}`, tag: `game-${g.id}` };
  const s = scoreLine(g);
  if (kind === "game_start") return { title: `${s.HOME} – ${s.AWAY}`, body: startBody(lang), ...base };
  if (kind === "team_final") {
    let body = finalBody(extra.top ?? { home: null, away: null }, lang);
    if (extra.player) body += fill(COPY.player[lang], { name: formatName(extra.player.name), pts: extra.player.points });
    return { title: scoreTitle(s), body, ...base };
  }
  const copy = kind === "team_close" && (extra.ot || (g.quarter ?? 0) >= 5) ? COPY.team_ot : COPY[kind];
  const vars = { ...s, clock: clockLabel(g.gameClockSeconds) };
  return { title: fill(copy.title[lang], vars), body: fill(copy.body[lang], vars), ...base };
}

/** End of quarter q: the total score once it ended (title) and each side's top scorer of the quarter. */
export function quarterMessage(
  g: PushGame,
  q: number,
  leaders: { home: Scorer | null; away: Scorer | null; sinceTipoff: boolean },
  lang: PushLang
): PushMessage {
  const qs = quarterScore(g, q);
  const s = qs ? scoreLine(g, qs.homeTotal, qs.awayTotal) : scoreLine(g);
  return { title: scoreTitle(s), body: quarterBody(q, leaders, lang), url: `/games/${g.id}`, tag: `game-${g.id}` };
}

// Resolves when sent and never rejects (failures are logged), so callers can
// fire and forget.
function send(kind: TeamPushKind, key: string, g: PushGame, build: (lang: PushLang, userId: string) => PushMessage | null): Promise<void> {
  return recipientsFor(kind, g)
    .then((ids) => sendPushOnce(kind, key, ids, build))
    .then(() => undefined)
    .catch((err) => console.error(`[team push] ${kind} ${g.id} failed:`, err));
}

export function notifyTipoff(g: PushGame): Promise<void> {
  return send("team_tipoff", pushKey("team_tipoff", g), g, (lang) => message("team_tipoff", g, lang));
}

export function notifyStart(g: PushGame): Promise<void> {
  return send("game_start", pushKey("game_start", g), g, (lang) => message("game_start", g, lang));
}

export function notifyQuarter(g: PushGame, q: number, players: PlayerPoints[]): Promise<void> {
  const leaders = quarterLeaders(g.id, q, players, g.homeTeamId, g.awayTeamId);
  return send("game_quarter", pushKey("game_quarter", g, q), g, (lang) => quarterMessage(g, q, leaders, lang));
}

export function notifyClose(g: PushGame): Promise<void> {
  const ot = closeAlert(g) === "ot";
  return send("team_close", pushKey("team_close", g), g, (lang) => message("team_close", g, lang, { ot }));
}

/** Each side's top scorer from the stored box score, plus the user's pinned player's points when they pinned one. */
export function notifyFinal(g: PushGame): Promise<void> {
  forgetGame(g.id);
  return db
    .execute<{ via: "top" | "pin"; user_id: string | null; team_id: string; name: string; points: number | null }>(sql`
      (select distinct on (s.team_id) 'top' as via, null::uuid as user_id, s.team_id, p.name, s.points
        from (select pgs.*, pl.team_id from player_game_stats pgs join players pl on pl.id = pgs.player_id where pgs.game_id = ${g.id}) s
        join players p on p.id = s.player_id
        where s.points > 0
        order by s.team_id, s.points desc)
      union all
      select 'pin', wp.user_id, p.team_id, p.name, s.points from watch_pins wp
      join players p on p.id = wp.target_id
      left join player_game_stats s on s.player_id = wp.target_id and s.game_id = wp.game_id
      where wp.game_id = ${g.id} and wp.kind = 'player'
    `)
    .then((rows) => {
      const top = (teamId: string): Scorer | null => {
        const r = rows.find((x) => x.via === "top" && x.team_id === teamId);
        return r ? { name: surname(r.name), points: r.points ?? 0 } : null;
      };
      const tops = { home: top(g.homeTeamId), away: top(g.awayTeamId) };
      const pinned = new Map(rows.filter((r) => r.via === "pin").map((r) => [r.user_id!, { name: r.name, points: r.points ?? 0 }]));
      return send("team_final", pushKey("team_final", g), g, (lang, userId) => message("team_final", g, lang, { top: tops, player: pinned.get(userId) }));
    })
    .catch((err) => console.error(`[team push] final ${g.id} failed:`, err));
}

// Alerts already handled by this process. A tip-off window or a close finish
// lasts many 20 s ticks; without this every tick redid the recipient and
// push_log queries (push_log stopped duplicate pushes, not the round trips).
// After a restart push_log is still the guard. Bounded: oldest dropped.
const handled = new Set<string>();
const MAX_HANDLED = 2000;

/** True the first time a key is seen in this process, false after. */
export function claimOnce(key: string): boolean {
  if (handled.has(key)) return false;
  handled.add(key);
  if (handled.size > MAX_HANDLED) handled.delete(handled.values().next().value as string);
  return true;
}

/**
 * Lets a game's alerts go out again (2026-10-16): the admin live-score
 * simulator replays games, and without this a replay sent nothing (this
 * process's claims and push_log both said "already sent").
 */
export async function forgetGamePushes(gameId: string): Promise<void> {
  for (const key of [...handled]) if (key.endsWith(`:${gameId}`)) handled.delete(key);
  forgetGame(gameId);
  await db.execute(sql`
    delete from push_log
    where kind in ('team_tipoff', 'team_close', 'team_final', 'game_start', 'game_quarter') and key like ${`%:${gameId}`}
  `);
}

/**
 * The live sync's one hook (2026-10-12), called every tick for each game in
 * its polling window with the state before and after the tick: tip-off
 * soon, the game starting, a quarter ending (bell, 2026-10-16), a close
 * finish / OT, or the move to final. `players` is the live box score just
 * read, for the quarter's top scorers; a quarter seen without it waits for
 * a tick that has it. Resolves when the sends finish and never rejects; the
 * sync doesn't await it. A tip-off moved after its alert went out isn't
 * re-sent (one key per game).
 */
export function handleGamePushes(prev: PushGame | null, next: PushGame, now: Date = new Date(), players?: PlayerPoints[]): Promise<void> {
  const jobs: Promise<void>[] = [];
  try {
    if (tipoffDue(next, now) && claimOnce(pushKey("team_tipoff", next))) jobs.push(notifyTipoff(next));
    if (next.status === "live" && prev?.status === "scheduled" && claimOnce(pushKey("game_start", next))) jobs.push(notifyStart(next));
    const q = endedQuarter(next);
    if (q !== null && players && claimOnce(pushKey("game_quarter", next, q))) jobs.push(notifyQuarter(next, q, players));
    if (closeAlert(next) && claimOnce(pushKey("team_close", next))) jobs.push(notifyClose(next));
    if (next.status === "final" && prev?.status !== "final" && claimOnce(pushKey("team_final", next))) jobs.push(notifyFinal(next));
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
    homeScoreByQuarter?: number[] | null;
    awayScoreByQuarter?: number[] | null;
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
    homeQuarters: row.homeScoreByQuarter ?? null,
    awayQuarters: row.awayScoreByQuarter ?? null,
  };
}
