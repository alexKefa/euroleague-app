import { Router } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { predictions, games, teams, users, pointAdjustments } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { computeWinnerTeamId, getUserPoints, POINTS_PER_CORRECT } from "../services/points.js";
import { checkAndGrantRoundRewards, markRoundRewardsSeen } from "../services/cards.js";
import { checkAndGrantReferralReward } from "../services/referrals.js";

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
  // Deliberately *excludes* pointAdjustments (admin grants, the
  // registration welcome bonus, sold-duplicate refunds) — Century is meant
  // to reflect prediction accuracy, not spendable balance. Those still
  // count toward the balance shown/spent everywhere else (getUserPoints),
  // just not toward "did you earn this".
  predictionPoints: number;
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
    description: "Earned 100+ points from predictions.",
    check: (ctx) => ctx.predictionPoints >= 100,
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
  try {
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
  } catch (err) {
    // A stale JWT for an already-deleted user (only realistically reachable
    // via manual DB cleanup in dev, not a real account-deletion feature)
    // fails this insert's user_id foreign key — without this catch that
    // threw past Express into an unhandled rejection and crashed the whole
    // process for every connected client, not just this request. Every
    // other route in this file already catches; this one didn't.
    console.error("POST /api/predictions failed:", err);
    res.status(500).json({ error: "Failed to save prediction" });
  }
});

