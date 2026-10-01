import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { gameOdds, games, predictions } from "../db/schema.js";
import {
  COACH_MILESTONE_INTERVAL,
  GREAT_ROUND_THRESHOLD,
  LEGENDARY_MILESTONE_INTERVAL,
  RARE_MILESTONE_INTERVAL,
  topScorerCorrectCountSql,
} from "./cards.js";
import { earnedBadges, ResolvedPick } from "./leaderboard.js";
import { computeWinnerTeamId, pointsForCorrectPick } from "./points.js";
import { getUserTopScorerPoints } from "./topScorerPoints.js";
import { getCurrentSeason } from "./season.js";
import { getFantasyCardTrackProgress } from "./fantasyCardTracks.js";

// Mirrors services/referrals.ts's REFERRAL_REWARD_PACK_QUANTITY.
const REFERRAL_PACKS_PER_FRIEND = 3;

export interface MilestoneProgress {
  id: "rareCard" | "legendaryPack" | "coachPack" | "fantasyCoachCard" | "fantasyCaptainCard";
  every: number;
  // Toward the next reward: count % every.
  progress: number;
  earned: number;
}

export interface BadgeProgress {
  id: string;
  earned: boolean;
  progress: number;
  target: number;
  // Sharpshooter's accuracy so far (0-100), when there are resolved picks.
  accuracy?: number;
}

export interface Achievements {
  correctPicks: number;
  milestones: MilestoneProgress[];
  currentRound: {
    round: number;
    totalGames: number;
    finalGames: number;
    picked: number;
    correct: number;
    greatThreshold: number;
  } | null;
  badges: BadgeProgress[];
  referral: { code: string | null; invited: number; rewarded: number; packsPerFriend: number };
}

type CountsRow = {
  correct: number;
  round: number | null;
  total_games: number;
  final_games: number;
  round_picked: number;
  round_correct: number;
  referral_code: string | null;
  invited: number;
  rewarded: number;
};

const correctPickSql = sql`g.status = 'final' and g.home_score is not null and g.away_score is not null and g.home_score <> g.away_score
  and p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end`;

/**
 * Everything the Achievements page shows (2026-09-30, direct request: "add
 * all our goals and achievements ... somewhere altogether"). A read-only
 * snapshot built from the exact counts the reward grants use (services/
 * cards.ts, leaderboard.ts's badge rules), so the page can never promise
 * something the grant logic disagrees with. Granting itself still happens
 * where it always did (predictions summary, fantasy, the reward toast).
 */
