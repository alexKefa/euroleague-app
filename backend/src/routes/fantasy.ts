import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  players,
  teams,
  playerSeasonStats,
  playerFantasyPrices,
  fantasyLineups,
  coachFantasyPrices,
  fantasyCoachPicks,
  games,
} from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { getCurrentSeason } from "../services/season.js";
import {
  getRoundLockTime,
  getTeamRoundGameTipoff,
  getDefaultRound,
  getFantasyLeaderboardEntries,
  FANTASY_STARTER_COUNT,
  FANTASY_SIXTH_MAN_COUNT,
  FANTASY_BENCH_COUNT,
  FANTASY_TOTAL_OUTFIELD,
  FANTASY_POSITION_QUOTA,
  FANTASY_BUDGET_CAP,
  FANTASY_MIN_PRICE,
  COACH_MIN_PRICE,
} from "../services/fantasyScoring.js";

export const fantasyRouter = Router();

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT_ROLES = ["starter", "sixth_man", "bench"] as const;
type SlotRole = (typeof SLOT_ROLES)[number];

/** Explicit ?season= wins; otherwise falls back to getCurrentSeason(). */
async function resolveSeason(seasonParam: unknown): Promise<string | null> {
  if (typeof seasonParam === "string") return seasonParam;
  return getCurrentSeason();
}

// The whole player pool + draft price for the roster builder — same
// "small dataset, fetch once, filter/sort client-side" shape as
// GET /players/advanced-stats. Left-joins player_fantasy_prices (rather
// than requiring it) so this still works before fantasy:reprice has ever
// been run — an unpriced player just floors at FANTASY_MIN_PRICE.
fantasyRouter.get("/players", async (req, res) => {
  try {
    const season = await resolveSeason(req.query.season);
    if (!season) {
      res.json({ season: null, rows: [] });
      return;
    }

    const rows = await db
      .select({ player: players, team: teams, price: playerFantasyPrices.price, stats: playerSeasonStats })
      .from(players)
      .innerJoin(teams, eq(players.teamId, teams.id))
      .leftJoin(
        playerFantasyPrices,
        and(eq(playerFantasyPrices.playerId, players.id), eq(playerFantasyPrices.season, season))
      )
      .leftJoin(playerSeasonStats, and(eq(playerSeasonStats.playerId, players.id), eq(playerSeasonStats.season, season)))
      .where(eq(players.active, true));

    res.json({
      season,
      rows: rows.map((r) => ({
        player: { id: r.player.id, name: r.player.name, position: r.player.position, photoUrl: r.player.photoUrl },
        team: { id: r.team.id, code: r.team.code, name: r.team.name, primaryColor: r.team.primaryColor, logoUrl: r.team.logoUrl },
        price: r.price ?? FANTASY_MIN_PRICE,
        pointsPerGame: r.stats?.pointsPerGame ?? null,
        valuation: r.stats?.valuation ?? null,
        gamesPlayed: r.stats?.gamesPlayed ?? null,
      })),
    });
  } catch (err) {
    console.error("GET /api/fantasy/players failed:", err);
    res.status(500).json({ error: "Failed to load fantasy players" });
  }
});

// The coach pool — one row per team playing this season, priced off real
// standings (services/fantasyScoring.ts's computeCoachPrice).
fantasyRouter.get("/coaches", async (req, res) => {
  try {
    const season = await resolveSeason(req.query.season);
    if (!season) {
      res.json({ season: null, rows: [] });
      return;
    }

    const rows = await db
      .select({ team: teams, price: coachFantasyPrices.price })
      .from(coachFantasyPrices)
      .innerJoin(teams, eq(coachFantasyPrices.teamId, teams.id))
      .where(eq(coachFantasyPrices.season, season));

    res.json({
      season,
      rows: rows.map((r) => ({
        team: { id: r.team.id, code: r.team.code, name: r.team.name, primaryColor: r.team.primaryColor, logoUrl: r.team.logoUrl },
        headCoach: r.team.headCoach,
        price: r.price ?? COACH_MIN_PRICE,
      })),
    });
  } catch (err) {
    console.error("GET /api/fantasy/coaches failed:", err);
    res.status(500).json({ error: "Failed to load fantasy coaches" });
  }
});