// Lets a user clear a pick entirely (not just swap to the other team) —
// same "before tipoff" window as POST /, since a resolved/in-progress
// game's pick is locked in for scoring either way. Deleting a pick that
// doesn't exist is a no-op success, not a 404 — the frontend doesn't need
// to know whether one existed before asking to clear it.
predictionsRouter.delete("/:gameId", requireAuth, async (req, res) => {
  try {
    const { gameId } = req.params;

    const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!game) {
      res.status(404).json({ error: "Game not found" });
      return;
    }
    if (game.status !== "scheduled" || new Date(game.tipoffAt) <= new Date()) {
      res.status(400).json({ error: "Predictions can only be changed before a game starts" });
      return;
    }

    await db.delete(predictions).where(and(eq(predictions.userId, req.userId!), eq(predictions.gameId, gameId)));
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/predictions/:gameId failed:", err);
    res.status(500).json({ error: "Failed to remove prediction" });
  }
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

// Ranked by lifetime *earned* points (correct picks + only the bonus
// adjustments flagged countsTowardRanking), never spendable balance — see
// the column's comment in schema.ts. This is deliberately still computed
// live on every call, same "no backfill job, a scoring-rule change applies
// instantly" guarantee as everywhere else in this file — but it used to
// pull every prediction and every point_adjustment ever made, for every
// user, over the wire and reduce them in JS, which only gets more
// expensive as the app accumulates history. Phase 1 below does that
// counting inside a single grouped SQL query instead (one row per user,
// however much history exists behind it); phase 2 then fetches full pick
// sequences — needed only for streak-based badges like "on-a-roll" — for
// just the ~20 users who actually end up on the board, not everyone.
predictionsRouter.get("/leaderboard", async (_req, res) => {
  try {
    const totals = await db.execute<{
      user_id: string;
      email: string;
      correct: number;
      total: number;
      bonus: number;
    }>(sql`
      with correct_totals as (
        select p.user_id,
          count(*) filter (
            where p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
          )::int as correct,
          count(*)::int as total
        from ${predictions} p
        join ${games} g on p.game_id = g.id
        where g.status = 'final' and g.home_score is not null and g.away_score is not null and g.home_score <> g.away_score
        group by p.user_id
      ),
      bonus_totals as (
        select user_id, coalesce(sum(points), 0)::int as bonus
        from ${pointAdjustments}
        where counts_toward_ranking = true
        group by user_id
      )
      select coalesce(ct.user_id, bt.user_id) as user_id, u.email,
        coalesce(ct.correct, 0)::int as correct,
        coalesce(ct.total, 0)::int as total,
        coalesce(bt.bonus, 0)::int as bonus
      from correct_totals ct
      full outer join bonus_totals bt on ct.user_id = bt.user_id
      join ${users} u on u.id = coalesce(ct.user_id, bt.user_id)
    `);

    const ranked = totals
      .map((row) => ({
        userId: row.user_id,
        // Placeholder display name — no dedicated username field exists yet.
        // Showing full email addresses on a public leaderboard isn't great
        // practice, so this uses just the local part as a stand-in.
        displayName: row.email.split("@")[0],
        correct: row.correct,
        total: row.total,
        accuracy: row.total > 0 ? row.correct / row.total : 0,
        points: row.correct * POINTS_PER_CORRECT + row.bonus,
      }))
      .sort((a, b) => b.points - a.points || b.accuracy - a.accuracy)
      .slice(0, 20);

    const topIds = ranked.map((r) => r.userId);
    const pickRows = topIds.length
      ? await db
          .select({ prediction: predictions, game: games })
          .from(predictions)
          .innerJoin(games, eq(predictions.gameId, games.id))
          .where(and(eq(games.status, "final"), inArray(predictions.userId, topIds)))
      : [];

    const picksByUser = new Map<string, ResolvedPick[]>();
    for (const { prediction, game } of pickRows) {
      const winnerTeamId = computeWinnerTeamId(game);
      if (winnerTeamId === null) continue;
      const picks = picksByUser.get(prediction.userId) ?? [];
      picks.push({
        round: game.round,
        tipoffAt: game.tipoffAt,
        correct: winnerTeamId === prediction.predictedWinnerTeamId,
      });
      picksByUser.set(prediction.userId, picks);
    }

    const leaderboard = ranked.map((entry) => {
      const picks = (picksByUser.get(entry.userId) ?? []).sort(
        (a, b) => new Date(a.tipoffAt).getTime() - new Date(b.tipoffAt).getTime()
      );
      return {
        ...entry,
        badges: earnedBadges({
          picks,
          hasAnyPick: entry.total > 0,
          predictionPoints: entry.correct * POINTS_PER_CORRECT,
        }),
      };
    });

    res.json(leaderboard);
  } catch (err) {
    console.error("GET /api/predictions/leaderboard failed:", err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

// Community-wide accuracy analytics — how good are the crowd's picks,
// broken down by which team was picked, plus the games the crowd got most
// confidently wrong. Not a per-user stat (that's /leaderboard), so no auth
// needed. Three separate round trips rather than combined into one: this
// page is visited far less often than the hot paths the "fewer round
// trips" rule (see CLAUDE.md) actually targets, and each query here is a
// genuinely different shape (single row / grouped-by-team / grouped-by-game)
// that isn't worth contorting into one statement.
predictionsRouter.get("/analytics", async (_req, res) => {
  try {
    const [overallRow] = await db.execute<{ total: number; correct: number }>(sql`
      select
        count(*)::int as total,
        count(*) filter (
          where p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
        )::int as correct
      from ${predictions} p
      join ${games} g on p.game_id = g.id
      where g.status = 'final' and g.home_score is not null and g.away_score is not null and g.home_score <> g.away_score
    `);

    const teamRows = await db.execute<{
      team_id: string;
      code: string;
      name: string;
      primary_color: string | null;
      logo_url: string | null;
      times_picked: number;
      times_correct: number;
    }>(sql`
      select t.id as team_id, t.code, t.name, t.primary_color, t.logo_url,
        count(*)::int as times_picked,
        count(*) filter (
          where p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
        )::int as times_correct
      from ${predictions} p
      join ${games} g on p.game_id = g.id
      join ${teams} t on t.id = p.predicted_winner_team_id
      where g.status = 'final' and g.home_score is not null and g.away_score is not null and g.home_score <> g.away_score
      group by t.id, t.code, t.name, t.primary_color, t.logo_url
      order by times_picked desc
    `);

    // Per-game pick split (home vs away), for finding "upsets" below —
    // games with at least 3 picks where the majority sided with the team
    // that ended up losing.
    const gameRows = await db.execute<{
      game_id: string;
      round: number | null;
      tipoff_at: Date;
      home_score: number;
      away_score: number;
      home_team_id: string;
      home_code: string;
      home_name: string;
      home_logo_url: string | null;
      away_team_id: string;
      away_code: string;
      away_name: string;
      away_logo_url: string | null;
      home_picks: number;
      away_picks: number;
    }>(sql`
      select g.id as game_id, g.round, g.tipoff_at, g.home_score, g.away_score,
        ht.id as home_team_id, ht.code as home_code, ht.name as home_name, ht.logo_url as home_logo_url,
        at.id as away_team_id, at.code as away_code, at.name as away_name, at.logo_url as away_logo_url,
        count(*) filter (where p.predicted_winner_team_id = g.home_team_id)::int as home_picks,
        count(*) filter (where p.predicted_winner_team_id = g.away_team_id)::int as away_picks
      from ${games} g
      join ${predictions} p on p.game_id = g.id
      join ${teams} ht on ht.id = g.home_team_id
      join ${teams} at on at.id = g.away_team_id
      where g.status = 'final' and g.home_score is not null and g.away_score is not null and g.home_score <> g.away_score
      group by g.id, g.round, g.tipoff_at, g.home_score, g.away_score,
        ht.id, ht.code, ht.name, ht.logo_url, at.id, at.code, at.name, at.logo_url
      having count(*) >= 3
    `);

    const upsets = gameRows
      .map((r) => {
        const totalPicks = r.home_picks + r.away_picks;
        const homeWon = r.home_score > r.away_score;
        const majorityPickedHome = r.home_picks >= r.away_picks;
        const majorityWasWrong = majorityPickedHome !== homeWon;
        const majorityPicks = Math.max(r.home_picks, r.away_picks);
        return {
          gameId: r.game_id,
          round: r.round,
          tipoffAt: r.tipoff_at,
          homeScore: r.home_score,
          awayScore: r.away_score,
          homeTeam: { id: r.home_team_id, code: r.home_code, name: r.home_name, logoUrl: r.home_logo_url },
          awayTeam: { id: r.away_team_id, code: r.away_code, name: r.away_name, logoUrl: r.away_logo_url },
          totalPicks,
          majorityPickedTeamId: majorityPickedHome ? r.home_team_id : r.away_team_id,
          majorityPct: majorityPicks / totalPicks,
          majorityWasWrong,
        };
      })
      .filter((g) => g.majorityWasWrong)
      .sort((a, b) => b.majorityPct - a.majorityPct || b.totalPicks - a.totalPicks)
      .slice(0, 10);

    res.json({
      overall: {
        total: overallRow.total,
        correct: overallRow.correct,
        accuracy: overallRow.total > 0 ? overallRow.correct / overallRow.total : null,
      },
      byTeam: teamRows.map((r) => ({
        team: { id: r.team_id, code: r.code, name: r.name, primaryColor: r.primary_color, logoUrl: r.logo_url },
        timesPicked: r.times_picked,
        timesCorrect: r.times_correct,
        accuracy: r.times_picked > 0 ? r.times_correct / r.times_picked : null,
      })),
      upsets,
    });
  } catch (err) {
    console.error("GET /api/predictions/analytics failed:", err);
    res.status(500).json({ error: "Failed to load prediction analytics" });
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

    const correctCount = resolved.filter((p) => p.correct).length;
    const badges = earnedBadges({
      picks: resolved,
      hasAnyPick: rows.length > 0,
      predictionPoints: correctCount * POINTS_PER_CORRECT,
    });
    // Independent of each other — round rewards don't affect the referral
    // check or vice versa — so run them concurrently instead of adding
    // their round trips to the DB back to back.
    const [newRoundRewards] = await Promise.all([
      checkAndGrantRoundRewards(req.userId!),
      checkAndGrantReferralReward(req.userId!),
    ]);

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

// Called by the Predictions page once it's actually rendered the "Perfect
// round!" banner for whatever checkAndGrantRoundRewards returned — not by
// inventory/store/packs, which only read `points` off this same summary
// and have no UI for it. See the doc comment on checkAndGrantRoundRewards.
predictionsRouter.post("/round-rewards/ack", requireAuth, async (req, res) => {
  try {
    await markRoundRewardsSeen(req.userId!);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/predictions/round-rewards/ack failed:", err);
    res.status(500).json({ error: "Failed to acknowledge round rewards" });
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