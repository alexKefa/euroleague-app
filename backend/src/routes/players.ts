import { Router } from "express";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { players, playerSeasonStats, playerGameStats, games, teams, shotEvents } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";

export const playersRouter = Router();

const homeTeam = alias(teams, "home_team_p");
const awayTeam = alias(teams, "away_team_p");

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

    // Anchor on the app's own "current season" (latest season with games
    // synced — see services/season.ts), not "latest season that happens to
    // have player_season_stats rows": during a season transition those
    // disagree, and picking the stats table's own latest season silently
    // falls back to showing last season's leaders as if they were current
    // (caught 2026-09-02 going into the 2026-27 transition, when 2026-27
    // had zero player_season_stats rows and this fell back to 2025-26).
    const season = await getCurrentSeason();
    if (!season) {
      return res.json([]);
    }

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
          logoUrl: r.team.logoUrl,
        },
      }))
    );
  } catch (err) {
    console.error("GET /api/players/leaders failed:", err);
    res.status(500).json({ error: "Failed to load player leaders" });
  }
});

// Top PIR (valuation) performance(s) for a round — defaults to the current
// season's most recently *completed* round (every game in it final) when
// season/round aren't given, same "complete round" definition
// services/cards.ts uses for perfect-round card grants. Scoped to
// getCurrentSeason() rather than "most recently completed round across
// every season ever synced" — the latter used to fall back to a real,
// legitimately-completed round from *last* season (e.g. 2025-26's round 38)
// once the new season starts with zero completed rounds of its own, which
// reads as this season's "top performances" when it's actually stale —
// same reasoning as GET /leaders (see the comment there).
playersRouter.get("/round-mvp", async (req, res) => {
  try {
    let season = typeof req.query.season === "string" ? req.query.season : null;
    let round = req.query.round ? Number(req.query.round) : null;

    if (!season || !round) {
      const currentSeason = await getCurrentSeason();
      if (!currentSeason) {
        return res.json({ season: null, round: null, leaders: [] });
      }

      const seasonGames = await db
        .select({ round: games.round, status: games.status })
        .from(games)
        .where(and(eq(games.season, currentSeason), isNotNull(games.round)));

      const byRound = new Map<number, { total: number; final: number }>();
      for (const g of seasonGames) {
        const entry = byRound.get(g.round!) ?? { total: 0, final: 0 };
        entry.total += 1;
        if (g.status === "final") entry.final += 1;
        byRound.set(g.round!, entry);
      }

      const completed = [...byRound.entries()].filter(([, e]) => e.final === e.total).sort((a, b) => b[0] - a[0]);

      if (completed.length === 0) {
        res.json({ season: null, round: null, leaders: [] });
        return;
      }
      season = currentSeason;
      round = completed[0][0];
    }

    const limit = Math.min(Number(req.query.limit) || 1, 20);

    const rows = await db
      .select({ stat: playerGameStats, player: players, team: teams })
      .from(playerGameStats)
      .innerJoin(games, eq(playerGameStats.gameId, games.id))
      .innerJoin(players, eq(playerGameStats.playerId, players.id))
      .innerJoin(teams, eq(players.teamId, teams.id))
      .where(and(eq(games.season, season), eq(games.round, round), isNotNull(playerGameStats.valuation)))
      .orderBy(desc(playerGameStats.valuation))
      .limit(limit);

    res.json({
      season,
      round,
      leaders: rows.map((r) => ({
        player: { id: r.player.id, code: r.player.code, name: r.player.name },
        team: {
          id: r.team.id,
          code: r.team.code,
          name: r.team.name,
          primaryColor: r.team.primaryColor,
          logoUrl: r.team.logoUrl,
        },
        valuation: r.stat.valuation,
        points: r.stat.points,
        gameId: r.stat.gameId,
      })),
    });
  } catch (err) {
    console.error("GET /api/players/round-mvp failed:", err);
    res.status(500).json({ error: "Failed to load round MVP" });
  }
});

// Full per-player advanced-stats table for the latest season — everything
// playerSeasonStats has (shooting efficiency, rebound/assist/turnover
// rates, possessions/game), not just the six categories /leaders exposes.
// Small dataset (one row per player, ~200 rows), so it's returned whole and
// sorted/filtered/searched client-side rather than via query params — an
// analyst comparing columns wants the full table, not a fixed top-N.
playersRouter.get("/advanced-stats", async (req, res) => {
  try {
    // Deliberately NOT getCurrentSeason() here, unlike GET /leaders —
    // tried that first (2026-09-02) and it broke /compare, which sources
    // its entire player-search list from this same payload (see the
    // CLAUDE.md comment on /compare): with zero 2026-27 player_season_stats
    // rows synced yet, the search box had nothing to search at all, not
    // just an empty leaderboard. /leaders is a "these are this season's
    // leaders" claim, where showing last season's numbers as current is
    // actively misleading — /stats and /compare are closer to
    // GET /players/:id's "latest known numbers for this player", where
    // showing last season's real stats until this season has its own is
    // the useful behavior, not a bug.
    const latest = await db
      .select({ season: playerSeasonStats.season })
      .from(playerSeasonStats)
      .orderBy(desc(playerSeasonStats.season))
      .limit(1);

    if (latest.length === 0) {
      return res.json({ season: null, rows: [] });
    }
    const season = latest[0].season;

    const rows = await db
      .select({ player: players, team: teams, stats: playerSeasonStats })
      .from(playerSeasonStats)
      .innerJoin(players, eq(playerSeasonStats.playerId, players.id))
      // players.teamId (current roster team), not playerSeasonStats.teamId
      // (a snapshot of whatever team the player was on *that season*) — a
      // transferred player should show their current team here even while
      // showing last season's stats, same "latest known numbers, current
      // team" intent as GET /players/:id.
      .innerJoin(teams, eq(players.teamId, teams.id))
      .where(eq(playerSeasonStats.season, season));

    res.json({ season, rows });
  } catch (err) {
    console.error("GET /api/players/advanced-stats failed:", err);
    res.status(500).json({ error: "Failed to load advanced stats" });
  }
});

