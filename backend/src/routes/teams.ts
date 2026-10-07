import { Router } from "express";
import { eq, and, or, asc, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { teams, players, playerSeasonStats, games, playerInjuries, users, teamBudgets } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";
import { getBaselinePPGForPlayers } from "../services/topScorerPoints.js";
import { getTeamAnalytics } from "../services/teamAnalytics.js";
import { getTeamRestSplits } from "../services/restSplits.js";
import { getTeamReferees } from "../services/refereeStats.js";

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

// Fan map (2026-10-02): every team with how many users picked it as their
// favourite. One grouped statement; teams with no fans included at 0.
teamsRouter.get("/fans", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: teams.id,
        code: teams.code,
        name: teams.name,
        city: teams.city,
        primaryColor: teams.primaryColor,
        secondaryColor: teams.secondaryColor,
        logoUrl: teams.logoUrl,
        fans: sql<number>`count(${users.id})::int`,
      })
      .from(teams)
      .leftJoin(users, eq(users.favoriteTeamId, teams.id))
      .groupBy(teams.id)
      .orderBy(desc(sql`count(${users.id})`), asc(teams.name));
    res.json(rows);
  } catch (err) {
    console.error("GET /api/teams/fans failed:", err);
    res.status(500).json({ error: "Failed to load fan counts" });
  }
});

// One team's fans for the fan map's city sheet: usernames only, the same
// names already public on the leaderboards. Newest fans first, capped.
teamsRouter.get("/:id/fans", async (req, res) => {
  try {
    const rows = await db
      .select({ id: users.id, username: users.username, joinedAt: users.createdAt })
      .from(users)
      .where(eq(users.favoriteTeamId, req.params.id))
      .orderBy(desc(users.createdAt))
      .limit(200);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/teams/:id/fans failed:", err);
    res.status(400).json({ error: "Failed to load fans" });
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

    // baselinePpg (2026-09-22, "sort by ppg") — a separate, additive field
    // alongside stats.pointsPerGame, not a replacement for it: this
    // roster's own table correctly shows "—" for a player with no *this
    // season* row yet (2026-27 has zero played games as of this pass, so
    // every stats.pointsPerGame here is null), and that's the right call
    // for a "this season" column — overwriting it with a career number
    // would silently relabel last season's stats as this season's, the
    // exact mislabeling CLAUDE.md already reasoned through for
    // /players/leaders vs /players/:id. This field exists purely for
    // callers that want *some* real number to sort/inform a decision by
    // (the top-scorer picker, shared/top-scorer-picker.ts) even before the
    // season has real games — same season-then-career fallback the
    // top-scorer points formula itself already uses to price a pick.
    const baselinePpgByPlayerId = await getBaselinePPGForPlayers(rows.map((r) => r.player.id), season);

    const withStats = rows.map((r) => ({
      player: r.player,
      stats: r.stats ?? emptyStats(r.player.id, teamId, season),
      injury: r.injury,
      baselinePpg: baselinePpgByPlayerId.get(r.player.id) ?? null,
    }));

    res.json(withStats);
  } catch (err) {
    console.error("GET /api/teams/:id/roster failed:", err);
    res.status(500).json({ error: "Failed to load roster" });
  }
});

// Shot profile, lineups, on/off and clutch (2026-10-06), see
// services/teamAnalytics.ts. Current season unless ?season= is given.
teamsRouter.get("/:id/analytics", async (req, res) => {
  try {
    const season = typeof req.query.season === "string" ? req.query.season : await getCurrentSeason();
    if (!season) return res.status(404).json({ error: "No season" });
    res.json(await getTeamAnalytics(req.params.id, season));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load team analytics" });
  }
});

// This team's record and fouls with each referee (2026-10-06), see services/refereeStats.ts.
teamsRouter.get("/:id/referees", async (req, res) => {
  try {
    res.json(await getTeamReferees(req.params.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load team referees" });
  }
});

// Reported payroll / budget (2026-10-07): this team's most recent
// team_budgets row, or null if it has never disclosed one.
teamsRouter.get("/:id/budget", async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(teamBudgets)
      .where(eq(teamBudgets.teamId, req.params.id))
      .orderBy(desc(teamBudgets.season))
      .limit(1);
    res.json(row ?? null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load team budget" });
  }
});

// Short-rest splits (2026-10-06), see services/restSplits.ts.
teamsRouter.get("/:id/rest-splits", async (req, res) => {
  try {
    res.json(await getTeamRestSplits(req.params.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load rest splits" });
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