import { and, gte, inArray, lte, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, players, playerGameStats } from "../db/schema.js";
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

// Real 2026-09-24 opening-night bug: games_sync.py's schedule pull for one
// game (HTA vs MUN) recorded a tipoff an hour later than the game actually
// started — some last-minute EuroLeague schedule changes apparently aren't
// reflected in the endpoint games_sync.py reads, only in this live feed
// itself. The old `lte(games.tipoffAt, now)` filter meant this job never
// even looked at that game until its (wrong, too-late) recorded tipoff
// arrived — the game sat "scheduled" on the site while genuinely live.
// Polling a bit before the recorded tipoff is a cheap no-op (fetchHeader
// returns null, "not indexed yet") whenever the recorded time turns out to
// be right, so there's no real cost to erring wide here.
const PRE_TIPOFF_POLL_MS = 2 * 60 * 60 * 1000; // 2 hours

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
  // Confirmed numeric (not string) in a real response — e.g.
  // "ScoreQuarter1A":2,"ScoreQuarter2A":0,... — always present for all 4
  // quarters regardless of how far the game has gotten, zeroed for a
  // quarter not yet played. ScoreExtraTimeA/B covers a single OT period;
  // unconfirmed whether a second OT is tracked separately or accumulated
  // into the same field (no real game has gone to 2OT to check against).
  ScoreQuarter1A: number;
  ScoreQuarter2A: number;
  ScoreQuarter3A: number;
  ScoreQuarter4A: number;
  ScoreExtraTimeA: number;
  ScoreQuarter1B: number;
  ScoreQuarter2B: number;
  ScoreQuarter3B: number;
  ScoreQuarter4B: number;
  ScoreExtraTimeB: number;
}

const BOXSCORE_URL = "https://live.euroleague.net/api/Boxscore";

// Same shape family as Header — live.euroleague.net's own real-time widget
// API, not euroleague-api's rate-limited stats origin boxscore_sync.py has
// to pace carefully around (see that script's own doc comment); this is a
// single lightweight per-game request, same host/pattern as Header above.
interface BoxscorePlayerStats {
  Player_ID: string; // "P011212   " — 'P' + zero-padded code + trailing spaces
  IsStarter: number;
  Minutes: string; // "MM:SS" or "DNP"
  Points: number;
  FieldGoalsMade2: number;
  FieldGoalsAttempted2: number;
  FieldGoalsMade3: number;
  FieldGoalsAttempted3: number;
  FreeThrowsMade: number;
  FreeThrowsAttempted: number;
  OffensiveRebounds: number;
  DefensiveRebounds: number;
  TotalRebounds: number;
  Assistances: number;
  Steals: number;
  Turnovers: number;
  BlocksFavour: number;
  BlocksAgainst: number;
  FoulsCommited: number;
  FoulsReceived: number;
  Valuation: number;
  Plusminus: number;
}

interface BoxscoreResponse {
  Stats: { PlayersStats: BoxscorePlayerStats[] }[];
}

