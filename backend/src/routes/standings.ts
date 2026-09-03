import { Router } from "express";
import { eq, asc, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { teams, teamSeasonStats, playerSeasonStats } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";

export const standingsRouter = Router();

standingsRouter.get("/", async (_req, res) => {
  try {
    // See services/season.ts for why this is "latest season with games
    // synced" rather than "most games actually played" — the standings
    // table is meant to go empty/reset the moment a new season starts,
    // not keep showing the prior season's final table until real games
    // pile up for the new one.
    const season = await getCurrentSeason();
    if (!season) {
      return res.json([]);
    }

    const rows = await db
      .select({ team: teams, stats: teamSeasonStats })
      .from(teamSeasonStats)
      .innerJoin(teams, eq(teamSeasonStats.teamId, teams.id))
      .where(eq(teamSeasonStats.season, season))
      .orderBy(asc(teamSeasonStats.position));

    // No raw "team rebounds per game" field is synced (team_season_stats
    // only has the percentage-based rebPct) — approximate it from the
    // already-populated player_season_stats instead of touching the
    // Python sync: each roster player's own reboundsPerGame, summed. Not
    // exact (a bench player's games-played can undercount slightly
    // relative to the team's own game count) but close enough for a
    // fan-facing comparison, same spirit as the PIR badge thresholds below.
    const reboundRows = await db
      .select({
        teamId: playerSeasonStats.teamId,
        rpg: sql<number>`sum(${playerSeasonStats.reboundsPerGame})`,
      })
      .from(playerSeasonStats)
      .where(eq(playerSeasonStats.season, season))
      .groupBy(playerSeasonStats.teamId);
    const rpgByTeam = new Map(reboundRows.map((r) => [r.teamId, r.rpg]));

    // Last-10 record (matches euroleaguebasketball.net's own "L10" column).
    // Not stored anywhere — games has no per-team "result" column, only
    // home/away scores — so this unpivots each final game into one row per
    // side, ranks each team's own games most-recent-first, and keeps only
    // the top 10 before counting wins/losses. One query for every team
    // rather than 20 (one per team), same "fewer round trips" reasoning as
    // the rebounds query above and elsewhere in this app.
    const last10Rows = await db.execute<{ teamId: string; wins: number; losses: number }>(sql`
      WITH team_games AS (
        SELECT home_team_id AS team_id, tipoff_at, (home_score > away_score) AS won
        FROM games WHERE season = ${season} AND status = 'final'
        UNION ALL
        SELECT away_team_id AS team_id, tipoff_at, (away_score > home_score) AS won
        FROM games WHERE season = ${season} AND status = 'final'
      ),
      ranked AS (
        SELECT team_id, won, row_number() OVER (PARTITION BY team_id ORDER BY tipoff_at DESC) AS rn
        FROM team_games
      )
      SELECT
        team_id AS "teamId",
        sum(CASE WHEN won THEN 1 ELSE 0 END)::int AS wins,
        sum(CASE WHEN NOT won THEN 1 ELSE 0 END)::int AS losses
      FROM ranked
      WHERE rn <= 10
      GROUP BY team_id
    `);
    const last10ByTeam = new Map(last10Rows.map((r) => [r.teamId, { wins: r.wins, losses: r.losses }]));

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
        rpg: rpgByTeam.get(stats.teamId) ?? null,
        last10: last10ByTeam.get(stats.teamId) ?? null,
      },
    }));

    res.json(payload);
  } catch (err) {
    console.error("GET /api/standings failed:", err);
    res.status(500).json({ error: "Failed to load standings" });
  }
});