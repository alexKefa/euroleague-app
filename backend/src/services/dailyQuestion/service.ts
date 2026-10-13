import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { generateQuestion, GeneratedQuestion } from "./generate.js";
import {
  CORRECT_BONUS,
  DQ_ANSWER_WINDOW_MS,
  DQ_SHOWN_SECONDS,
  DqStat,
  DqTemplate,
  STREAK_CAP,
  STREAK_STEP,
  athensDay,
  nextStreak,
  pointsFor,
} from "./logic.js";

/**
 * Serving, answering and paying the Daily Question (spec: "How a day plays",
 * "Points"). Every time comes from `now` (JS), never the DB clock, so the
 * timer is one clock and checks can move it. Payouts are claim-first: the
 * UPDATE that sets resolved_at feeds the point_adjustments insert in the
 * same statement, so a row can only pay once.
 */
export type DqPlayer = { id: string; name: string; photoUrl: string | null; teamCode: string };
export type DqResult = {
  choice: "a" | "b" | null;
  correct: boolean;
  valueA: number;
  valueB: number;
  points: { streakBonus: number; correctBonus: number; milestone: number; total: number };
};
export type DqToday = {
  day: string;
  template: DqTemplate;
  stat: DqStat;
  playerA: DqPlayer;
  playerB: DqPlayer;
  remainingMs: number | null;
  result: DqResult | null;
};
export type DqState = {
  status: "ready" | "in_progress" | "done" | "unavailable";
  streak: number;
  nextBonus: number;
  lockedUntil: string | null;
  today: DqToday | null;
};

const LOCK_DAYS = 7;

// pointsFor()'s streak part (bonus + milestone) as SQL over a row's streak.
// Keep in sync with logic.ts; the check script compares both.
const streakPointsSql = sql`least(${STREAK_STEP} * streak, ${STREAK_CAP}) + case when streak = 7 then 75 when streak % 30 = 0 then 300 else 0 end`;

// Pays every expired, unanswered row of this user as a timeout.
async function resolveExpired(userId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DQ_ANSWER_WINDOW_MS);
  await db.execute(sql`
    with claimed as (
      update daily_questions set resolved_at = ${now.toISOString()}::timestamptz, correct = false, points_awarded = ${streakPointsSql}
      where user_id = ${userId}::uuid and resolved_at is null and answered_at is null and served_at < ${cutoff.toISOString()}::timestamptz
      returning user_id, points_awarded
    )
    insert into point_adjustments (user_id, points, reason, created_by_user_id, counts_toward_ranking)
    select user_id, points_awarded, 'daily_question', user_id, false from claimed where points_awarded > 0
  `);
}

type Row = Record<string, any>;

async function readState(userId: string, day: string, now: Date): Promise<DqState> {
  const [row] = (await db.execute<Row>(sql`
    select u.created_at,
      (select streak from daily_questions where user_id = u.id and day = ${day}::date - 1) as y_streak,
      (select row_to_json(t) from (
        select dq.day::text as day, dq.template, dq.stat, dq.value_a, dq.value_b, dq.served_at, dq.choice, dq.correct,
          dq.streak, dq.resolved_at,
          pa.id as a_id, pa.name as a_name, pa.photo_url as a_photo, ta.code as a_team,
          pb.id as b_id, pb.name as b_name, pb.photo_url as b_photo, tb.code as b_team
        from daily_questions dq
        join players pa on pa.id = dq.player_a_id join teams ta on ta.id = pa.team_id
        join players pb on pb.id = dq.player_b_id join teams tb on tb.id = pb.team_id
        where dq.user_id = u.id and dq.day = ${day}::date
      ) t) as today
    from users u where u.id = ${userId}::uuid
  `)) as Row[];

  const unlock = new Date(new Date(row.created_at).getTime() + LOCK_DAYS * 86_400_000);
  const lockedUntil = unlock > now ? unlock.toISOString() : null;
  const yStreak: number | null = row.y_streak ?? null;
  const t: Row | null = row.today;

  if (!t) {
    return {
      status: "ready",
      streak: yStreak ?? 0,
      nextBonus: pointsFor(nextStreak(yStreak), false).total,
      lockedUntil,
      today: null,
    };
  }

  const resolved = t.resolved_at !== null;
  const elapsed = now.getTime() - new Date(t.served_at).getTime();
  const today: DqToday = {
    day: t.day,
    template: t.template,
    stat: t.stat,
    playerA: { id: t.a_id, name: t.a_name, photoUrl: t.a_photo, teamCode: t.a_team },
    playerB: { id: t.b_id, name: t.b_name, photoUrl: t.b_photo, teamCode: t.b_team },
    remainingMs: resolved ? null : Math.max(0, DQ_SHOWN_SECONDS * 1000 - elapsed),
    result: resolved
      ? {
          choice: t.choice,
          correct: t.correct === true,
          valueA: t.value_a,
          valueB: t.value_b,
          points: pointsFor(t.streak, t.correct === true),
        }
      : null,
  };
  return {
    status: resolved ? "done" : "in_progress",
    streak: t.streak,
    nextBonus: pointsFor(t.streak, false).total,
    lockedUntil,
    today,
  };
}

