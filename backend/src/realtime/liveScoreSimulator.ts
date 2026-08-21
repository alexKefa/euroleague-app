import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, players, playerGameStats } from "../db/schema.js";
import { broadcast } from "./hub.js";

// Stand-in for the real EuroLeague live feed, which has nothing to poll
// until the season actually starts (see CLAUDE.md / project memory). Ticks
// a real `games` row through scheduled -> live -> final on a compressed
// timeline, and fabricates a per-player box score alongside it (into the
// real `player_game_stats` table, same one the boxscore sync fills for real
// games) so the SSE plumbing (this module + routes/events.ts + frontend
// EventsService) can be built and tested end-to-end now, and swapped for a
// real feed later without touching the push mechanism or the frontend.

const TICK_MS = 4000;
const MAX_TICKS = 24; // ~96s per simulated game

interface RosterPlayer {
  id: string;
  teamId: string;
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

export function isSimulationRunning(): boolean {
  return running !== null;
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
    valuation: valuationOf(line),
  };
  await db
    .insert(playerGameStats)
    .values(values)
    .onConflictDoUpdate({ target: [playerGameStats.playerId, playerGameStats.gameId], set: values });
}

// Captures `running` into a stable local (`sim`) for the whole tick, and
// rechecks `running === sim` after every await. An admin can call
// stopSimulation() (which nulls/replaces `running`) while a tick is
// mid-flight on its DB round trips; without this, the tick would finish
// against module state that's moved on — at best clobbering the just-
// finalized game with a stale "live" write, at worst (with a bare `running!`
// non-null assertion instead of a stable local) throwing on a background
// timer, which can take down the whole process, not just this feature.
async function tick(): Promise<void> {
  const sim = running;
  if (!sim) return;

  try {
    const bump = 2 + Math.floor(Math.random() * 2); // +2 or +3, like a basket
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

    if (scoringRoster.length > 0) {
      const scorer = randomPick(scoringRoster);
      const scorerLine = getLine(sim.lines, scorer.id);
      scorerLine.points += bump;
      if (bump === 3) {
        scorerLine.fieldGoalsMade3 += 1;
        scorerLine.fieldGoalsAttempted3 += 1;
      } else {
        scorerLine.fieldGoalsMade2 += 1;
        scorerLine.fieldGoalsAttempted2 += 1;
      }
      touched.add(scorer.id);

      sim.recentScorers.push(scorer.id);
      if (sim.recentScorers.length > 4) sim.recentScorers.shift();

      // Assist from a teammate on most made baskets.
      const teammates = scoringRoster.filter((p) => p.id !== scorer.id);
      if (teammates.length > 0 && Math.random() < 0.55) {
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

    const homeScore = (current.homeScore ?? 0) + (homeScores ? bump : 0);
    const awayScore = (current.awayScore ?? 0) + (homeScores ? 0 : bump);
    sim.ticksLeft -= 1;
    const isLastTick = sim.ticksLeft <= 0;
    const status = isLastTick ? "final" : "live";

    await db.update(games).set({ homeScore, awayScore, status }).where(eq(games.id, sim.gameId));
    if (running !== sim) return;
    broadcast("game-update", { gameId: sim.gameId, homeScore, awayScore, status, onFireIds });

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
    .select({ id: players.id, teamId: players.teamId })
    .from(players)
    .where(inArray(players.teamId, [game.homeTeamId, game.awayTeamId]));

  // Clean slate — a repeat test run on the same game shouldn't pile stats
  // on top of a previous run's.
  await db.delete(playerGameStats).where(eq(playerGameStats.gameId, game.id));
  await db.update(games).set({ homeScore: 0, awayScore: 0, status: "live" }).where(eq(games.id, game.id));
  broadcast("game-update", { gameId: game.id, homeScore: 0, awayScore: 0, status: "live", onFireIds: [] });

  running = {
    gameId: game.id,
    homeRoster: roster.filter((p) => p.teamId === game.homeTeamId),
    awayRoster: roster.filter((p) => p.teamId === game.awayTeamId),
    lines: new Map(),
    recentScorers: [],
    ticksLeft: MAX_TICKS,
    interval: setInterval(tick, TICK_MS),
  };
  return { gameId: game.id };
}

/** Admin-triggered early stop — finalizes the game rather than leaving it stuck "live". */
export async function stopSimulation(): Promise<void> {
  if (!running) return;
  const { gameId, interval } = running;
  clearInterval(interval);
  running = null;

  const [current] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!current) return;
  await db.update(games).set({ status: "final" }).where(eq(games.id, gameId));
  broadcast("game-update", {
    gameId,
    homeScore: current.homeScore ?? 0,
    awayScore: current.awayScore ?? 0,
    status: "final",
    onFireIds: [],
  });
}