// Season shot chart — every field-goal attempt (coordX/coordY, made or not)
// for one player, for their most-shots season by default. Coordinates are
// EuroLeague's own system (cm, origin at the basket, Y increasing away from
// the hoop) straight from the feed — see shot_sync.py's doc comment — so
// the frontend just needs to scale/flip them onto whatever court SVG it
// draws, no transform happens here.
playersRouter.get("/:id/shots", async (req, res) => {
  try {
    const playerId = req.params.id;
    let season = typeof req.query.season === "string" ? req.query.season : null;

    if (!season) {
      const latest = await db
        .select({ season: shotEvents.season })
        .from(shotEvents)
        .where(eq(shotEvents.playerId, playerId))
        .orderBy(desc(shotEvents.season))
        .limit(1);
      if (latest.length === 0) {
        res.json({ season: null, attempts: 0, made: 0, fieldGoalPct: null, shots: [] });
        return;
      }
      season = latest[0].season;
    }

    const rows = await db
      .select()
      .from(shotEvents)
      .where(and(eq(shotEvents.playerId, playerId), eq(shotEvents.season, season)));

    const made = rows.filter((r) => r.made).length;

    res.json({
      season,
      attempts: rows.length,
      made,
      fieldGoalPct: rows.length > 0 ? Math.round((made / rows.length) * 1000) / 10 : null,
      shots: rows.map((r) => ({
        x: r.coordX,
        y: r.coordY,
        made: r.made,
        actionId: r.actionId,
        zone: r.zone,
      })),
    });
  } catch (err) {
    console.error("GET /api/players/:id/shots failed:", err);
    res.status(500).json({ error: "Failed to load shot chart" });
  }
});

// Per-game boxscore log for one player — every "final" game they have a row
// in player_game_stats for, most recent first. Defaults to their most
// recent season with any final-game data, same "default to latest" pattern
// as GET /:id/shots. Live games are deliberately excluded: the live-score
// simulator upserts player_game_stats every tick (see realtime/
// liveScoreSimulator.ts), so a live row is a transient in-progress line, not
// a finished result a "log" should list.
playersRouter.get("/:id/games", async (req, res) => {
  try {
    const playerId = req.params.id;
    let season = typeof req.query.season === "string" ? req.query.season : null;

    if (!season) {
      const latest = await db
        .select({ season: games.season })
        .from(playerGameStats)
        .innerJoin(games, eq(playerGameStats.gameId, games.id))
        .where(and(eq(playerGameStats.playerId, playerId), eq(games.status, "final")))
        .orderBy(desc(games.season))
        .limit(1);
      if (latest.length === 0) {
        res.json({ season: null, rows: [] });
        return;
      }
      season = latest[0].season;
    }

    const rows = await db
      .select({
        gameId: games.id,
        round: games.round,
        tipoffAt: games.tipoffAt,
        homeScore: games.homeScore,
        awayScore: games.awayScore,
        homeTeamId: homeTeam.id,
        homeTeamCode: homeTeam.code,
        homeTeamName: homeTeam.name,
        homeTeamPrimaryColor: homeTeam.primaryColor,
        homeTeamLogoUrl: homeTeam.logoUrl,
        awayTeamId: awayTeam.id,
        awayTeamCode: awayTeam.code,
        awayTeamName: awayTeam.name,
        awayTeamPrimaryColor: awayTeam.primaryColor,
        awayTeamLogoUrl: awayTeam.logoUrl,
        stats: playerGameStats,
      })
      .from(playerGameStats)
      .innerJoin(games, eq(playerGameStats.gameId, games.id))
      .innerJoin(homeTeam, eq(games.homeTeamId, homeTeam.id))
      .innerJoin(awayTeam, eq(games.awayTeamId, awayTeam.id))
      .where(and(eq(playerGameStats.playerId, playerId), eq(games.season, season), eq(games.status, "final")))
      .orderBy(desc(games.tipoffAt));

    res.json({
      season,
      rows: rows.map((r) => ({
        game: {
          id: r.gameId,
          round: r.round,
          tipoffAt: r.tipoffAt,
          homeScore: r.homeScore,
          awayScore: r.awayScore,
          homeTeam: {
            id: r.homeTeamId,
            code: r.homeTeamCode,
            name: r.homeTeamName,
            primaryColor: r.homeTeamPrimaryColor,
            logoUrl: r.homeTeamLogoUrl,
          },
          awayTeam: {
            id: r.awayTeamId,
            code: r.awayTeamCode,
            name: r.awayTeamName,
            primaryColor: r.awayTeamPrimaryColor,
            logoUrl: r.awayTeamLogoUrl,
          },
        },
        stats: r.stats,
      })),
    });
  } catch (err) {
    console.error("GET /api/players/:id/games failed:", err);
    res.status(500).json({ error: "Failed to load player game log" });
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