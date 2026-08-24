import { Router } from "express";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, playerSeasonStats, playerGameStats, games, teams, shotEvents } from "../db/schema.js";

export const playersRouter = Router();

const CATEGORY_COLUMNS = {
  points: playerSeasonStats.pointsPerGame,
  rebounds: playerSeasonStats.reboundsPerGame,
  assists: playerSeasonStats.assistsPerGame,
  steals: playerSeasonStats.stealsPerGame,
  blocks: playerSeasonStats.blocksPerGame,
  valuation: playerSeasonStats.valuation,
} as const;

const CATEGORY_FIELDS = {
  points: "pointsPerGame",
  rebounds: "reboundsPerGame",
  assists: "assistsPerGame",
  steals: "stealsPerGame",
  blocks: "blocksPerGame",
  valuation: "valuation",
} as const;

type LeaderCategory = keyof typeof CATEGORY_COLUMNS;

function isLeaderCategory(value: string): value is LeaderCategory {
  return value in CATEGORY_COLUMNS;
}

playersRouter.get("/leaders", async (req, res) => {
  try {
    const categoryParam = typeof req.query.category === "string" ? req.query.category : "points";
    const category: LeaderCategory = isLeaderCategory(categoryParam) ? categoryParam : "points";
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    const latest = await db
      .select({ season: playerSeasonStats.season })
      .from(playerSeasonStats)
      .orderBy(desc(playerSeasonStats.season))
      .limit(1);

    if (latest.length === 0) {
      return res.json([]);
    }
    const season = latest[0].season;

    const rows = await db
      .select({ player: players, team: teams, stats: playerSeasonStats })
      .from(playerSeasonStats)
      .innerJoin(players, eq(playerSeasonStats.playerId, players.id))
      .innerJoin(teams, eq(playerSeasonStats.teamId, teams.id))
      .where(eq(playerSeasonStats.season, season))
      .orderBy(desc(CATEGORY_COLUMNS[category]))
      .limit(limit);

    res.json(
      rows.map((r) => ({
        category,
        value: r.stats[CATEGORY_FIELDS[category]],
        player: { id: r.player.id, code: r.player.code, name: r.player.name },
        team: {
          id: r.team.id,
          code: r.team.code,
          name: r.team.name,
          primaryColor: r.team.primaryColor,
          logoUrl: r.team.logoUrl,
        },
      }))
    );
  } catch (err) {
    console.error("GET /api/players/leaders failed:", err);
    res.status(500).json({ error: "Failed to load player leaders" });
  }
});

// Top PIR (valuation) performance(s) for a round — defaults to the most
// recently *completed* round (every game in it final) when season/round
// aren't given, same "complete round" definition services/cards.ts uses
// for perfect-round card grants.
playersRouter.get("/round-mvp", async (req, res) => {
  try {
    let season = typeof req.query.season === "string" ? req.query.season : null;
    let round = req.query.round ? Number(req.query.round) : null;

    if (!season || !round) {
      const allGames = await db
        .select({ season: games.season, round: games.round, status: games.status })
        .from(games)
        .where(isNotNull(games.round));

      const bySeasonRound = new Map<string, { season: string; round: number; total: number; final: number }>();
      for (const g of allGames) {
        const key = `${g.season} ${g.round}`;
        const entry = bySeasonRound.get(key) ?? { season: g.season, round: g.round!, total: 0, final: 0 };
        entry.total += 1;
        if (g.status === "final") entry.final += 1;
        bySeasonRound.set(key, entry);
      }

      const completed = [...bySeasonRound.values()]
        .filter((e) => e.final === e.total)
        .sort((a, b) => (a.season === b.season ? b.round - a.round : b.season.localeCompare(a.season)));

      if (completed.length === 0) {
        res.json({ season: null, round: null, leaders: [] });
        return;
      }
      season = completed[0].season;
      round = completed[0].round;
    }

    const limit = Math.min(Number(req.query.limit) || 1, 20);

    const rows = await db
      .select({ stat: playerGameStats, player: players, team: teams })
      .from(playerGameStats)
      .innerJoin(games, eq(playerGameStats.gameId, games.id))
      .innerJoin(players, eq(playerGameStats.playerId, players.id))
      .innerJoin(teams, eq(players.teamId, teams.id))
      .where(and(eq(games.season, season), eq(games.round, round), isNotNull(playerGameStats.valuation)))
      .orderBy(desc(playerGameStats.valuation))
      .limit(limit);

    res.json({
      season,
      round,
      leaders: rows.map((r) => ({
        player: { id: r.player.id, code: r.player.code, name: r.player.name },
        team: {
          id: r.team.id,
          code: r.team.code,
          name: r.team.name,
          primaryColor: r.team.primaryColor,
          logoUrl: r.team.logoUrl,
        },
        valuation: r.stat.valuation,
        points: r.stat.points,
        gameId: r.stat.gameId,
      })),
    });
  } catch (err) {
    console.error("GET /api/players/round-mvp failed:", err);
    res.status(500).json({ error: "Failed to load round MVP" });
  }
});

