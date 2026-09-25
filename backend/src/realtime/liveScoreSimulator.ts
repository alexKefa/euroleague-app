import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, players, playerGameStats } from "../db/schema.js";
import { broadcast, ScoringEvent } from "./hub.js";

// Originally a stand-in for the real EuroLeague live feed, back when there
// was nothing to poll until the season actually started. sync/liveGamesSync.ts
// (2026-09-13) is that real feed now, confirmed working directly against
// live.euroleague.net's Header endpoint, and takes over `games` rows during
// their actual tipoff window in production. This module still exists as an
// admin-only testing tool for anything liveGamesSync.ts can't cover: a
// per-player fabricated box score (games_sync.py/boxscore_sync.py have no
// live equivalent), and exercising the SSE plumbing (this module + routes/
// events.ts + frontend EventsService) on demand without waiting for a real
// tipoff. liveGamesSync.ts skips whichever game this is actively simulating
// (getSimulatedGameId()) so the two never fight over the same row.

const TICK_MS = 4000;
const MAX_TICKS = 24; // ~96s per simulated game

// Quarter/clock are derived from tick progress, not tracked independently —
// MAX_TICKS worth of ticks are spread evenly across a regulation game
// (4 x 10min quarters, EuroLeague/FIBA), so each tick represents a fixed
// slice of simulated game-clock time. This mirrors the shape the real feed
// will eventually fill (live.euroleague.net's PlaybyPlay endpoint reports a
// PERIOD 1-4 and a MARKERTIME per play — confirmed by reading the
// euroleague-api package source; there's nothing to poll from it yet since
// the season hasn't started) — only the source changes when that's wired
// in later, not games.quarter/game_clock_seconds's meaning.
const QUARTER_SECONDS = 600; // 10 minutes
const REGULATION_SECONDS = QUARTER_SECONDS * 4;
const SECONDS_PER_TICK = REGULATION_SECONDS / MAX_TICKS;

function quarterAndClock(ticksElapsed: number): { quarter: number; gameClockSeconds: number } {
  const elapsed = Math.min(ticksElapsed * SECONDS_PER_TICK, REGULATION_SECONDS);
  if (elapsed >= REGULATION_SECONDS) return { quarter: 4, gameClockSeconds: 0 };
  const quarter = Math.floor(elapsed / QUARTER_SECONDS) + 1;
  const secondsIntoQuarter = elapsed % QUARTER_SECONDS;
  return { quarter, gameClockSeconds: QUARTER_SECONDS - secondsIntoQuarter };
}

interface RosterPlayer {
  id: string;
  teamId: string;
  // Only populated for the tick-by-tick roster (startSimulation) — needed
  // to fill a ScoringEvent's playerName. simulateGameInstant's roster never
  // broadcasts scoring events (it writes an already-final game in one
  // shot), so it doesn't bother selecting it.
  name?: string;
}

interface PlayerLine {
  playerId: string;
  points: number;
  rebounds: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  turnovers: number;
  blocksFavour: number;
  fieldGoalsMade2: number;
  fieldGoalsAttempted2: number;
  fieldGoalsMade3: number;
  fieldGoalsAttempted3: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
}

interface RunningSim {
  gameId: string;
  interval: ReturnType<typeof setInterval>;
  ticksLeft: number;
  homeRoster: RosterPlayer[];
  awayRoster: RosterPlayer[];
  lines: Map<string, PlayerLine>;
  // Last few scorers, most recent last — drives the "on fire" heuristic.
  recentScorers: string[];
}

let running: RunningSim | null = null;

// Every call to tick() is chained onto this instead of invoked directly, so
// the normal timer-driven ticks and completeSimulation()'s fast-forward
// loop can never run concurrently. Without this, clicking "complete" while
// a timer tick is mid-flight on its own DB round trips would start a
// second, overlapping tick() execution mutating the same `sim.lines` /
// `sim.recentScorers` / `sim.ticksLeft` — a real corruption risk, not just
// a hypothetical one, given how long those round trips can take.
let tickChain: Promise<void> = Promise.resolve();

function scheduleTick(): Promise<void> {
  tickChain = tickChain.then(() => tick());
  return tickChain;
}

export function isSimulationRunning(): boolean {
  return running !== null;
}

// So sync/liveGamesSync.ts's real poller can skip whichever game an admin
// is currently test-simulating, rather than the two racing to update the
// same row from two different "sources of truth" for its score.
export function getSimulatedGameId(): string | null {
  return running?.gameId ?? null;
}

