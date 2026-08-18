import { Router } from "express";
import { eq, and, or, asc, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { teams, players, playerSeasonStats, games } from "../db/schema.js";

export const teamsRouter = Router();

const homeTeam = alias(teams, "home_team");
const awayTeam = alias(teams, "away_team");

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

    // Same reasoning as /api/standings — pick the season with the most
    // games actually played, not whichever season string sorts latest.
    const mostActive = await db
      .select({
        season: playerSeasonStats.season,
        totalGames: sql<number>`sum(${playerSeasonStats.gamesPlayed})`,
      })
      .from(playerSeasonStats)
      .where(eq(playerSeasonStats.teamId, teamId))
      .groupBy(playerSeasonStats.season)
      .orderBy(sql`sum(${playerSeasonStats.gamesPlayed}) desc`)
      .limit(1);

    if (mostActive.length === 0) {
      return res.json([]);
    }
    const season = mostActive[0].season;

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

teamsRouter.get("/:id/games", async (req, res) => {
  try {
    const teamId = req.params.id;

    const rows = await db
      .select({
        id: games.id,
        gameCode: games.gameCode,
        round: games.round,
        status: games.status,
        tipoffAt: games.tipoffAt,
        homeScore: games.homeScore,
        awayScore: games.awayScore,
        homeTeam: {
          id: homeTeam.id,
          code: homeTeam.code,
          name: homeTeam.name,
          primaryColor: homeTeam.primaryColor,
        },
        awayTeam: {
          id: awayTeam.id,
          code: awayTeam.code,
          name: awayTeam.name,
          primaryColor: awayTeam.primaryColor,
        },
      })
      .from(games)
      .innerJoin(homeTeam, eq(games.homeTeamId, homeTeam.id))
      .innerJoin(awayTeam, eq(games.awayTeamId, awayTeam.id))
      .where(or(eq(games.homeTeamId, teamId), eq(games.awayTeamId, teamId)))
      .orderBy(asc(games.tipoffAt));

    res.json(rows);
  } catch (err) {
    console.error("GET /api/teams/:id/games failed:", err);
    res.status(500).json({ error: "Failed to load games" });
  }
});