async function fetchBoxscore(season: string, gameCode: number): Promise<BoxscoreResponse | null> {
  const url = `${BOXSCORE_URL}?gamecode=${gameCode}&seasoncode=${seasonCodeFor(season)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as BoxscoreResponse;
  } catch {
    return null;
  }
}

// "P011212   " -> "011212", matching players.code's own zero-padded format
// (confirmed directly: players.code has no 'P' prefix or padding).
function parsePlayerCode(playerId: string): string {
  return playerId.trim().replace(/^P/, "");
}

function parseBoxscoreMinutes(value: string | undefined): number | null {
  const s = value?.trim();
  if (!s || s.toUpperCase() === "DNP") return null;
  const match = s.match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 60;
}

// Upserts every player who has appeared in the box score so far (points,
// minutes, etc. all update in place as the game progresses) — same
// (playerId, gameId) upsert target the admin-only live-score simulator
// already uses for this table, just fed real data instead of fabricated.
// Batched as one multi-row insert (not one upsert per player) per the
// "fewer round trips against Neon" lesson documented elsewhere in this app.
async function upsertLiveBoxscore(gameId: string, boxscore: BoxscoreResponse): Promise<void> {
  const codes = boxscore.Stats.flatMap((team) => team.PlayersStats.map((p) => parsePlayerCode(p.Player_ID)));
  if (codes.length === 0) return;

  const playerRows = await db.select({ id: players.id, code: players.code }).from(players).where(inArray(players.code, codes));
  const playerIdByCode = new Map(playerRows.map((p) => [p.code, p.id]));

  const values = boxscore.Stats.flatMap((team) =>
    team.PlayersStats.flatMap((p) => {
      const playerId = playerIdByCode.get(parsePlayerCode(p.Player_ID));
      if (!playerId) return []; // e.g. a coach row, or a player not yet synced into `players`
      return [
        {
          playerId,
          gameId,
          isStarter: p.IsStarter === 1,
          minutes: parseBoxscoreMinutes(p.Minutes),
          points: p.Points,
          fieldGoalsMade2: p.FieldGoalsMade2,
          fieldGoalsAttempted2: p.FieldGoalsAttempted2,
          fieldGoalsMade3: p.FieldGoalsMade3,
          fieldGoalsAttempted3: p.FieldGoalsAttempted3,
          freeThrowsMade: p.FreeThrowsMade,
          freeThrowsAttempted: p.FreeThrowsAttempted,
          offensiveRebounds: p.OffensiveRebounds,
          defensiveRebounds: p.DefensiveRebounds,
          rebounds: p.TotalRebounds,
          assists: p.Assistances,
          steals: p.Steals,
          turnovers: p.Turnovers,
          blocksFavour: p.BlocksFavour,
          blocksAgainst: p.BlocksAgainst,
          foulsCommitted: p.FoulsCommited,
          foulsReceived: p.FoulsReceived,
          valuation: p.Valuation,
          plusMinus: p.Plusminus,
        },
      ];
    }),
  );
  if (values.length === 0) return;

  await db
    .insert(playerGameStats)
    .values(values)
    .onConflictDoUpdate({
      target: [playerGameStats.playerId, playerGameStats.gameId],
      set: {
        isStarter: sql`excluded.is_starter`,
        minutes: sql`excluded.minutes`,
        points: sql`excluded.points`,
        fieldGoalsMade2: sql`excluded.field_goals_made_2`,
        fieldGoalsAttempted2: sql`excluded.field_goals_attempted_2`,
        fieldGoalsMade3: sql`excluded.field_goals_made_3`,
        fieldGoalsAttempted3: sql`excluded.field_goals_attempted_3`,
        freeThrowsMade: sql`excluded.free_throws_made`,
        freeThrowsAttempted: sql`excluded.free_throws_attempted`,
        offensiveRebounds: sql`excluded.offensive_rebounds`,
        defensiveRebounds: sql`excluded.defensive_rebounds`,
        rebounds: sql`excluded.rebounds`,
        assists: sql`excluded.assists`,
        steals: sql`excluded.steals`,
        turnovers: sql`excluded.turnovers`,
        blocksFavour: sql`excluded.blocks_favour`,
        blocksAgainst: sql`excluded.blocks_against`,
        foulsCommitted: sql`excluded.fouls_committed`,
        foulsReceived: sql`excluded.fouls_received`,
        valuation: sql`excluded.valuation`,
        plusMinus: sql`excluded.plus_minus`,
      },
    });
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

// Trims to the quarters actually played so far (per `currentQuarter`) rather
// than always returning all 4 — Header zeroes out a quarter that hasn't
// happened yet, and showing "Q3: 0" in the quick-view dialog while a game
// is still in Q1 would read as a real (very cold) score, not "not played".
// Appends OT only once it's actually underway (a nonzero ScoreExtraTime).
function parseQuarterScores(header: HeaderResponse, side: "A" | "B", currentQuarter: number | null): number[] {
  const raw = [
    header[`ScoreQuarter1${side}`],
    header[`ScoreQuarter2${side}`],
    header[`ScoreQuarter3${side}`],
    header[`ScoreQuarter4${side}`],
  ];
  const extra = header[`ScoreExtraTime${side}`] ?? 0;
  const played = raw.slice(0, Math.min(currentQuarter ?? raw.length, 4));
  return extra > 0 ? [...played, extra] : played;
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
    const windowEnd = new Date(now + PRE_TIPOFF_POLL_MS);

    const candidates = await db
      .select()
      .from(games)
      .where(and(inArray(games.status, ["scheduled", "live"]), gte(games.tipoffAt, windowStart), lte(games.tipoffAt, windowEnd)));

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
        const homeScoreByQuarter = parseQuarterScores(header, "A", quarter);
        const awayScoreByQuarter = parseQuarterScores(header, "B", quarter);
        await db
          .update(games)
          .set({ status: "live", homeScore, awayScore, quarter, gameClockSeconds, homeScoreByQuarter, awayScoreByQuarter })
          .where(eq(games.id, game.id));

        const boxscore = await fetchBoxscore(game.season, game.gameCode);
        if (boxscore) await upsertLiveBoxscore(game.id, boxscore);

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
