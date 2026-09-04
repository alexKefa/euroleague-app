import { Router } from "express";
import { eq, and, or, asc, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { teams, players, playerSeasonStats, games, playerInjuries } from "../db/schema.js";
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
    // Scoped to teams actually in getCurrentSeason()'s schedule, not every
    // row ever synced — otherwise a team no longer in the competition (e.g.
    // AS Monaco, out for 2026-27, found 2026-09-02) keeps showing up in the
    // Teams hub, the favorite-team picker, and every other GET /teams
    // consumer, even though it can't be picked as "your team" or have a
    // current roster/collectible meaningfully tied to it. Its `teams` row,
    // 2025-26 games, and stats are untouched — this only narrows what this
    // one endpoint returns, real history stays intact.
    const season = await getCurrentSeason();
    if (!season) {
      const rows = await db.select().from(teams);
      return res.json(rows);
    }

    const rows = await db
      .selectDistinct({ team: teams })
      .from(teams)
      .innerJoin(games, or(eq(games.homeTeamId, teams.id), eq(games.awayTeamId, teams.id)))
      .where(eq(games.season, season));
    res.json(rows.map((r) => r.team));
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
      .select({ player: players, stats: playerSeasonStats, injury: playerInjuries })
      .from(players)
      .leftJoin(
        playerSeasonStats,
        and(eq(playerSeasonStats.playerId, players.id), eq(playerSeasonStats.season, season))
      )
      // Admin-entered, not synced — see schema.ts's doc comment on
      // playerInjuries. Left join since most players have no row at all
      // (healthy), not a status value to default.
      .leftJoin(playerInjuries, eq(playerInjuries.playerId, players.id))
      // active: false excludes a player roster_sync.py found on no team's
      // current-season roster (departed the league entirely) — see the
      // schema comment on players.active. A same-league transfer doesn't
      // hit this at all, since that player's team_id already moved to
      // their new team.
      .where(and(eq(players.teamId, teamId), eq(players.active, true)))
      .orderBy(desc(playerSeasonStats.pointsPerGame));

    const withStats = rows.map((r) => ({
      player: r.player,
      stats: r.stats ?? emptyStats(r.player.id, teamId, season),
      injury: r.injury,
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