function randomPick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function getLine(lines: Map<string, PlayerLine>, playerId: string): PlayerLine {
  let line = lines.get(playerId);
  if (!line) {
    line = {
      playerId,
      points: 0,
      rebounds: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      turnovers: 0,
      blocksFavour: 0,
      fieldGoalsMade2: 0,
      fieldGoalsAttempted2: 0,
      fieldGoalsMade3: 0,
      fieldGoalsAttempted3: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
    };
    lines.set(playerId, line);
  }
  return line;
}

function valuationOf(line: PlayerLine): number {
  return line.points + line.rebounds + line.assists + line.steals + line.blocksFavour - line.turnovers;
}

async function upsertLine(gameId: string, line: PlayerLine): Promise<void> {
  const values = {
    playerId: line.playerId,
    gameId,
    points: line.points,
    rebounds: line.rebounds,
    offensiveRebounds: line.offensiveRebounds,
    defensiveRebounds: line.defensiveRebounds,
    assists: line.assists,
    steals: line.steals,
    turnovers: line.turnovers,
    blocksFavour: line.blocksFavour,
    fieldGoalsMade2: line.fieldGoalsMade2,
    fieldGoalsAttempted2: line.fieldGoalsAttempted2,
    fieldGoalsMade3: line.fieldGoalsMade3,
    fieldGoalsAttempted3: line.fieldGoalsAttempted3,
    freeThrowsMade: line.freeThrowsMade,
    freeThrowsAttempted: line.freeThrowsAttempted,
    valuation: valuationOf(line),
  };
  await db
    .insert(playerGameStats)
    .values(values)
    .onConflictDoUpdate({ target: [playerGameStats.playerId, playerGameStats.gameId], set: values });
}