export async function getAchievements(userId: string): Promise<Achievements> {
  const season = (await getCurrentSeason()) ?? "__none__";

  const [countsRows, pickRows, topScorerPoints, cardTracks] = await Promise.all([
    db.execute<CountsRow>(sql`
      with cur as (
        select coalesce(
          (select min(round) from games where season = ${season} and round is not null and status <> 'final'),
          (select max(round) from games where season = ${season} and round is not null)
        ) as round
      )
      select
        (
          (select count(*)::int from predictions p join games g on g.id = p.game_id where p.user_id = ${userId} and ${correctPickSql})
          + ${topScorerCorrectCountSql(userId)}
        )::int as correct,
        cur.round,
        (select count(*)::int from games g where g.season = ${season} and g.round = cur.round) as total_games,
        (select count(*)::int from games g where g.season = ${season} and g.round = cur.round and g.status = 'final') as final_games,
        (select count(*)::int from predictions p join games g on g.id = p.game_id
          where p.user_id = ${userId} and g.season = ${season} and g.round = cur.round) as round_picked,
        (select count(*)::int from predictions p join games g on g.id = p.game_id
          where p.user_id = ${userId} and g.season = ${season} and g.round = cur.round and ${correctPickSql}) as round_correct,
        (select referral_code from users where id = ${userId}) as referral_code,
        (select count(*)::int from users where referred_by_user_id = ${userId}) as invited,
        (select count(*)::int from users where referred_by_user_id = ${userId} and referral_reward_granted) as rewarded
      from cur
    `),
    db
      .select({ prediction: predictions, game: games, odds: gameOdds })
      .from(predictions)
      .innerJoin(games, eq(predictions.gameId, games.id))
      .leftJoin(gameOdds, eq(gameOdds.gameId, games.id))
      .where(eq(predictions.userId, userId)),
    getUserTopScorerPoints(userId),
    getFantasyCardTrackProgress(userId),
  ]);
  const c = countsRows[0];

  const milestone = (id: MilestoneProgress["id"], every: number, count: number): MilestoneProgress => ({
    id,
    every,
    progress: count % every,
    earned: Math.floor(count / every),
  });
  const correct = Number(c?.correct ?? 0);

  // Badges: the same resolved-pick context the predictions summary builds,
  // so "earned" matches the badges shown on leaderboards exactly.
  const resolved: ResolvedPick[] = [];
  let predictionPoints = topScorerPoints;
  for (const { prediction, game, odds } of pickRows) {
    const winnerTeamId = computeWinnerTeamId(game);
    if (winnerTeamId === null) continue;
    const isCorrect = winnerTeamId === prediction.predictedWinnerTeamId;
    resolved.push({ round: game.round, tipoffAt: game.tipoffAt, correct: isCorrect });
    if (isCorrect) {
      const fairProb = odds ? (prediction.predictedWinnerTeamId === game.homeTeamId ? odds.homeFairProb : odds.awayFairProb) : null;
      predictionPoints += pointsForCorrectPick(fairProb);
    }
  }
  resolved.sort((a, b) => new Date(a.tipoffAt).getTime() - new Date(b.tipoffAt).getTime());
  const earnedIds = new Set(earnedBadges({ picks: resolved, hasAnyPick: pickRows.length > 0, predictionPoints }).map((b) => b.id));

  let bestStreak = 0;
  let streak = 0;
  for (const p of resolved) {
    streak = p.correct ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
  }
  const resolvedCorrect = resolved.filter((p) => p.correct).length;
  const accuracy = resolved.length > 0 ? Math.round((resolvedCorrect / resolved.length) * 100) : undefined;

  const badges: BadgeProgress[] = [
    { id: "first-call", earned: earnedIds.has("first-call"), progress: Math.min(pickRows.length, 1), target: 1 },
    { id: "on-a-roll", earned: earnedIds.has("on-a-roll"), progress: Math.min(bestStreak, 5), target: 5 },
    { id: "perfect-round", earned: earnedIds.has("perfect-round"), progress: earnedIds.has("perfect-round") ? 1 : 0, target: 1 },
    { id: "century", earned: earnedIds.has("century"), progress: Math.min(Math.round(predictionPoints), 100), target: 100 },
    { id: "sharpshooter", earned: earnedIds.has("sharpshooter"), progress: Math.min(resolved.length, 10), target: 10, accuracy },
  ];

  return {
    correctPicks: correct,
    milestones: [
      milestone("rareCard", RARE_MILESTONE_INTERVAL, correct),
      milestone("legendaryPack", LEGENDARY_MILESTONE_INTERVAL, correct),
      milestone("coachPack", COACH_MILESTONE_INTERVAL, correct),
      milestone("fantasyCoachCard", cardTracks.coach.every, cardTracks.coach.positiveRounds),
      milestone("fantasyCaptainCard", cardTracks.captain.every, cardTracks.captain.positiveRounds),
    ],
    currentRound:
      c?.round != null
        ? {
            round: Number(c.round),
            totalGames: Number(c.total_games),
            finalGames: Number(c.final_games),
            picked: Number(c.round_picked),
            correct: Number(c.round_correct),
            greatThreshold: GREAT_ROUND_THRESHOLD,
          }
        : null,
    badges,
    referral: {
      code: c?.referral_code ?? null,
      invited: Number(c?.invited ?? 0),
      rewarded: Number(c?.rewarded ?? 0),
      packsPerFriend: REFERRAL_PACKS_PER_FRIEND,
    },
  };
}
