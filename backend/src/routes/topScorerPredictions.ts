import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { topScorerPredictions, games, players, playerSeasonStats } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import {
  computeTopScorerPlayerId,
  isTopScorerPickLocked,
  pointsForCorrectTopScorerPick,
  TOP_SCORER_POINTS_PER_CORRECT,
} from "../services/topScorerPoints.js";

export const topScorerPredictionsRouter = Router();

topScorerPredictionsRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { gameId, playerId } = req.body ?? {};
    if (typeof gameId !== "string" || typeof playerId !== "string") {
      res.status(400).json({ error: "gameId and playerId are required" });
      return;
    }

    const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    // Intentional deviation from predictions.ts's tipoff lock: this is a
    // live in-game prop, so a pick is allowed pre-tipoff or any time the
    // game is live, up until the 4th quarter starts — see
    // isTopScorerPickLocked's doc comment for why that cutoff (not tipoff,
    // not final) was chosen.
    if (isTopScorerPickLocked(game)) {
      res.status(400).json({ error: "Picks lock once the 4th quarter starts" });
      return;
    }

    const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
    if (!player || (player.teamId !== game.homeTeamId && player.teamId !== game.awayTeamId)) {
      res.status(400).json({ error: "playerId must be on one of the two teams playing this game" });
      return;
    }

    // Priced right now, off this player's current season PPG, and stored —
    // never recomputed later. Same "fixed snapshot at the exact moment of
    // the pick" convention as game_odds: re-picking the same player later
    // (or the same pick just sitting through a live game while PPG data
    // syncs) always re-prices at *that* moment, but once written it's what
    // the pick is worth, full stop — see schema.ts's doc comment on
    // pointsAtPick.
    const [stats] = await db
      .select({ pointsPerGame: playerSeasonStats.pointsPerGame })
      .from(playerSeasonStats)
      .where(and(eq(playerSeasonStats.playerId, playerId), eq(playerSeasonStats.season, game.season)))
      .limit(1);
    const pointsAtPick = pointsForCorrectTopScorerPick(stats?.pointsPerGame ?? null);

    const [prediction] = await db
      .insert(topScorerPredictions)
      .values({ userId: req.userId!, gameId, predictedPlayerId: playerId, pointsAtPick })
      .onConflictDoUpdate({
        target: [topScorerPredictions.userId, topScorerPredictions.gameId],
        set: { predictedPlayerId: playerId, pointsAtPick },
      })
      .returning();

    res.status(201).json({
      id: prediction.id,
      gameId: prediction.gameId,
      predictedPlayer: { id: player.id, code: player.code, name: player.name },
      isCorrect: null,
      pointsAtPick: prediction.pointsAtPick ?? TOP_SCORER_POINTS_PER_CORRECT,
    });
  } catch (err) {
    console.error("POST /api/top-scorer-predictions failed:", err);
    res.status(500).json({ error: "Failed to save top scorer pick" });
  }
});

// Same no-op-if-missing semantics as predictions.ts's DELETE /:gameId.
topScorerPredictionsRouter.delete("/:gameId", requireAuth, async (req, res) => {
  try {
    const { gameId } = req.params;

    const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    if (isTopScorerPickLocked(game)) {
      res.status(400).json({ error: "Picks lock once the 4th quarter starts" });
      return;
    }

    await db
      .delete(topScorerPredictions)
      .where(and(eq(topScorerPredictions.userId, req.userId!), eq(topScorerPredictions.gameId, gameId)));
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/top-scorer-predictions/:gameId failed:", err);
    res.status(500).json({ error: "Failed to remove top scorer pick" });
  }
});

// Scoped to one game — what game-detail.ts calls on load, independent of
// how many other top-scorer picks the user has made elsewhere.
topScorerPredictionsRouter.get("/:gameId", requireAuth, async (req, res) => {
  try {
    const { gameId } = req.params;

    const [row] = await db
      .select({ prediction: topScorerPredictions, player: players })
      .from(topScorerPredictions)
      .innerJoin(players, eq(topScorerPredictions.predictedPlayerId, players.id))
      .where(and(eq(topScorerPredictions.userId, req.userId!), eq(topScorerPredictions.gameId, gameId)))
      .limit(1);

    if (!row) {
      res.json(null);
      return;
    }

    const topScorerPlayerId = await computeTopScorerPlayerId(gameId);
    res.json({
      id: row.prediction.id,
      gameId: row.prediction.gameId,
      predictedPlayer: { id: row.player.id, code: row.player.code, name: row.player.name },
      isCorrect: topScorerPlayerId === null ? null : topScorerPlayerId === row.prediction.predictedPlayerId,
      // Read straight from the stored column, never recomputed here — this
      // is "what the pick was worth at the exact moment it was made", not
      // a live re-price off the player's PPG as of right now (see
      // schema.ts's doc comment on pointsAtPick).
      pointsAtPick: row.prediction.pointsAtPick ?? TOP_SCORER_POINTS_PER_CORRECT,
    });
  } catch (err) {
    console.error("GET /api/top-scorer-predictions/:gameId failed:", err);
    res.status(500).json({ error: "Failed to load top scorer pick" });
  }
});
