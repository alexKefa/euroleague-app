import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { predictions, games, teams, users, pointAdjustments } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { computeWinnerTeamId, getUserPoints, POINTS_PER_CORRECT } from "../services/points.js";
import { checkAndGrantRoundRewards } from "../services/cards.js";

export const predictionsRouter = Router();

interface ResolvedPick {
  round: number | null;
  tipoffAt: Date | string;
  correct: boolean;
}

interface BadgeInfo {
  id: string;
  label: string;
  description: string;
}

interface BadgeContext {
  picks: ResolvedPick[];
  hasAnyPick: boolean;
  totalPoints: number; // picks-derived points plus any manual adjustments
}

interface BadgeDef extends BadgeInfo {
  check: (ctx: BadgeContext) => boolean;
}

// Badge rules run against a user's *resolved* picks only (final games),
// sorted oldest-first so streak-style checks see chronological order.
const BADGES: BadgeDef[] = [
  {
    id: "first-call",
    label: "First Call",
    description: "Made your first prediction.",
    check: (ctx) => ctx.hasAnyPick,
  },
  {
    id: "on-a-roll",
    label: "On a Roll",
    description: "5 correct predictions in a row.",
    check: (ctx) => {
      let streak = 0;
      for (const p of ctx.picks) {
        streak = p.correct ? streak + 1 : 0;
        if (streak >= 5) return true;
      }
      return false;
    },
  },
  {
    id: "perfect-round",
    label: "Perfect Round",
    description: "Got every prediction right in a single round.",
    check: (ctx) => {
      const byRound = new Map<number, boolean[]>();
      for (const p of ctx.picks) {
        if (p.round === null) continue;
        const arr = byRound.get(p.round) ?? [];
        arr.push(p.correct);
        byRound.set(p.round, arr);
      }
      for (const arr of byRound.values()) {
        if (arr.every(Boolean)) return true;
      }
      return false;
    },
  },
  {
    id: "century",
    label: "Century",
    description: "Earned 100+ points.",
    check: (ctx) => ctx.totalPoints >= 100,
  },
  {
    id: "sharpshooter",
    label: "Sharpshooter",
    description: "75%+ accuracy across at least 10 resolved predictions.",
    check: (ctx) => {
      if (ctx.picks.length < 10) return false;
      return ctx.picks.filter((p) => p.correct).length / ctx.picks.length >= 0.75;
    },
  },
];

function earnedBadges(ctx: BadgeContext): BadgeInfo[] {
  return BADGES.filter((b) => b.check(ctx)).map(({ id, label, description }) => ({
    id,
    label,
    description,
  }));
}

predictionsRouter.post("/", requireAuth, async (req, res) => {
  const { gameId, teamId } = req.body ?? {};
  if (typeof gameId !== "string" || typeof teamId !== "string") {
    res.status(400).json({ error: "gameId and teamId are required" });
    return;
  }

  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  if (game.status !== "scheduled") {
    res.status(400).json({ error: "Predictions are only allowed before a game starts" });
    return;
  }
  if (teamId !== game.homeTeamId && teamId !== game.awayTeamId) {
    res.status(400).json({ error: "teamId must be one of the two teams playing this game" });
    return;
  }
  if (new Date(game.tipoffAt) <= new Date()) {
    res.status(400).json({ error: "This game has already started" });
    return;
  }

  const [prediction] = await db
    .insert(predictions)
    .values({ userId: req.userId!, gameId, predictedWinnerTeamId: teamId })
    .onConflictDoUpdate({
      target: [predictions.userId, predictions.gameId],
      set: { predictedWinnerTeamId: teamId },
    })
    .returning();

  res.status(201).json(prediction);
});

predictionsRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select({ prediction: predictions, game: games, predictedTeam: teams })
      .from(predictions)
      .innerJoin(games, eq(predictions.gameId, games.id))
      .innerJoin(teams, eq(predictions.predictedWinnerTeamId, teams.id))
      .where(eq(predictions.userId, req.userId!))
      .orderBy(desc(games.tipoffAt));

    const payload = rows.map(({ prediction, game, predictedTeam }) => {
      const winnerTeamId = computeWinnerTeamId(game);
      return {
        id: prediction.id,
        gameId: game.id,
        tipoffAt: game.tipoffAt,
        status: game.status,
        predictedTeam: { id: predictedTeam.id, code: predictedTeam.code, name: predictedTeam.name },
        isCorrect: winnerTeamId === null ? null : winnerTeamId === prediction.predictedWinnerTeamId,
      };
    });

    res.json(payload);
  } catch (err) {
    console.error("GET /api/predictions/me failed:", err);
    res.status(500).json({ error: "Failed to load predictions" });
  }
});

