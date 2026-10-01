import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, quarterPredictions } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { openQuarterFor, quarterPickResult, QUARTER_PICK_POINTS } from "../services/quarterPicks.js";

// Live quarter picks (services/quarterPicks.ts for the rules).
export const quarterPicksRouter = Router();

const MAX_GAMES = 20;

type GameRow = typeof games.$inferSelect;
type PickRow = typeof quarterPredictions.$inferSelect;

function gameState(game: GameRow, picks: PickRow[]) {
  const { openQuarter, reason } = openQuarterFor(game);
  return {
    gameId: game.id,
    status: game.status,
    quarter: game.quarter,
    openQuarter,
    reason,
    pointsPerCorrect: QUARTER_PICK_POINTS,
    picks: picks
      .sort((a, b) => a.quarter - b.quarter)
      .map((p) => ({ quarter: p.quarter, pickedTeamId: p.pickedTeamId, result: quarterPickResult(game, p.quarter, p.pickedTeamId) })),
  };
}

// GET /api/quarter-picks?gameIds=a,b — open quarter + the user's picks per game.
quarterPicksRouter.get("/", requireAuth, async (req, res) => {
  try {
    const ids = String(req.query.gameIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_GAMES);
    if (ids.length === 0) {
      res.json({ games: [] });
      return;
    }
    const [gameRows, pickRows] = await Promise.all([
      db.select().from(games).where(inArray(games.id, ids)),
      db.select().from(quarterPredictions).where(and(eq(quarterPredictions.userId, req.userId!), inArray(quarterPredictions.gameId, ids))),
    ]);
    res.json({ games: gameRows.map((g) => gameState(g, pickRows.filter((p) => p.gameId === g.id))) });
  } catch (err) {
    console.error("GET /api/quarter-picks failed:", err);
    res.status(500).json({ error: "Failed to load quarter picks" });
  }
});

// POST /api/quarter-picks { gameId, quarter, pickedTeamId } — make or change
// the pick for the currently open quarter only.
quarterPicksRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { gameId, quarter, pickedTeamId } = req.body ?? {};
    if (typeof gameId !== "string" || typeof pickedTeamId !== "string" || !Number.isInteger(quarter)) {
      res.status(400).json({ error: "gameId, quarter and pickedTeamId are required" });
      return;
    }
    const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    if (pickedTeamId !== game.homeTeamId && pickedTeamId !== game.awayTeamId) {
      res.status(400).json({ error: "That team isn't in this game" });
      return;
    }
    const { openQuarter, reason } = openQuarterFor(game);
    if (openQuarter !== quarter) {
      res.status(409).json({ error: "That quarter isn't open for picks", code: reason === "stale" ? "PICKS_PAUSED" : "QUARTER_LOCKED" });
      return;
    }
    await db
      .insert(quarterPredictions)
      .values({ userId: req.userId!, gameId, quarter, pickedTeamId })
      .onConflictDoUpdate({
        target: [quarterPredictions.userId, quarterPredictions.gameId, quarterPredictions.quarter],
        set: { pickedTeamId, createdAt: new Date() },
      });
    const picks = await db
      .select()
      .from(quarterPredictions)
      .where(and(eq(quarterPredictions.userId, req.userId!), eq(quarterPredictions.gameId, gameId)));
    res.json(gameState(game, picks));
  } catch (err) {
    console.error("POST /api/quarter-picks failed:", err);
    res.status(500).json({ error: "Failed to save quarter pick" });
  }
});
