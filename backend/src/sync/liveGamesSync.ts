import { and, gte, inArray, lte, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { games } from "../db/schema.js";
import { broadcast } from "../realtime/hub.js";
import { getSimulatedGameId } from "../realtime/liveScoreSimulator.js";

// Real EuroLeague live feed, replacing realtime/liveScoreSimulator.ts (a
// deliberate stand-in — see its own header comment — for exactly this).
// GET https://live.euroleague.net/api/Header?gamecode=X&seasoncode=EYYYY is
// public, unauthenticated, confirmed working directly (2026-09-13):
//   - Against a completed 2025-26 game: {"Live": false, "ScoreA": "103",
//     "ScoreB": "87", "Quarter": "", "GameTime": "40:00",
//     "RemainingPartialTime": "00:00", ...}. ScoreA/CodeTeamA lined up with
//     our own homeTeam for that game, confirming A = home, B = away.
//   - Against a real 2026-27 game that hasn't been played yet: HTTP 200
//     with a completely empty body — not an error, just "nothing indexed
//     yet". Safe to poll a little early; it just no-ops (see fetchHeader).
// This writes into the exact same `games` columns and calls the exact same
// broadcast("game-update", ...) the simulator does, so nothing downstream
// (EventsService, Live Center, schedule.ts, game-detail.ts) needed to
// change to go from fake to real.
//
// UNVERIFIED, because no game has actually been live yet to check against:
// what `Quarter`/`GameTime`/`RemainingPartialTime` look like *during* a
// live game specifically (only ever observed post-game, where Quarter is
// blank and GameTime reads the full 40:00 rather than a live elapsed
// value). Quarter/clock parsing below is a best-effort reading of that
// finished-game shape — re-check it against the very first real live game
// this ever runs during (this season's opener is 2026-09-24) and adjust
// parseQuarter/parseClock if the live shape differs.
const HEADER_URL = "https://live.euroleague.net/api/Header";

// A game isn't checked before its scheduled tipoff, and this job stops
// polling it a fixed window after — past that, something's unusual
// (postponement, a feed gap) and it's left for the next manual
// `games_sync.py` run rather than polled forever.
const POLL_AFTER_TIPOFF_MS = 5 * 60 * 60 * 1000; // 5 hours

// A real EuroLeague game realistically can't be over before this — guards
// against ever trusting a premature "Live: false" (a feed hiccup between
// quarters, or a game indexed early with zeroed fields) as a final result
// just because tipoff has technically passed.
const MIN_MINUTES_BEFORE_TRUSTING_FINAL = 75;

interface HeaderResponse {
  Live: boolean;
  ScoreA: string;
  ScoreB: string;
  Quarter: string;
  RemainingPartialTime: string;
}

// "2026-27" -> "E2026" (euroleague-api's own `season: int` is the start year).
function seasonCodeFor(season: string): string {
  return `E${season.slice(0, 4)}`;
}

// "MM:SS" -> seconds. Returns null for anything that doesn't parse (e.g.
// blank, which is what a finished game's RemainingPartialTime looked like
// once it read "00:00" — parses fine there, but a genuinely empty string
// pre-tipoff should fall back to whatever's already stored, not zero it).
function parseClock(value: string | undefined): number | null {
  const match = value?.trim().match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Leading digits of e.g. "1", "2" -> 1, 2. Unconfirmed whether overtime
// shows up as "5"/"OT1"/something else — this only ever extracts a leading
// integer, so a non-numeric prefix (e.g. "OT1") falls back to null (keeps
// whatever quarter was last known) rather than guessing wrong.
function parseQuarter(value: string | undefined): number | null {
  const match = value?.trim().match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseScore(value: string | undefined, fallback: number | null): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : (fallback ?? 0);
}

async function fetchHeader(season: string, gameCode: number): Promise<HeaderResponse | null> {
  const url = `${HEADER_URL}?gamecode=${gameCode}&seasoncode=${seasonCodeFor(season)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trim()) return null; // not indexed yet — confirmed real behavior for a future game
  try {
    return JSON.parse(text) as HeaderResponse;
  } catch {
    return null;
  }
}

export interface LiveGamesSyncResult {
  checked: number;
  wentLive: number;
  wentFinal: number;
}

const NO_OP_RESULT: LiveGamesSyncResult = { checked: 0, wentLive: 0, wentFinal: 0 };

// Guards against two overlapping runs (a slow tick still in flight when the
// next interval fires) rather than chaining them like the simulator's
// tickChain does — a skipped tick here just means the next one 15-20s later
// catches up, unlike the simulator where every tick is a meaningful,
// sequential game event.
let inFlight = false;

export async function syncLiveGames(): Promise<LiveGamesSyncResult> {
  if (inFlight) return NO_OP_RESULT;
  inFlight = true;
  try {
    const now = Date.now();
    const windowStart = new Date(now - POLL_AFTER_TIPOFF_MS);

    const candidates = await db
      .select()
      .from(games)
      .where(and(inArray(games.status, ["scheduled", "live"]), gte(games.tipoffAt, windowStart), lte(games.tipoffAt, new Date(now))));

    if (candidates.length === 0) return NO_OP_RESULT;

    const simulatedGameId = getSimulatedGameId();
    let wentLive = 0;
    let wentFinal = 0;

    for (const game of candidates) {
      if (game.id === simulatedGameId) continue; // an admin test simulation owns this one right now

      const header = await fetchHeader(game.season, game.gameCode);
      if (!header) continue; // not indexed by the feed yet

      const homeScore = parseScore(header.ScoreA, game.homeScore);
      const awayScore = parseScore(header.ScoreB, game.awayScore);
      const quarter = parseQuarter(header.Quarter) ?? game.quarter;
      const gameClockSeconds = parseClock(header.RemainingPartialTime) ?? game.gameClockSeconds;

      if (header.Live) {
        await db.update(games).set({ status: "live", homeScore, awayScore, quarter, gameClockSeconds }).where(eq(games.id, game.id));
        broadcast("game-update", {
          gameId: game.id,
          homeScore,
          awayScore,
          status: "live",
          onFireIds: [], // this endpoint carries no play-by-play detail to compute a heat-check from
          quarter,
          gameClockSeconds,
        });
        if (game.status !== "live") wentLive++;
        continue;
      }

      // Live: false — either "hasn't started yet" (indexed early with
      // zeroed fields) or "actually over". Only trust the latter once
      // enough real time has passed that it couldn't legitimately still be
      // in progress.
      const minutesSinceTipoff = (now - new Date(game.tipoffAt).getTime()) / 60_000;
      if (minutesSinceTipoff < MIN_MINUTES_BEFORE_TRUSTING_FINAL) continue;

      await db.update(games).set({ status: "final", homeScore, awayScore }).where(eq(games.id, game.id));
      broadcast("game-update", { gameId: game.id, homeScore, awayScore, status: "final", onFireIds: [], quarter: null, gameClockSeconds: null });
      wentFinal++;
    }

    return { checked: candidates.length, wentLive, wentFinal };
  } finally {
    inFlight = false;
  }
}