// Captures `running` into a stable local (`sim`) for the whole tick, and
// rechecks `running === sim` after every await. An admin can null out
// `running` (e.g. the game row disappearing mid-tick) while this is
// mid-flight on its DB round trips; without this, the tick would finish
// against module state that's moved on — at best writing a stale update
// (closed off further by the WHERE-clause guard below), at worst (with a
// bare `running!` non-null assertion instead of a stable local) throwing on
// a background timer, which can take down the whole process, not just this
// feature. Only ever invoked via scheduleTick() — never call this directly.
async function tick(): Promise<void> {
  const sim = running;
  if (!sim) return;

  try {
    // ~20% of scoring plays are a single free throw; the rest is a made
    // field goal, +2 or +3.
    const bump = Math.random() < 0.2 ? 1 : 2 + Math.floor(Math.random() * 2);
    const homeScores = Math.random() < 0.5;
    const scoringRoster = homeScores ? sim.homeRoster : sim.awayRoster;
    const defendingRoster = homeScores ? sim.awayRoster : sim.homeRoster;

    const [current] = await db.select().from(games).where(eq(games.id, sim.gameId)).limit(1);
    if (running !== sim) return;
    if (!current) {
      clearInterval(sim.interval);
      running = null;
      return;
    }

    const touched = new Set<string>();
    // A team can't score if it has no roster synced (a real, if rare, DB
    // gap — see the "known gaps" note in CLAUDE.md) — otherwise the team
    // score climbs with no player ever credited for it, so the box score
    // and the scoreboard silently disagree. Skip the whole possession
    // rather than crediting a phantom basket.
    let scored = false;
    let scoringEvent: ScoringEvent | null = null;

    if (scoringRoster.length > 0) {
      scored = true;
      const scorer = randomPick(scoringRoster);
      const scorerLine = getLine(sim.lines, scorer.id);
      scorerLine.points += bump;
      scoringEvent = {
        playerId: scorer.id,
        playerName: scorer.name ?? "",
        teamSide: homeScores ? "home" : "away",
        points: bump,
        totalPoints: scorerLine.points,
      };
      if (bump === 3) {
        scorerLine.fieldGoalsMade3 += 1;
        scorerLine.fieldGoalsAttempted3 += 1;
      } else if (bump === 2) {
        scorerLine.fieldGoalsMade2 += 1;
        scorerLine.fieldGoalsAttempted2 += 1;
      } else {
        scorerLine.freeThrowsMade += 1;
        scorerLine.freeThrowsAttempted += 1;
      }
      touched.add(scorer.id);

      sim.recentScorers.push(scorer.id);
      if (sim.recentScorers.length > 4) sim.recentScorers.shift();

      // Assist from a teammate on most made baskets — never on a free throw.
      const teammates = scoringRoster.filter((p) => p.id !== scorer.id);
      if (bump !== 1 && teammates.length > 0 && Math.random() < 0.55) {
        const assister = randomPick(teammates);
        getLine(sim.lines, assister.id).assists += 1;
        touched.add(assister.id);
      }

      // Rebound off the previous possession — mostly defensive, sometimes offensive.
      if (defendingRoster.length > 0 && Math.random() < 0.7) {
        const rebounder = randomPick(defendingRoster);
        const line = getLine(sim.lines, rebounder.id);
        line.rebounds += 1;
        line.defensiveRebounds += 1;
        touched.add(rebounder.id);
      } else if (teammates.length > 0 && Math.random() < 0.25) {
        const rebounder = randomPick(teammates);
        const line = getLine(sim.lines, rebounder.id);
        line.rebounds += 1;
        line.offensiveRebounds += 1;
        touched.add(rebounder.id);
      }

      // Occasional flavor: a steal on the other end, a turnover on this one.
      if (defendingRoster.length > 0 && Math.random() < 0.15) {
        const stealer = randomPick(defendingRoster);
        getLine(sim.lines, stealer.id).steals += 1;
        touched.add(stealer.id);
      }
      if (Math.random() < 0.1) {
        const turnoverPlayer = randomPick(scoringRoster);
        getLine(sim.lines, turnoverPlayer.id).turnovers += 1;
        touched.add(turnoverPlayer.id);
      }
    }

    await Promise.all([...touched].map((playerId) => upsertLine(sim.gameId, sim.lines.get(playerId)!)));
    if (running !== sim) return;

    // "On fire": scored on at least 2 of the last 3 baskets.
    const window = sim.recentScorers.slice(-3);
    const onFireIds = [...new Set(window)].filter((id) => window.filter((x) => x === id).length >= 2);

    const homeScore = (current.homeScore ?? 0) + (scored && homeScores ? bump : 0);
    const awayScore = (current.awayScore ?? 0) + (scored && !homeScores ? bump : 0);
    sim.ticksLeft -= 1;
    const isLastTick = sim.ticksLeft <= 0;
    const status = isLastTick ? "final" : "live";
    const { quarter, gameClockSeconds } = quarterAndClock(MAX_TICKS - sim.ticksLeft);

    // Conditioned on the row still being "live", not just keyed on id —
    // defense in depth alongside the tickChain serialization above (which
    // is what actually prevents overlapping ticks now) in case the row's
    // status ever changes out from under a tick some other way. Guarding in
    // the WHERE clause, evaluated against the committed row at write time,
    // makes a stale write a no-op instead of a silent revert to "live".
    const [updated] = await db
      .update(games)
      .set({ homeScore, awayScore, status, quarter, gameClockSeconds })
      .where(and(eq(games.id, sim.gameId), eq(games.status, "live")))
      .returning({ id: games.id });
    if (!updated || running !== sim) return;
    broadcast("game-update", {
      gameId: sim.gameId,
      homeScore,
      awayScore,
      status,
      onFireIds,
      quarter,
      gameClockSeconds,
      scoringEvents: scored && scoringEvent ? [scoringEvent] : [],
    });

    if (isLastTick) {
      clearInterval(sim.interval);
      running = null;
    }
  } catch (err) {
    console.error("Live-score simulator tick failed:", err);
    clearInterval(sim.interval);
    if (running === sim) running = null;
  }
}

/**
 * Starts simulating a live game. Picks the earliest still-scheduled game if
 * gameId isn't given. Only one simulation runs at a time.
 */
export async function startSimulation(gameId?: string): Promise<{ gameId: string } | { error: string }> {
  if (running) return { error: "A simulation is already running" };

  const target = gameId
    ? await db.select().from(games).where(eq(games.id, gameId)).limit(1)
    : await db.select().from(games).where(eq(games.status, "scheduled")).orderBy(asc(games.tipoffAt)).limit(1);

  const game = target[0];
  if (!game) return { error: "No schedulable game found to simulate" };

  const roster = await db
    .select({ id: players.id, teamId: players.teamId, name: players.name })
    .from(players)
    .where(and(inArray(players.teamId, [game.homeTeamId, game.awayTeamId]), eq(players.active, true)));

  // Clean slate — a repeat test run on the same game shouldn't pile stats
  // on top of a previous run's.
  await db.delete(playerGameStats).where(eq(playerGameStats.gameId, game.id));
  await db
    .update(games)
    .set({ homeScore: 0, awayScore: 0, status: "live", quarter: 1, gameClockSeconds: QUARTER_SECONDS })
    .where(eq(games.id, game.id));
  broadcast("game-update", {
    gameId: game.id,
    homeScore: 0,
    awayScore: 0,
    status: "live",
    onFireIds: [],
    quarter: 1,
    gameClockSeconds: QUARTER_SECONDS,
  });

  running = {
    gameId: game.id,
    homeRoster: roster.filter((p) => p.teamId === game.homeTeamId),
    awayRoster: roster.filter((p) => p.teamId === game.awayTeamId),
    lines: new Map(),
    recentScorers: [],
    ticksLeft: MAX_TICKS,
    interval: setInterval(() => void scheduleTick(), TICK_MS),
  };
  return { gameId: game.id };
}

