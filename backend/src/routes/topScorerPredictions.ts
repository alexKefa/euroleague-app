import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { topScorerPredictions, games, players, playerGameStats, teams } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import {
  computeTopScorerPlayerId,
  computeTopScorerPlayerIdsForGames,
  getTopScorerBaselinePPG,
  isTopScorerPickLocked,
  pointsForCorrectTopScorerPick,
  TOP_SCORER_POINTS_PER_CORRECT,
} from "../services/topScorerPoints.js";

const homeTeam = alias(teams, "home_team_tsp");
const awayTeam = alias(teams, "away_team_tsp");

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

    // Priced right now — off this player's season/career baseline PPG
    // *and* how the live game has actually gone so far (points already on
    // the board for them, how much of the game is left) — and stored,
    // never recomputed later. Same "fixed snapshot at the exact moment of
    // the pick" convention as game_odds: re-picking the same player later
    // (mid-live-game, up until Q4) always re-prices at *that* moment off
    // the live state as of then, but once written it's what the pick is
    // worth, full stop — see schema.ts's doc comment on pointsAtPick and
    // topScorerPoints.ts's 2026-09-10 file comment for why re-picking
    // mid-game now prices differently than a pre-tipoff pick would have.
    const baselinePPG = await getTopScorerBaselinePPG(playerId, game.season);
    const [liveLine] = await db
      .select({ points: playerGameStats.points })
      .from(playerGameStats)
      .where(and(eq(playerGameStats.gameId, gameId), eq(playerGameStats.playerId, playerId)))
      .limit(1);
    const pointsAtPick = pointsForCorrectTopScorerPick({
      baselinePPG,
      pointsSoFar: liveLine?.points ?? 0,
      quarter: game.quarter,
      gameClockSeconds: game.gameClockSeconds,
    });

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

// All of the caller's top-scorer picks across every game, newest first —
// the aggregate view game-detail.ts's per-game GET /:gameId deliberately
// doesn't provide (see that route's comment). Mirrors predictions.ts's
// GET /me shape/precedent exactly (one capped, joined, ordered query, not
// an export), for the Predictions page's new "Top scorer" tab. Registered
// before GET /:gameId so "me" isn't swallowed as a :gameId param.
topScorerPredictionsRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select({ prediction: topScorerPredictions, game: games, predictedPlayer: players, homeTeam, awayTeam })
      .from(topScorerPredictions)
      .innerJoin(games, eq(topScorerPredictions.gameId, games.id))
      .innerJoin(players, eq(topScorerPredictions.predictedPlayerId, players.id))
      .innerJoin(homeTeam, eq(games.homeTeamId, homeTeam.id))
      .innerJoin(awayTeam, eq(games.awayTeamId, awayTeam.id))
      .where(eq(topScorerPredictions.userId, req.userId!))
      .orderBy(desc(games.tipoffAt))
      .limit(40);

    const leaderByGame = await computeTopScorerPlayerIdsForGames(rows.map((r) => r.game.id));

    const payload = rows.map(({ prediction, game, predictedPlayer, homeTeam: home, awayTeam: away }) => {
      // Map lookup is undefined for a not-yet-final game or a final one with
      // no box score synced yet, and null for a tied game-high — both read
      // as "no result to compare against" the same way.
      const topScorerPlayerId = leaderByGame.get(game.id);
      return {
        id: prediction.id,
        gameId: game.id,
        tipoffAt: game.tipoffAt,
        status: game.status,
        homeTeam: { id: home.id, code: home.code, name: home.name },
        awayTeam: { id: away.id, code: away.code, name: away.name },
        predictedPlayer: { id: predictedPlayer.id, code: predictedPlayer.code, name: predictedPlayer.name },
        isCorrect: topScorerPlayerId == null ? null : topScorerPlayerId === prediction.predictedPlayerId,
        pointsAtPick: prediction.pointsAtPick ?? TOP_SCORER_POINTS_PER_CORRECT,
      };
    });

    res.json(payload);
  } catch (err) {
    console.error("GET /api/top-scorer-predictions/me failed:", err);
    res.status(500).json({ error: "Failed to load top scorer picks" });
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
