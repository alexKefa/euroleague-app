import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { predictions, games, gameOdds, users, pointAdjustments } from "../db/schema.js";
import { computeWinnerTeamId, pointsSqlExpr } from "./points.js";

export interface ResolvedPick {
  round: number | null;
  tipoffAt: Date | string;
  correct: boolean;
}

export interface BadgeInfo {
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

export function earnedBadges(ctx: BadgeContext): BadgeInfo[] {
  return BADGES.filter((b) => b.check(ctx)).map(({ id, label, description }) => ({
    id,
    label,
    description,
  }));
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  correct: number;
  total: number;
  accuracy: number;
  points: number;
  badges: BadgeInfo[];
}

/**
 * Ranked by lifetime *earned* points (correct picks + only the bonus
 * adjustments flagged countsTowardRanking) — shared by the global
 * leaderboard (routes/predictions.ts, unfiltered + limit: 20) and a
 * league's scoped leaderboard (routes/leagues.ts, userIds: that league's
 * member ids, no limit — leagues are small friend groups). See
 * routes/predictions.ts's original /leaderboard for why this is computed
 * live in two phases rather than pulling every prediction into JS: phase 1
 * counts inside one grouped SQL query (one row per user), phase 2 fetches
 * full pick sequences (needed only for streak-based badges) for just the
 * users who actually end up in the result, not everyone.
 *
 * A userIds filter is applied to the phase-1 totals in JS, not pushed into
 * the SQL — this reuses the exact same unfiltered query for both callers
 * rather than parameterizing an array into the raw sql template, and at
 * this app's scale (a handful of users total) the extra rows fetched and
 * discarded cost nothing worth optimizing for.
 */
export async function getLeaderboardEntries(
  options: { userIds?: string[]; limit?: number } = {}
): Promise<LeaderboardEntry[]> {
  const pickedFairProb = sql`case when p.predicted_winner_team_id = g.home_team_id then go.home_fair_prob else go.away_fair_prob end`;

  const totals = await db.execute<{
    user_id: string;
    email: string;
    correct: number;
    total: number;
    correct_points: number;
    bonus: number;
  }>(sql`
    with correct_totals as (
      select p.user_id,
        count(*) filter (
          where p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
        )::int as correct,
        count(*)::int as total,
        sum(
          case when p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
            then ${pointsSqlExpr(pickedFairProb)}
            else 0
          end
        )::int as correct_points
      from ${predictions} p
      join ${games} g on p.game_id = g.id
      left join ${gameOdds} go on go.game_id = g.id
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
      coalesce(ct.correct_points, 0)::int as correct_points,
      coalesce(bt.bonus, 0)::int as bonus
    from correct_totals ct
    full outer join bonus_totals bt on ct.user_id = bt.user_id
    join ${users} u on u.id = coalesce(ct.user_id, bt.user_id)
  `);

  const allowedIds = options.userIds ? new Set(options.userIds) : null;

  let ranked = totals
    .filter((row) => !allowedIds || allowedIds.has(row.user_id))
    .map((row) => ({
      userId: row.user_id,
      // Placeholder display name — no dedicated username field exists yet.
      // Showing full email addresses on a public leaderboard isn't great
      // practice, so this uses just the local part as a stand-in.
      displayName: row.email.split("@")[0],
      correct: row.correct,
      total: row.total,
      accuracy: row.total > 0 ? row.correct / row.total : 0,
      correctPoints: row.correct_points,
      points: row.correct_points + row.bonus,
    }))
    .sort((a, b) => b.points - a.points || b.accuracy - a.accuracy);

  if (options.limit) ranked = ranked.slice(0, options.limit);

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

  return ranked.map(({ correctPoints, ...entry }) => {
    const picks = (picksByUser.get(entry.userId) ?? []).sort(
      (a, b) => new Date(a.tipoffAt).getTime() - new Date(b.tipoffAt).getTime()
    );
    return {
      ...entry,
      badges: earnedBadges({
        picks,
        hasAnyPick: entry.total > 0,
        predictionPoints: correctPoints,
      }),
    };
  });
}