// Full per-player advanced-stats table for the latest season — everything
// playerSeasonStats has (shooting efficiency, rebound/assist/turnover
// rates, possessions/game), not just the six categories /leaders exposes.
// Small dataset (one row per player, ~200 rows), so it's returned whole and
// sorted/filtered/searched client-side rather than via query params — an
// analyst comparing columns wants the full table, not a fixed top-N.
playersRouter.get("/advanced-stats", async (req, res) => {
  try {
    const latest = await db
      .select({ season: playerSeasonStats.season })
      .from(playerSeasonStats)
      .orderBy(desc(playerSeasonStats.season))
      .limit(1);

    if (latest.length === 0) {
      return res.json({ season: null, rows: [] });
    }
    const season = latest[0].season;

    const rows = await db
      .select({ player: players, team: teams, stats: playerSeasonStats })
      .from(playerSeasonStats)
      .innerJoin(players, eq(playerSeasonStats.playerId, players.id))
      .innerJoin(teams, eq(playerSeasonStats.teamId, teams.id))
      .where(eq(playerSeasonStats.season, season));

    res.json({ season, rows });
  } catch (err) {
    console.error("GET /api/players/advanced-stats failed:", err);
    res.status(500).json({ error: "Failed to load advanced stats" });
  }
});

// Season shot chart — every field-goal attempt (coordX/coordY, made or not)
// for one player, for their most-shots season by default. Coordinates are
// EuroLeague's own system (cm, origin at the basket, Y increasing away from
// the hoop) straight from the feed — see shot_sync.py's doc comment — so
// the frontend just needs to scale/flip them onto whatever court SVG it
// draws, no transform happens here.
playersRouter.get("/:id/shots", async (req, res) => {
  try {
    const playerId = req.params.id;
    let season = typeof req.query.season === "string" ? req.query.season : null;

    if (!season) {
      const latest = await db
        .select({ season: shotEvents.season })
        .from(shotEvents)
        .where(eq(shotEvents.playerId, playerId))
        .orderBy(desc(shotEvents.season))
        .limit(1);
      if (latest.length === 0) {
        res.json({ season: null, attempts: 0, made: 0, fieldGoalPct: null, shots: [] });
        return;
      }
      season = latest[0].season;
    }

    const rows = await db
      .select()
      .from(shotEvents)
      .where(and(eq(shotEvents.playerId, playerId), eq(shotEvents.season, season)));

    const made = rows.filter((r) => r.made).length;

    res.json({
      season,
      attempts: rows.length,
      made,
      fieldGoalPct: rows.length > 0 ? Math.round((made / rows.length) * 1000) / 10 : null,
      shots: rows.map((r) => ({
        x: r.coordX,
        y: r.coordY,
        made: r.made,
        actionId: r.actionId,
        zone: r.zone,
      })),
    });
  } catch (err) {
    console.error("GET /api/players/:id/shots failed:", err);
    res.status(500).json({ error: "Failed to load shot chart" });
  }
});

playersRouter.get("/:id", async (req, res) => {
  try {
    const playerId = req.params.id;

    const rows = await db
      .select({ player: players, team: teams })
      .from(players)
      .innerJoin(teams, eq(players.teamId, teams.id))
      .where(eq(players.id, playerId))
      .limit(1);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Player not found" });
    }

    // Same "latest season" pick as GET /players/leaders, for consistency.
    const latestStats = await db
      .select()
      .from(playerSeasonStats)
      .where(eq(playerSeasonStats.playerId, playerId))
      .orderBy(desc(playerSeasonStats.season))
      .limit(1);

    res.json({
      player: rows[0].player,
      team: rows[0].team,
      stats: latestStats[0] ?? null,
    });
  } catch (err) {
    console.error("GET /api/players/:id failed:", err);
    res.status(500).json({ error: "Failed to load player" });
  }
});