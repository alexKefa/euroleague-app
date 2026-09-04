import { Router } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { predictions, games, gameOdds, teams, users, pointAdjustments } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { computeWinnerTeamId, getUserPoints, pointsForCorrectPick } from "../services/points.js";
import { earnedBadges, getLeaderboardEntries, ResolvedPick } from "../services/leaderboard.js";
import {
  checkAndGrantRoundRewards,
  markRoundRewardsSeen,
  checkAndGrantLegendaryMilestones,
  markLegendaryMilestonesSeen,
  checkAndGrantCoachMilestones,
  markCoachMilestonesSeen,
} from "../services/cards.js";
import { checkAndGrantReferralReward } from "../services/referrals.js";

export const predictionsRouter = Router();

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

// Lets the Predictions page save a whole round's worth of picks (and clears)
// in one request instead of one POST/DELETE per tap — the UI now only
// submits on an explicit "Complete predictions" click, so a round of ~10
// games used to mean up to 10 sequential round trips against the remote DB
// just from working through one round. teamId: null clears that game's pick
// (same semantics as DELETE /:gameId); anything else upserts it (same
// semantics as POST /). Per-pick validation failures are collected and
// returned rather than failing the whole batch — one stale game (started
// since the user opened the page) shouldn't lose everything else they
// picked.
predictionsRouter.post("/batch", requireAuth, async (req, res) => {
  try {
    const { picks } = req.body ?? {};
    if (!Array.isArray(picks) || picks.length === 0) {
      res.status(400).json({ error: "picks must be a non-empty array" });
      return;
    }
    if (picks.length > 20) {
      res.status(400).json({ error: "Too many picks in one batch" });
      return;
    }
    // Malformed UUIDs must be rejected here, not left to the games lookup
    // below — inArray(games.id, ...) with even one non-UUID string throws a
    // Postgres syntax error for the *entire* query, not just that row,
    // which would otherwise crash this whole batch with a 500 instead of
    // reporting it as a per-pick error like every other rejected pick.
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const p of picks) {
      if (
        typeof p?.gameId !== "string" ||
        !uuidPattern.test(p.gameId) ||
        (p.teamId !== null && (typeof p.teamId !== "string" || !uuidPattern.test(p.teamId)))
      ) {
        res.status(400).json({ error: "Each pick needs a valid gameId and a teamId (or null to clear)" });
        return;
      }
    }

    const gameIds: string[] = picks.map((p: { gameId: string }) => p.gameId);
    const gameRows = await db.select().from(games).where(inArray(games.id, gameIds));
    const gameById = new Map(gameRows.map((g) => [g.id, g]));

    const toUpsert: { userId: string; gameId: string; predictedWinnerTeamId: string }[] = [];
    const toDeleteGameIds: string[] = [];
    const errors: Record<string, string> = {};

    for (const { gameId, teamId } of picks as { gameId: string; teamId: string | null }[]) {
      const game = gameById.get(gameId);
      if (!game) {
        errors[gameId] = "Game not found";
        continue;
      }
      if (game.status !== "scheduled" || new Date(game.tipoffAt) <= new Date()) {
        errors[gameId] = "Predictions can only be changed before a game starts";
        continue;
      }
      if (teamId === null) {
        toDeleteGameIds.push(gameId);
      } else if (teamId !== game.homeTeamId && teamId !== game.awayTeamId) {
        errors[gameId] = "teamId must be one of the two teams playing this game";
      } else {
        toUpsert.push({ userId: req.userId!, gameId, predictedWinnerTeamId: teamId });
      }
    }

    // Batched multi-row writes, not one round trip per pick — same lever
    // already used for pack rolls (services/packs.ts) against this DB.
    if (toUpsert.length > 0) {
      await db
        .insert(predictions)
        .values(toUpsert)
        .onConflictDoUpdate({
          target: [predictions.userId, predictions.gameId],
          set: { predictedWinnerTeamId: sql`excluded.predicted_winner_team_id` },
        });
    }
    if (toDeleteGameIds.length > 0) {
      await db
        .delete(predictions)
        .where(and(eq(predictions.userId, req.userId!), inArray(predictions.gameId, toDeleteGameIds)));
    }

    res.json({ ok: true, errors: Object.keys(errors).length > 0 ? errors : undefined });
  } catch (err) {
    console.error("POST /api/predictions/batch failed:", err);
    res.status(500).json({ error: "Failed to save predictions" });
  }
});