/**
 * Admin-triggered fast-forward: plays out every remaining tick back-to-back
 * with no delay between them, instead of the real ~4s/tick cadence — the
 * game still gets its full sequence of scoring events and box-score stats,
 * reaching "final" the normal way (via tick()'s own isLastTick path), just
 * compressed into however long the DB round trips take. Not an early
 * truncation at whatever the score happens to be right now.
 */
export async function completeSimulation(): Promise<void> {
  if (!running) return;
  clearInterval(running.interval);
  while (running) {
    await scheduleTick();
  }
}

// --- Instant round simulation (2026-09-17) ---
//
// simulateRound originally reused startSimulation+completeSimulation per
// game — the real tick-by-tick machinery above, just with no artificial
// delay between ticks. That was still MAX_TICKS (24) individual DB round
// trips *per game*, times however many games are in a round (typically
// 9-10), and every tick unconditionally scored (no miss modeled at all),
// which is also why final scores landed around 25-35 per team — not a
// realistic EuroLeague box score. Caught live testing Fantasy Five's new
// "simulate round" button: a real, noticeable wait, and unrealistic
// scores once it finished.
//
// This is a from-scratch generator instead: a possession-by-possession
// loop that runs entirely in memory (no DB calls inside the loop at all)
// and includes actual misses/turnovers, then writes the whole game's box
// score in exactly two round trips (one multi-row player_game_stats
// insert, one games update) regardless of possession count. Deliberately
// NOT used for the single-game "Simulate"/"Complete" buttons on the
// Schedule page — those exist specifically to exercise the SSE tick-by-
// tick path on demand (see this file's own top comment), which this
// shortcut has no reason to replace.
const POSSESSIONS_PER_TEAM = 78; // ~EuroLeague pace over 40 minutes
const TURNOVER_RATE = 0.14;
const FT_TRIP_RATE = 0.16;
const TWO_PT_RATE = 0.38; // remainder (~0.32) is a 3PT attempt
const TWO_PT_MAKE_PCT = 0.5;
const THREE_PT_MAKE_PCT = 0.37;
const FT_MAKE_PCT = 0.75;

function simulateTeamPossessions(lines: Map<string, PlayerLine>, scoringRoster: RosterPlayer[], defendingRoster: RosterPlayer[]): number {
  if (scoringRoster.length === 0) return 0;
  const t1 = TURNOVER_RATE;
  const t2 = t1 + FT_TRIP_RATE;
  const t3 = t2 + TWO_PT_RATE;
  let teamPoints = 0;

  for (let i = 0; i < POSSESSIONS_PER_TEAM; i++) {
    const roll = Math.random();

    if (roll < t1) {
      getLine(lines, randomPick(scoringRoster).id).turnovers += 1;
      if (defendingRoster.length > 0 && Math.random() < 0.35) {
        getLine(lines, randomPick(defendingRoster).id).steals += 1;
      }
      continue;
    }

    if (roll < t2) {
      const line = getLine(lines, randomPick(scoringRoster).id);
      let made = 0;
      for (let ft = 0; ft < 2; ft++) {
        line.freeThrowsAttempted += 1;
        if (Math.random() < FT_MAKE_PCT) {
          line.freeThrowsMade += 1;
          made += 1;
        }
      }
      line.points += made;
      teamPoints += made;
      continue;
    }

    const isThree = roll >= t3;
    const shooter = randomPick(scoringRoster);
    const line = getLine(lines, shooter.id);
    const madePct = isThree ? THREE_PT_MAKE_PCT : TWO_PT_MAKE_PCT;
    const made = Math.random() < madePct;
    if (isThree) {
      line.fieldGoalsAttempted3 += 1;
      if (made) line.fieldGoalsMade3 += 1;
    } else {
      line.fieldGoalsAttempted2 += 1;
      if (made) line.fieldGoalsMade2 += 1;
    }

    if (made) {
      const pts = isThree ? 3 : 2;
      line.points += pts;
      teamPoints += pts;
      const teammates = scoringRoster.filter((p) => p.id !== shooter.id);
      if (teammates.length > 0 && Math.random() < 0.55) {
        getLine(lines, randomPick(teammates).id).assists += 1;
      }
    } else {
      if (defendingRoster.length > 0 && Math.random() < 0.1) {
        getLine(lines, randomPick(defendingRoster).id).blocksFavour += 1;
      }
      if (defendingRoster.length > 0 && Math.random() < 0.7) {
        const r = getLine(lines, randomPick(defendingRoster).id);
        r.rebounds += 1;
        r.defensiveRebounds += 1;
      } else {
        const teammates = scoringRoster.filter((p) => p.id !== shooter.id);
        if (teammates.length > 0) {
          const r = getLine(lines, randomPick(teammates).id);
          r.rebounds += 1;
          r.offensiveRebounds += 1;
        }
      }
    }
  }

  return teamPoints;
}