export async function getDailyQuestionState(userId: string, now: Date = new Date()): Promise<DqState> {
  await resolveExpired(userId, now);
  return readState(userId, athensDay(now), now);
}

export async function startDailyQuestion(
  userId: string,
  now: Date = new Date(),
  generate: (day: string) => Promise<GeneratedQuestion | null> = generateQuestion
): Promise<DqState> {
  const state = await getDailyQuestionState(userId, now);
  if (state.status !== "ready") return state;

  const day = athensDay(now);
  const q = await generate(day);
  if (!q) return { ...state, status: "unavailable" };

  // The streak is read in the insert itself, and a concurrent start loses
  // to the unique (user_id, day) index instead of creating a second row.
  await db.execute(sql`
    insert into daily_questions (user_id, day, template, stat, player_a_id, player_b_id, value_a, value_b, served_at, streak)
    values (${userId}::uuid, ${day}::date, ${q.template}, ${q.stat}, ${q.playerAId}::uuid, ${q.playerBId}::uuid,
      ${q.valueA}, ${q.valueB}, ${now.toISOString()}::timestamptz,
      coalesce((select streak from daily_questions where user_id = ${userId}::uuid and day = ${day}::date - 1), 0) + 1)
    on conflict (user_id, day) do nothing
  `);
  return readState(userId, day, now);
}

export async function answerDailyQuestion(
  userId: string,
  choice: "a" | "b",
  now: Date = new Date()
): Promise<DqState | { error: "not_started" }> {
  const cutoff = new Date(now.getTime() - DQ_ANSWER_WINDOW_MS);
  const correctSql = choice === "a" ? sql`value_a > value_b` : sql`value_b > value_a`;
  // Targets the user's open row rather than today's, so an answer that
  // lands just after midnight still counts for the day it was served.
  const claimed = (await db.execute<{ day: string }>(sql`
    with claimed as (
      update daily_questions set answered_at = ${now.toISOString()}::timestamptz, choice = ${choice}, resolved_at = ${now.toISOString()}::timestamptz,
        response_ms = (extract(epoch from (${now.toISOString()}::timestamptz - served_at)) * 1000)::int,
        correct = ${correctSql},
        points_awarded = ${streakPointsSql} + case when ${correctSql} then ${CORRECT_BONUS} else 0 end
      where user_id = ${userId}::uuid and resolved_at is null and served_at >= ${cutoff.toISOString()}::timestamptz
      returning user_id, points_awarded, day::text as day
    ), paid as (
      insert into point_adjustments (user_id, points, reason, created_by_user_id, counts_toward_ranking)
      select user_id, points_awarded, 'daily_question', user_id, false from claimed where points_awarded > 0
    )
    select day from claimed
  `)) as { day: string }[];

  await resolveExpired(userId, now);
  const state = await readState(userId, claimed[0]?.day ?? athensDay(now), now);
  if (!state.today) return { error: "not_started" };
  return state;
}

export type DqSuspect = { userId: string; username: string; answers: number; correctPct: number; medianResponseMs: number };

/**
 * Accounts worth a look (spec: "Bots and suspicious accounts"): at least 14
 * answers in the last 30 days, ≥ 90% correct, median answer under 1.5 s.
 * Flags only — an admin decides.
 */
export async function getDailyQuestionSuspects(): Promise<DqSuspect[]> {
  const rows = (await db.execute<Row>(sql`
    select dq.user_id, u.username, count(*)::int as answers,
      round(100 * avg(dq.correct::int))::int as correct_pct,
      round(percentile_cont(0.5) within group (order by dq.response_ms))::int as median_ms
    from daily_questions dq
    join users u on u.id = dq.user_id
    where dq.answered_at is not null and dq.day >= current_date - 30
    group by dq.user_id, u.username
    having count(*) >= 14 and avg(dq.correct::int) >= 0.9
      and percentile_cont(0.5) within group (order by dq.response_ms) < 1500
    order by median_ms
  `)) as Row[];
  return rows.map((r) => ({ userId: r.user_id, username: r.username, answers: r.answers, correctPct: r.correct_pct, medianResponseMs: r.median_ms }));
}