predictionsRouter.get("/me", requireAuth, async (req, res) => {
  try {
    // Capped rather than the user's entire history — this list is a
    // scrollable recent-picks panel, not an export, and an uncapped fetch
    // only ever grows (unbounded across a season, worse across several)
    // for no upside once it's already well past what the panel can
    // usefully show.
    const rows = await db
      .select({ prediction: predictions, game: games, predictedTeam: teams })
      .from(predictions)
      .innerJoin(games, eq(predictions.gameId, games.id))
      .innerJoin(teams, eq(predictions.predictedWinnerTeamId, teams.id))
      .where(eq(predictions.userId, req.userId!))
      .orderBy(desc(games.tipoffAt))
      .limit(40);

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
// the column's comment in schema.ts. Delegates to
// services/leaderboard.ts's getLeaderboardEntries, shared with a league's
// scoped leaderboard (routes/leagues.ts) — see that function's doc comment
// for why this is computed live in two phases rather than pulling every
// prediction into JS.
predictionsRouter.get("/leaderboard", async (_req, res) => {
  try {
    res.json(await getLeaderboardEntries({ limit: 20 }));
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
        .select({ prediction: predictions, game: games, odds: gameOdds })
        .from(predictions)
        .innerJoin(games, eq(predictions.gameId, games.id))
        .leftJoin(gameOdds, eq(gameOdds.gameId, games.id))
        .where(eq(predictions.userId, req.userId!)),
      getUserPoints(req.userId!),
    ]);

    const resolved: ResolvedPick[] = [];
    // Century badge (below) needs real odds-weighted points, not a flat
    // count*POINTS_PER_CORRECT — mirrors services/points.ts/leaderboard.ts's
    // SQL version of the same formula, just computed in JS here since this
    // route already loops resolved picks row-by-row.
    let predictionPoints = 0;
    for (const { prediction, game, odds } of rows) {
      const winnerTeamId = computeWinnerTeamId(game);
      if (winnerTeamId === null) continue;
      const correct = winnerTeamId === prediction.predictedWinnerTeamId;
      resolved.push({ round: game.round, tipoffAt: game.tipoffAt, correct });
      if (correct) {
        const fairProb = odds
          ? prediction.predictedWinnerTeamId === game.homeTeamId
            ? odds.homeFairProb
            : odds.awayFairProb
          : null;
        predictionPoints += pointsForCorrectPick(fairProb);
      }
    }
    resolved.sort((a, b) => new Date(a.tipoffAt).getTime() - new Date(b.tipoffAt).getTime());

    const badges = earnedBadges({
      picks: resolved,
      hasAnyPick: rows.length > 0,
      predictionPoints,
    });
    // Independent of each other — none of these three affect one another —
    // so run them concurrently instead of adding their round trips to the
    // DB back to back.
    const [newRoundRewards, newMilestoneRewards, newCoachMilestoneRewards] = await Promise.all([
      checkAndGrantRoundRewards(req.userId!),
      checkAndGrantLegendaryMilestones(req.userId!),
      checkAndGrantCoachMilestones(req.userId!),
      checkAndGrantReferralReward(req.userId!),
    ]);

    res.json({
      points,
      badges,
      newRoundRewards: newRoundRewards.map((p) => ({ id: p.id, packType: p.packType, tier: p.tier })),
      newMilestoneRewards: newMilestoneRewards.map((p) => ({ id: p.id, packType: p.packType, tier: p.tier })),
      newCoachMilestoneRewards: newCoachMilestoneRewards.map((p) => ({ id: p.id, packType: p.packType, tier: p.tier })),
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

// Same pattern as round-rewards/ack, for the separate (career-wide, not
// round-scoped) legendary-milestone banner — see checkAndGrantLegendaryMilestones.
predictionsRouter.post("/milestone-rewards/ack", requireAuth, async (req, res) => {
  try {
    await markLegendaryMilestonesSeen(req.userId!);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/predictions/milestone-rewards/ack failed:", err);
    res.status(500).json({ error: "Failed to acknowledge milestone rewards" });
  }
});

// Same pattern again, for the coach-milestone track — see checkAndGrantCoachMilestones.
predictionsRouter.post("/coach-milestone-rewards/ack", requireAuth, async (req, res) => {
  try {
    await markCoachMilestonesSeen(req.userId!);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/predictions/coach-milestone-rewards/ack failed:", err);
    res.status(500).json({ error: "Failed to acknowledge coach milestone rewards" });
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