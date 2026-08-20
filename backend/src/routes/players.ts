import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, playerSeasonStats, teams } from "../db/schema.js";

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
        },
      }))
    );
  } catch (err) {
    console.error("GET /api/players/leaders failed:", err);
    res.status(500).json({ error: "Failed to load player leaders" });
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