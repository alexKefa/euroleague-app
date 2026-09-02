import { Router } from "express";
import { eq, and, or, asc, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { teams, players, playerSeasonStats, games } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";

function emptyStats(playerId: string, teamId: string, season: string) {
  return {
    playerId,
    teamId,
    season,
    gamesPlayed: null,
    minutesPerGame: null,
    pointsPerGame: null,
    reboundsPerGame: null,
    assistsPerGame: null,
    stealsPerGame: null,
    blocksPerGame: null,
    turnoversPerGame: null,
    fieldGoalPct: null,
    threePointPct: null,
    freeThrowPct: null,
    valuation: null,
    effectiveFieldGoalPct: null,
    trueShootingPct: null,
    offensiveReboundPct: null,
    defensiveReboundPct: null,
    totalReboundPct: null,
    assistToTurnoverRatio: null,
    assistRatio: null,
    turnoverRatio: null,
    twoPointAttemptRate: null,
    threePointAttemptRate: null,
    freeThrowRate: null,
    possessionsPerGame: null,
    usagePercentage: null,
  };
}

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

    // See services/season.ts — "latest season with games synced", not
    // "most games played by this team's roster", so a team whose new-season
    // roster is fully synced but hasn't played yet (or, before this fix,
    // never had a single prior-season stats row at all — Besiktas) still
    // shows its real roster instead of an empty page.
    const season = await getCurrentSeason();
    if (!season) {
      return res.json([]);
    }

    // LEFT JOIN, not INNER — a player's presence on the roster comes from
    // players.teamId (always current), independent of whether they have a
    // stats row for `season` yet (no games played this season, or a synced
    // roster that predates any stats sync at all). Missing stats render as
    // "—" in the UI already (roster.html's `?? "—"` on every stat cell).
    const rows = await db
      .select({ player: players, stats: playerSeasonStats })
      .from(players)
      .leftJoin(
        playerSeasonStats,
        and(eq(playerSeasonStats.playerId, players.id), eq(playerSeasonStats.season, season))
      )
      .where(eq(players.teamId, teamId))
      .orderBy(desc(playerSeasonStats.pointsPerGame));

    const withStats = rows.map((r) => ({
      player: r.player,
      stats: r.stats ?? emptyStats(r.player.id, teamId, season),
    }));

    res.json(withStats);
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
          logoUrl: homeTeam.logoUrl,
        },
        awayTeam: {
          id: awayTeam.id,
          code: awayTeam.code,
          name: awayTeam.name,
          primaryColor: awayTeam.primaryColor,
          logoUrl: awayTeam.logoUrl,
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