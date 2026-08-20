import { Router } from "express";
import { eq, and, isNotNull, asc, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { teams, games } from "../db/schema.js";

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