import { Router } from "express";
import { eq, asc, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { teams, games } from "../db/schema.js";

export const gamesRouter = Router();

const homeTeam = alias(teams, "home_team_g");
const awayTeam = alias(teams, "away_team_g");

gamesRouter.get("/", async (req, res) => {
  try {
    const status = req.query.status === "final" ? "final" : "scheduled";
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    const baseQuery = db
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
      .where(eq(games.status, status));

    // Upcoming games soonest-first; recent results most-recent-first.
    const rows =
      status === "final"
        ? await baseQuery.orderBy(desc(games.tipoffAt)).limit(limit)
        : await baseQuery.orderBy(asc(games.tipoffAt)).limit(limit);

    res.json(rows);
  } catch (err) {
    console.error("GET /api/games failed:", err);
    res.status(500).json({ error: "Failed to load games" });
  }
});