// The current user's 10-player squad + coach for a round (defaults to the
// current season's default round), each player individually flagged
// `locked` — their own team's game for this round has already tipped off,
// per EuroLeague Fantasy's real "Turns" rule (see services/
// fantasyScoring.ts's getTeamRoundGameTipoff doc comment) — not the whole
// round's overall lock, which only gates the coach pick.
fantasyRouter.get("/lineup", requireAuth, async (req, res) => {
  try {
    const season = await resolveSeason(req.query.season);
    if (!season) {
      res.json({ season: null, round: null, players: [], coachTeamId: null, coachLocked: false, lockAt: null, locked: false });
      return;
    }
    const round = req.query.round ? Number(req.query.round) : await getDefaultRound(season);
    if (round === null || Number.isNaN(round)) {
      res.json({ season, round: null, players: [], coachTeamId: null, coachLocked: false, lockAt: null, locked: false });
      return;
    }

    const [lockAt, lineupRows, coachRows, roundGames] = await Promise.all([
      getRoundLockTime(season, round),
      db
        .select({ playerId: fantasyLineups.playerId, slotRole: fantasyLineups.slotRole, isCaptain: fantasyLineups.isCaptain })
        .from(fantasyLineups)
        .where(and(eq(fantasyLineups.userId, req.userId!), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round))),
      db
        .select({ teamId: fantasyCoachPicks.teamId })
        .from(fantasyCoachPicks)
        .where(and(eq(fantasyCoachPicks.userId, req.userId!), eq(fantasyCoachPicks.season, season), eq(fantasyCoachPicks.round, round)))
        .limit(1),
      db
        .select({ homeTeamId: games.homeTeamId, awayTeamId: games.awayTeamId, tipoffAt: games.tipoffAt })
        .from(games)
        .where(and(eq(games.season, season), eq(games.round, round))),
    ]);

    const playerIds = lineupRows.map((r) => r.playerId);
    const playerTeamRows = playerIds.length
      ? await db.select({ id: players.id, teamId: players.teamId }).from(players).where(inArray(players.id, playerIds))
      : [];
    const teamIdByPlayer = new Map(playerTeamRows.map((p) => [p.id, p.teamId]));

    const tipoffByTeam = new Map<string, Date>();
    for (const g of roundGames) {
      tipoffByTeam.set(g.homeTeamId, new Date(g.tipoffAt));
      tipoffByTeam.set(g.awayTeamId, new Date(g.tipoffAt));
    }

    const now = Date.now();
    const playersOut = lineupRows.map((r) => {
      const teamId = teamIdByPlayer.get(r.playerId);
      const tipoff = teamId ? tipoffByTeam.get(teamId) : undefined;
      return {
        playerId: r.playerId,
        slotRole: r.slotRole,
        isCaptain: r.isCaptain,
        locked: tipoff ? tipoff.getTime() <= now : false,
      };
    });

    const coachLocked = lockAt !== null && lockAt.getTime() <= now;

    res.json({
      season,
      round,
      players: playersOut,
      coachTeamId: coachRows[0]?.teamId ?? null,
      coachLocked,
      lockAt,
      locked: coachLocked,
    });
  } catch (err) {
    console.error("GET /api/fantasy/lineup failed:", err);
    res.status(500).json({ error: "Failed to load lineup" });
  }
});

