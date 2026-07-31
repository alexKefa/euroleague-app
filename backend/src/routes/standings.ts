import { Router } from "express";
import { eq, desc, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { teams, teamSeasonStats } from "../db/schema.js";

export const standingsRouter = Router();

standingsRouter.get("/", async (_req, res) => {
  try {
    // Pick whichever season has been synced most recently. Works for a
    // single active season; if you're ever tracking multiple seasons at
    // once, swap this for an explicit ?season= query param.
    const latest = await db
      .select({ season: teamSeasonStats.season })
      .from(teamSeasonStats)
      .orderBy(desc(teamSeasonStats.season))
      .limit(1);

    if (latest.length === 0) {
      return res.json([]);
    }
    const season = latest[0].season;

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