predictionsRouter.get("/leaderboard", async (_req, res) => {
  try {
    const [predictionRows, adjustmentRows] = await Promise.all([
      db
        .select({ prediction: predictions, game: games, user: users })
        .from(predictions)
        .innerJoin(games, eq(predictions.gameId, games.id))
        .innerJoin(users, eq(predictions.userId, users.id))
        .where(eq(games.status, "final")),
      db
        .select({ userId: pointAdjustments.userId, points: pointAdjustments.points, email: users.email })
        .from(pointAdjustments)
        .innerJoin(users, eq(pointAdjustments.userId, users.id)),
    ]);

    const byUser = new Map<string, { email: string; picks: ResolvedPick[] }>();
    for (const { prediction, game, user } of predictionRows) {
      const winnerTeamId = computeWinnerTeamId(game);
      if (winnerTeamId === null) continue;
      const entry = byUser.get(prediction.userId) ?? { email: user.email, picks: [] };
      entry.picks.push({
        round: game.round,
        tipoffAt: game.tipoffAt,
        correct: winnerTeamId === prediction.predictedWinnerTeamId,
      });
      byUser.set(prediction.userId, entry);
    }

    const bonusByUser = new Map<string, { email: string; bonus: number }>();
    for (const { userId, points, email } of adjustmentRows) {
      const entry = bonusByUser.get(userId) ?? { email, bonus: 0 };
      entry.bonus += points;
      bonusByUser.set(userId, entry);
    }

    const allUserIds = new Set([...byUser.keys(), ...bonusByUser.keys()]);

    const leaderboard = Array.from(allUserIds)
      .map((userId) => {
        const picks = byUser.get(userId)?.picks ?? [];
        picks.sort((a, b) => new Date(a.tipoffAt).getTime() - new Date(b.tipoffAt).getTime());
        const email = byUser.get(userId)?.email ?? bonusByUser.get(userId)!.email;
        const bonus = bonusByUser.get(userId)?.bonus ?? 0;
        const correct = picks.filter((p) => p.correct).length;
        const total = picks.length;
        const points = correct * POINTS_PER_CORRECT + bonus;
        return {
          userId,
          // Placeholder display name — no dedicated username field exists yet.
          // Showing full email addresses on a public leaderboard isn't great
          // practice, so this uses just the local part as a stand-in.
          displayName: email.split("@")[0],
          correct,
          total,
          accuracy: total > 0 ? correct / total : 0,
          points,
          badges: earnedBadges({ picks, hasAnyPick: total > 0, totalPoints: points }),
        };
      })
      .sort((a, b) => b.points - a.points || b.accuracy - a.accuracy)
      .slice(0, 20);

    res.json(leaderboard);
  } catch (err) {
    console.error("GET /api/predictions/leaderboard failed:", err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

predictionsRouter.get("/me/summary", requireAuth, async (req, res) => {
  try {
    const [rows, points] = await Promise.all([
      db
        .select({ prediction: predictions, game: games })
        .from(predictions)
        .innerJoin(games, eq(predictions.gameId, games.id))
        .where(eq(predictions.userId, req.userId!)),
      getUserPoints(req.userId!),
    ]);

    const resolved: ResolvedPick[] = [];
    for (const { prediction, game } of rows) {
      const winnerTeamId = computeWinnerTeamId(game);
      if (winnerTeamId === null) continue;
      resolved.push({
        round: game.round,
        tipoffAt: game.tipoffAt,
        correct: winnerTeamId === prediction.predictedWinnerTeamId,
      });
    }
    resolved.sort((a, b) => new Date(a.tipoffAt).getTime() - new Date(b.tipoffAt).getTime());

    const badges = earnedBadges({ picks: resolved, hasAnyPick: rows.length > 0, totalPoints: points });
    const newRoundRewards = await checkAndGrantRoundRewards(req.userId!);

    res.json({
      points,
      badges,
      newRoundRewards: newRoundRewards.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
    });
  } catch (err) {
    console.error("GET /api/predictions/me/summary failed:", err);
    res.status(500).json({ error: "Failed to load prediction summary" });
  }
});

predictionsRouter.post("/points/adjust", requireAuth, requireAdmin, async (req, res) => {
  const { email, points, reason } = req.body ?? {};
  if (typeof email !== "string" || typeof points !== "number" || !Number.isInteger(points) || points === 0) {
    res
      .status(400)
      .json({ error: "email and a non-zero integer points are required", code: "INVALID_REQUEST_BODY" });
    return;
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    res.status(400).json({ error: "reason is required", code: "REASON_REQUIRED" });
    return;
  }

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!target) {
    res.status(404).json({ error: "No user with that email", code: "USER_NOT_FOUND" });
    return;
  }

  const [adjustment] = await db
    .insert(pointAdjustments)
    .values({ userId: target.id, points, reason: reason.trim(), createdByUserId: req.userId! })
    .returning();

  res.status(201).json({ ...adjustment, email });
});