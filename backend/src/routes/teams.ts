import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { teams, players, playerSeasonStats } from "../db/schema.js";

export const teamsRouter = Router();

teamsRouter.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(teams);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/teams failed:", err);
    res.status(500).json({ error: "Failed to load teams" });
  }
});

teamsRouter.get("/:id/roster", async (req, res) => {
  try {
    const teamId = req.params.id;

    const latest = await db
      .select({ season: playerSeasonStats.season })
      .from(playerSeasonStats)
      .where(eq(playerSeasonStats.teamId, teamId))
      .orderBy(desc(playerSeasonStats.season))
      .limit(1);

    if (latest.length === 0) {
      return res.json([]);
    }
    const season = latest[0].season;

    const rows = await db
      .select({ player: players, stats: playerSeasonStats })
      .from(players)
      .innerJoin(
        playerSeasonStats,
        and(eq(playerSeasonStats.playerId, players.id), eq(playerSeasonStats.season, season))
      )
      .where(eq(players.teamId, teamId))
      .orderBy(desc(playerSeasonStats.pointsPerGame));

    res.json(rows);
  } catch (err) {
    console.error("GET /api/teams/:id/roster failed:", err);
    res.status(500).json({ error: "Failed to load roster" });
  }
});