// Wholesale-replaces the user's 10-player squad + coach pick for one round.
// A lock check runs first, per EuroLeague Fantasy's real "Turns" rule: only
// a player whose *own team's* game for this round hasn't tipped off yet may
// be added, removed, or have their slotRole changed — an unchanged player
// passes straight through regardless of their own lock status, since
// nothing about them is being touched. The coach pick only locks at the
// round's overall first tipoff (real rules don't give it a per-turn
// window), and only when actually changing from what's already saved.
fantasyRouter.post("/lineup/batch", requireAuth, async (req, res) => {
  try {
    const { season, round, players: entries, coachTeamId } = req.body ?? {};
    if (typeof season !== "string" || typeof round !== "number" || !Number.isInteger(round)) {
      res.status(400).json({ error: "season and round are required" });
      return;
    }
    if (typeof coachTeamId !== "string" || !uuidPattern.test(coachTeamId)) {
      res.status(400).json({ error: "coachTeamId is required" });
      return;
    }
    if (!Array.isArray(entries) || entries.length !== FANTASY_TOTAL_OUTFIELD) {
      res.status(400).json({ error: `Squad must contain exactly ${FANTASY_TOTAL_OUTFIELD} players` });
      return;
    }

    const seenIds = new Set<string>();
    for (const e of entries) {
      if (typeof e?.playerId !== "string" || !uuidPattern.test(e.playerId)) {
        res.status(400).json({ error: "Each squad entry needs a valid playerId" });
        return;
      }
      if (!SLOT_ROLES.includes(e.slotRole)) {
        res.status(400).json({ error: "Each squad entry needs a valid slotRole" });
        return;
      }
      if (seenIds.has(e.playerId)) {
        res.status(400).json({ error: "Duplicate player in squad" });
        return;
      }
      seenIds.add(e.playerId);
    }

    const typedEntries = entries as { playerId: string; slotRole: SlotRole; isCaptain?: boolean }[];
    const starters = typedEntries.filter((e) => e.slotRole === "starter");
    const sixthMen = typedEntries.filter((e) => e.slotRole === "sixth_man");
    const bench = typedEntries.filter((e) => e.slotRole === "bench");
    if (starters.length !== FANTASY_STARTER_COUNT || sixthMen.length !== FANTASY_SIXTH_MAN_COUNT || bench.length !== FANTASY_BENCH_COUNT) {
      res.status(400).json({
        error: `Need exactly ${FANTASY_STARTER_COUNT} starters, ${FANTASY_SIXTH_MAN_COUNT} sixth man, ${FANTASY_BENCH_COUNT} bench`,
      });
      return;
    }
    const captains = starters.filter((e) => e.isCaptain);
    if (captains.length !== 1 || typedEntries.some((e) => e.isCaptain && e.slotRole !== "starter")) {
      res.status(400).json({ error: "Exactly one starter must be captain" });
      return;
    }

    const newIds = typedEntries.map((e) => e.playerId);

    const [oldRows, oldCoachRows] = await Promise.all([
      db
        .select({ playerId: fantasyLineups.playerId, slotRole: fantasyLineups.slotRole })
        .from(fantasyLineups)
        .where(and(eq(fantasyLineups.userId, req.userId!), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round))),
      db
        .select({ teamId: fantasyCoachPicks.teamId })
        .from(fantasyCoachPicks)
        .where(and(eq(fantasyCoachPicks.userId, req.userId!), eq(fantasyCoachPicks.season, season), eq(fantasyCoachPicks.round, round)))
        .limit(1),
    ]);
    const oldRoleByPlayerId = new Map(oldRows.map((r) => [r.playerId, r.slotRole]));

    const allRelevantIds = [...new Set([...newIds, ...oldRows.map((r) => r.playerId)])];
    const playerRows = allRelevantIds.length
      ? await db.select({ id: players.id, teamId: players.teamId, position: players.position }).from(players).where(inArray(players.id, allRelevantIds))
      : [];
    const playerById = new Map(playerRows.map((p) => [p.id, p]));

    // Position quota — only over the newly submitted squad.
    const posCounts: Record<string, number> = { Guard: 0, Forward: 0, Center: 0 };
    for (const id of newIds) {
      const p = playerById.get(id);
      if (!p) {
        res.status(400).json({ error: "Unknown player in squad" });
        return;
      }
      if (p.position && p.position in posCounts) posCounts[p.position]++;
    }
    for (const [position, quota] of Object.entries(FANTASY_POSITION_QUOTA)) {
      if (posCounts[position] !== quota) {
        res.status(400).json({ error: `Need exactly ${quota} ${position}s, got ${posCounts[position] ?? 0}`, code: "POSITION_QUOTA" });
        return;
      }
    }

    // Changed players: added, removed, or moved between starter/sixth
    // man/bench — each one individually needs their own team's game for
    // this round to not have started yet.
    const changedIds = new Set<string>();
    for (const e of typedEntries) {
      const oldRole = oldRoleByPlayerId.get(e.playerId);
      if (oldRole === undefined || oldRole !== e.slotRole) changedIds.add(e.playerId);
    }
    for (const oldId of oldRoleByPlayerId.keys()) {
      if (!seenIds.has(oldId)) changedIds.add(oldId);
    }

    const now = Date.now();
    const lockedPlayerIds: string[] = [];
    for (const id of changedIds) {
      const p = playerById.get(id);
      if (!p) continue;
      const tipoff = await getTeamRoundGameTipoff(season, round, p.teamId);
      if (tipoff && tipoff.getTime() <= now) lockedPlayerIds.push(id);
    }
    if (lockedPlayerIds.length > 0) {
      res.status(400).json({
        error: "Some players' games have already started this round",
        code: "PLAYER_LOCKED",
        playerIds: lockedPlayerIds,
      });
      return;
    }

    const roundLockAt = await getRoundLockTime(season, round);
    if (roundLockAt === null) {
      res.status(400).json({ error: "Unknown round", code: "ROUND_NOT_FOUND" });
      return;
    }
    const oldCoachTeamId = oldCoachRows[0]?.teamId ?? null;
    if (coachTeamId !== oldCoachTeamId && roundLockAt.getTime() <= now) {
      res.status(400).json({ error: "This round has already locked", code: "ROUND_LOCKED" });
      return;
    }

    const [priceRows, coachPriceRows] = await Promise.all([
      db
        .select({ playerId: playerFantasyPrices.playerId, price: playerFantasyPrices.price })
        .from(playerFantasyPrices)
        .where(and(eq(playerFantasyPrices.season, season), inArray(playerFantasyPrices.playerId, newIds))),
      db
        .select({ price: coachFantasyPrices.price })
        .from(coachFantasyPrices)
        .where(and(eq(coachFantasyPrices.teamId, coachTeamId), eq(coachFantasyPrices.season, season)))
        .limit(1),
    ]);
    const priceByPlayerId = new Map(priceRows.map((r) => [r.playerId, r.price]));
    const playersCost = newIds.reduce((sum, id) => sum + (priceByPlayerId.get(id) ?? FANTASY_MIN_PRICE), 0);
    const coachCost = coachPriceRows[0]?.price ?? COACH_MIN_PRICE;
    const totalCost = playersCost + coachCost;
    if (totalCost > FANTASY_BUDGET_CAP) {
      res.status(400).json({
        error: `Squad costs ${totalCost}, over the ${FANTASY_BUDGET_CAP}-credit budget`,
        code: "OVER_BUDGET",
      });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(fantasyLineups)
        .where(and(eq(fantasyLineups.userId, req.userId!), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round)));
      await tx.insert(fantasyLineups).values(
        typedEntries.map((e) => ({
          userId: req.userId!,
          season,
          round,
          playerId: e.playerId,
          slotRole: e.slotRole,
          isCaptain: !!e.isCaptain,
        }))
      );
      await tx
        .insert(fantasyCoachPicks)
        .values({ userId: req.userId!, season, round, teamId: coachTeamId })
        .onConflictDoUpdate({
          target: [fantasyCoachPicks.userId, fantasyCoachPicks.season, fantasyCoachPicks.round],
          set: { teamId: coachTeamId },
        });
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/fantasy/lineup/batch failed:", err);
    res.status(500).json({ error: "Failed to save lineup" });
  }
});

// Global season leaderboard — a league-scoped version lives at
// GET /leagues/:id/fantasy-leaderboard (routes/leagues.ts), sharing
// getFantasyLeaderboardEntries the same way the points leaderboard is
// shared between the global and league-scoped routes.
fantasyRouter.get("/leaderboard", async (req, res) => {
  try {
    const season = await resolveSeason(req.query.season);
    if (!season) {
      res.json([]);
      return;
    }
    const round = req.query.round ? Number(req.query.round) : undefined;
    const entries = await getFantasyLeaderboardEntries({ season, round });
    res.json(entries);
  } catch (err) {
    console.error("GET /api/fantasy/leaderboard failed:", err);
    res.status(500).json({ error: "Failed to load fantasy leaderboard" });
  }
});
