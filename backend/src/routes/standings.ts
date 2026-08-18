import { Router } from "express";
import { eq, asc, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { teams, teamSeasonStats } from "../db/schema.js";

export const standingsRouter = Router();

standingsRouter.get("/", async (_req, res) => {
  try {
    // Pick whichever season has actually been played the most — NOT
    // whichever season string sorts alphabetically latest. A season
    // that's been synced for team-identity purposes before it starts
    // (e.g. round 1, to pick up a newly promoted club) would otherwise
    // incorrectly "win" with an all-zero standings table over a completed
    // season with real games. If you're ever tracking multiple seasons
    // at once deliberately, swap this for an explicit ?season= param.
    const mostActive = await db
      .select({
        season: teamSeasonStats.season,
        totalGames: sql<number>`sum(${teamSeasonStats.wins} + ${teamSeasonStats.losses})`,
      })
      .from(teamSeasonStats)
      .groupBy(teamSeasonStats.season)
      .orderBy(sql`sum(${teamSeasonStats.wins} + ${teamSeasonStats.losses}) desc`)
      .limit(1);

    if (mostActive.length === 0) {
      return res.json([]);
    }
    const season = mostActive[0].season;

    const rows = await db
      .select({ team: teams, stats: teamSeasonStats })
      .from(teamSeasonStats)
      .innerJoin(teams, eq(teamSeasonStats.teamId, teams.id))
      .where(eq(teamSeasonStats.season, season))
      .orderBy(asc(teamSeasonStats.position));

    const payload = rows.map(({ team, stats }) => ({
      team,
      position: stats.position ?? 0,
      stats: {
        teamId: stats.teamId,
        season: stats.season,
        wins: stats.wins,
        losses: stats.losses,
        ppg: stats.ppg,
        papg: stats.papg,
        offRating: stats.offRating,
        defRating: stats.defRating,
        rebPct: stats.rebPct,
        astPct: stats.astPct,
      },
    }));

    res.json(payload);
  } catch (err) {
    console.error("GET /api/standings failed:", err);
    res.status(500).json({ error: "Failed to load standings" });
  }
});