async function simulateGameInstant(gameId: string): Promise<{ error: string } | { homeScore: number; awayScore: number }> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) return { error: "Game not found" };

  const roster = await db
    .select({ id: players.id, teamId: players.teamId })
    .from(players)
    .where(and(inArray(players.teamId, [game.homeTeamId, game.awayTeamId]), eq(players.active, true)));
  const homeRoster = roster.filter((p) => p.teamId === game.homeTeamId);
  const awayRoster = roster.filter((p) => p.teamId === game.awayTeamId);

  const lines = new Map<string, PlayerLine>();
  const homeScore = simulateTeamPossessions(lines, homeRoster, awayRoster);
  const awayScore = simulateTeamPossessions(lines, awayRoster, homeRoster);

  // Clean slate, same as startSimulation — a repeat run on the same game
  // shouldn't pile stats on top of a previous run's.
  await db.delete(playerGameStats).where(eq(playerGameStats.gameId, gameId));
  const values = [...lines.values()].map((line) => ({
    playerId: line.playerId,
    gameId,
    points: line.points,
    rebounds: line.rebounds,
    offensiveRebounds: line.offensiveRebounds,
    defensiveRebounds: line.defensiveRebounds,
    assists: line.assists,
    steals: line.steals,
    turnovers: line.turnovers,
    blocksFavour: line.blocksFavour,
    fieldGoalsMade2: line.fieldGoalsMade2,
    fieldGoalsAttempted2: line.fieldGoalsAttempted2,
    fieldGoalsMade3: line.fieldGoalsMade3,
    fieldGoalsAttempted3: line.fieldGoalsAttempted3,
    freeThrowsMade: line.freeThrowsMade,
    freeThrowsAttempted: line.freeThrowsAttempted,
    valuation: valuationOf(line),
  }));
  if (values.length > 0) {
    await db.insert(playerGameStats).values(values);
  }

  await db
    .update(games)
    .set({ homeScore, awayScore, status: "final", quarter: 4, gameClockSeconds: 0 })
    .where(eq(games.id, gameId));

  broadcast("game-update", {
    gameId,
    homeScore,
    awayScore,
    status: "final",
    onFireIds: [],
    quarter: 4,
    gameClockSeconds: 0,
  });

  return { homeScore, awayScore };
}

/**
 * Simulates every still-scheduled game in one round — instantly, and with
 * realistic scores. See the "Instant round simulation" section above for
 * why this no longer reuses the tick machinery. Independent of the
 * single-slot `running` state (no ticking involved at all), so this can
 * run even while an admin has a separate single-game tick demo going —
 * simulateRound only ever touches "scheduled" games, and a game actively
 * being tick-simulated is already "live", so the two can't collide.
 */
export async function simulateRound(season: string, round: number): Promise<{ simulatedCount: number } | { error: string }> {
  const roundGames = await db
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.season, season), eq(games.round, round), eq(games.status, "scheduled")))
    .orderBy(asc(games.tipoffAt));

  let simulatedCount = 0;
  for (const g of roundGames) {
    const result = await simulateGameInstant(g.id);
    if ("error" in result) continue;
    simulatedCount += 1;
  }
  return { simulatedCount };
}
