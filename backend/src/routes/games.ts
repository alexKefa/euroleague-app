import { Router } from "express";
import { eq, and, inArray, isNotNull, asc, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { teams, games, players, playerGameStats, playerSeasonStats, teamSeasonStats } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";

export const gamesRouter = Router();

const homeTeam = alias(teams, "home_team_g");
const awayTeam = alias(teams, "away_team_g");

const DEFAULT_SEASON = "2026-27";

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
        quarter: games.quarter,
        gameClockSeconds: games.gameClockSeconds,
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

// Every round number that has games in a season, for the schedule page's
// round picker.
gamesRouter.get("/rounds", async (req, res) => {
  try {
    const season = typeof req.query.season === "string" ? req.query.season : DEFAULT_SEASON;

    const rows = await db
      .selectDistinct({ round: games.round })
      .from(games)
      .where(and(eq(games.season, season), isNotNull(games.round)));

    const rounds = rows.map((r) => r.round!).sort((a, b) => a - b);
    res.json({ season, rounds });
  } catch (err) {
    console.error("GET /api/games/rounds failed:", err);
    res.status(500).json({ error: "Failed to load rounds" });
  }
});

// A single round's full schedule. Defaults to the first round that isn't
// entirely final yet (the round a visitor most likely wants), falling back
// to the last round once the whole season is done.
gamesRouter.get("/schedule", async (req, res) => {
  try {
    const season = typeof req.query.season === "string" ? req.query.season : DEFAULT_SEASON;
    let round = req.query.round ? Number(req.query.round) : null;

    if (!round || Number.isNaN(round)) {
      const roundStatuses = await db
        .select({ round: games.round, status: games.status })
        .from(games)
        .where(and(eq(games.season, season), isNotNull(games.round)));

      const byRound = new Map<number, string[]>();
      for (const r of roundStatuses) {
        const arr = byRound.get(r.round!) ?? [];
        arr.push(r.status);
        byRound.set(r.round!, arr);
      }
      const sortedRounds = [...byRound.keys()].sort((a, b) => a - b);
      round =
        sortedRounds.find((rnd) => byRound.get(rnd)!.some((s) => s !== "final")) ??
        sortedRounds[sortedRounds.length - 1] ??
        1;
    }

    const rows = await db
      .select({
        id: games.id,
        gameCode: games.gameCode,
        round: games.round,
        status: games.status,
        tipoffAt: games.tipoffAt,
        homeScore: games.homeScore,
        awayScore: games.awayScore,
        quarter: games.quarter,
        gameClockSeconds: games.gameClockSeconds,
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
      .where(and(eq(games.season, season), eq(games.round, round)))
      .orderBy(asc(games.tipoffAt));

    res.json({ season, round, games: rows });
  } catch (err) {
    console.error("GET /api/games/schedule failed:", err);
    res.status(500).json({ error: "Failed to load schedule" });
  }
});

interface GameBoxscoreLine {
  player: { id: string; code: string; name: string };
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  valuation: number | null;
}

const byValuationDesc = (a: { valuation: number | null }, b: { valuation: number | null }) =>
  (b.valuation ?? -Infinity) - (a.valuation ?? -Infinity);

// Game analysis: the box score (once final) plus season-stats-driven
// "players to watch" and a team comparison, so a still-scheduled game has
// something to show too, not just a blank page waiting for tipoff.
// Registered after the literal /rounds and /schedule routes above so this
// param route doesn't shadow them.
gamesRouter.get("/:id", async (req, res) => {
  try {
    const gameId = req.params.id;

    const [game] = await db
      .select({
        id: games.id,
        gameCode: games.gameCode,
        season: games.season,
        round: games.round,
        status: games.status,
        tipoffAt: games.tipoffAt,
        homeScore: games.homeScore,
        awayScore: games.awayScore,
        quarter: games.quarter,
        gameClockSeconds: games.gameClockSeconds,
        highlightVideoId: games.highlightVideoId,
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
      .where(eq(games.id, gameId))
      .limit(1);

    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }

    // Team/player season stats are keyed by season, but a game's own season
    // (e.g. 2026-27) may not have any played games yet — same "pick the
    // season with real games" reasoning as /api/standings and
    // /api/teams/:id/roster, reused here so a preview of an upcoming game
    // still has something to show instead of a wall of nulls.
    const mostActiveSeason = await db
      .select({
        season: teamSeasonStats.season,
        totalGames: sql<number>`sum(${teamSeasonStats.wins} + ${teamSeasonStats.losses})`,
      })
      .from(teamSeasonStats)
      .groupBy(teamSeasonStats.season)
      .orderBy(sql`sum(${teamSeasonStats.wins} + ${teamSeasonStats.losses}) desc`)
      .limit(1);
    const statsSeason = mostActiveSeason[0]?.season ?? game.season;

    const [homeStats, awayStats] = await Promise.all([
      db
        .select()
        .from(teamSeasonStats)
        .where(and(eq(teamSeasonStats.teamId, game.homeTeam.id), eq(teamSeasonStats.season, statsSeason)))
        .limit(1),
      db
        .select()
        .from(teamSeasonStats)
        .where(and(eq(teamSeasonStats.teamId, game.awayTeam.id), eq(teamSeasonStats.season, statsSeason)))
        .limit(1),
    ]);

    // "Players to watch" — each team's top-3 by PIR in statsSeason, on
    // their *current* roster (see the traded-player stat-split gap in
    // CLAUDE.md — season stats aren't split per team, so this reflects
    // whichever team a player is on now, not necessarily when they were
    // earned). Shown regardless of game status: useful hype pre-game,
    // useful context post-game.
    const rosterStats = await db
      .select({ stat: playerSeasonStats, player: players })
      .from(playerSeasonStats)
      .innerJoin(players, eq(playerSeasonStats.playerId, players.id))
      .where(
        and(eq(playerSeasonStats.season, statsSeason), inArray(players.teamId, [game.homeTeam.id, game.awayTeam.id]))
      );

    const topByTeam = (teamId: string) =>
      rosterStats
        .filter((r) => r.player.teamId === teamId)
        .sort((a, b) => (b.stat.valuation ?? -Infinity) - (a.stat.valuation ?? -Infinity))
        .slice(0, 3)
        .map((r) => ({
          player: { id: r.player.id, code: r.player.code, name: r.player.name },
          pointsPerGame: r.stat.pointsPerGame,
          reboundsPerGame: r.stat.reboundsPerGame,
          assistsPerGame: r.stat.assistsPerGame,
          valuation: r.stat.valuation,
        }));

    let boxscore: { home: GameBoxscoreLine[]; away: GameBoxscoreLine[] } | null = null;
    let topPerformers: GameBoxscoreLine[] = [];
    let doubleDoubles: GameBoxscoreLine[] = [];

    // Live games get the same box score computation as final ones — the
    // live-score simulator (see realtime/liveScoreSimulator.ts) writes into
    // player_game_stats on every tick, same table the real boxscore sync
    // fills for completed games, so this naturally lights up mid-game too.
    if (game.status === "final" || game.status === "live") {
      const lines = await db
        .select({ stat: playerGameStats, player: players })
        .from(playerGameStats)
        .innerJoin(players, eq(playerGameStats.playerId, players.id))
        .where(eq(playerGameStats.gameId, gameId));

      const toLine = (r: (typeof lines)[number]): GameBoxscoreLine & { teamId: string } => ({
        player: { id: r.player.id, code: r.player.code, name: r.player.name },
        minutes: r.stat.minutes,
        points: r.stat.points,
        rebounds: r.stat.rebounds,
        assists: r.stat.assists,
        steals: r.stat.steals,
        blocks: r.stat.blocksFavour,
        turnovers: r.stat.turnovers,
        valuation: r.stat.valuation,
        teamId: r.player.teamId,
      });

      const allLines = lines.map(toLine);
      boxscore = {
        home: allLines.filter((l) => l.teamId === game.homeTeam.id).sort(byValuationDesc),
        away: allLines.filter((l) => l.teamId === game.awayTeam.id).sort(byValuationDesc),
      };
      topPerformers = [...allLines].sort(byValuationDesc).slice(0, 5);
      // Standard basketball double-double: 10+ in at least 2 of the five
      // main box-score categories.
      doubleDoubles = allLines.filter(
        (l) => [l.points, l.rebounds, l.assists, l.steals, l.blocks].filter((v) => (v ?? 0) >= 10).length >= 2
      );
    }

    res.json({
      game,
      statsSeason,
      teamComparison: { home: homeStats[0] ?? null, away: awayStats[0] ?? null },
      playersToWatch: { home: topByTeam(game.homeTeam.id), away: topByTeam(game.awayTeam.id) },
      boxscore,
      topPerformers,
      doubleDoubles,
    });
  } catch (err) {
    console.error("GET /api/games/:id failed:", err);
    res.status(500).json({ error: "Failed to load game" });
  }
});

// Admin-set for now, same pattern as collectibles' PATCH /:id imageUrl —
// there's no sync source that maps a game to its official highlight video
// yet, so this is a manual stopgap.
gamesRouter.patch("/:id/highlight", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { highlightVideoId } = req.body ?? {};
    if (highlightVideoId !== undefined && typeof highlightVideoId !== "string") {
      res.status(400).json({ error: "highlightVideoId must be a string" });
      return;
    }
    const trimmed = highlightVideoId?.trim() || null;
    // Column is varchar(32) — a real YouTube video ID is 11 chars, this just
    // guards against a bad paste (a full URL, say) crashing the request with
    // a raw Postgres "value too long" error instead of a clean 400.
    if (trimmed && trimmed.length > 32) {
      res.status(400).json({ error: "highlightVideoId is too long — paste just the video ID, not a full URL" });
      return;
    }

    const [game] = await db.update(games).set({ highlightVideoId: trimmed }).where(eq(games.id, id)).returning();

    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }

    res.json(game);
  } catch (err) {
    console.error("PATCH /api/games/:id/highlight failed:", err);
    res.status(500).json({ error: "Failed to save highlight" });
  }
});