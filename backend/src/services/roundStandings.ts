import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { predictions, games, gameOdds, users, topScorerPredictions, leagueMembers, leagues } from "../db/schema.js";
import { pointsSqlExpr } from "./points.js";
import { topScorerTotalsCte, TOP_SCORER_POINTS_PER_CORRECT } from "./topScorerPoints.js";
import { getLeaderboardEntries } from "./leaderboard.js";

export interface RoundStandingEntry {
  userId: string;
  displayName: string;
  correct: number;
  total: number;
  points: number;
}

/**
 * One round's prediction points per user (2026-10-02, the Leaderboard page's
 * Round tab and the round recap): win/loss points plus top-scorer points for
 * that round's final games, scored exactly like the overall leaderboard
 * (pointsSqlExpr, per_game_leader from topScorerTotalsCte). Bonus
 * adjustments aren't tied to a round, so they're left out. Admins excluded,
 * same as getLeaderboardEntries. One statement.
 */
export async function getRoundStandings(
  season: string,
  round: number,
  options: { includeAdmins?: boolean } = {}
): Promise<RoundStandingEntry[]> {
  const pickedFairProb = sql`case when p.predicted_winner_team_id = g.home_team_id then go.home_fair_prob else go.away_fair_prob end`;
  const isCorrect = sql`p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end`;

  const rows = await db.execute<{ user_id: string; username: string; is_admin: boolean; correct: number; total: number; points: number }>(sql`
    with ${topScorerTotalsCte()},
    round_wl as (
      select p.user_id,
        count(*) filter (where ${isCorrect})::int as correct,
        count(*)::int as total,
        sum(case when ${isCorrect} then ${pointsSqlExpr(pickedFairProb)} else 0 end)::int as points
      from ${predictions} p
      join ${games} g on g.id = p.game_id
      left join ${gameOdds} go on go.game_id = g.id
      where g.season = ${season} and g.round = ${round} and g.status = 'final'
        and g.home_score is not null and g.away_score is not null and g.home_score <> g.away_score
      group by p.user_id
    ),
    round_ts as (
      select tsp.user_id,
        sum(coalesce(tsp.points_at_pick, ${TOP_SCORER_POINTS_PER_CORRECT}))::int as points
      from ${topScorerPredictions} tsp
      join ${games} g on g.id = tsp.game_id
      join per_game_leader pgl on pgl.game_id = tsp.game_id
      where g.season = ${season} and g.round = ${round} and g.status = 'final'
        and pgl.top_scorer_player_id = tsp.predicted_player_id
      group by tsp.user_id
    )
    select u.id as user_id, u.username, u.is_admin,
      coalesce(wl.correct, 0)::int as correct,
      coalesce(wl.total, 0)::int as total,
      (coalesce(wl.points, 0) + coalesce(ts.points, 0))::int as points
    from ${users} u
    left join round_wl wl on wl.user_id = u.id
    left join round_ts ts on ts.user_id = u.id
    where wl.user_id is not null or ts.user_id is not null
  `);

  return rows
    .filter((r) => options.includeAdmins || !r.is_admin)
    .map((r) => ({ userId: r.user_id, displayName: r.username, correct: r.correct, total: r.total, points: r.points }))
    .sort((a, b) => b.points - a.points || b.correct - a.correct || a.displayName.localeCompare(b.displayName));
}

/** Rounds of a season with at least one final game, plus the latest fully final one. */
export async function getPlayedRounds(season: string): Promise<{ rounds: number[]; lastComplete: number | null; lastCompleteAt: string | null }> {
  const rows = await db.execute<{ round: number; complete: boolean; last_tipoff: string }>(sql`
    select round, bool_and(status = 'final') as complete, max(tipoff_at) as last_tipoff
    from ${games}
    where season = ${season} and round is not null
    group by round
    having bool_or(status = 'final')
    order by round asc
  `);
  const complete = rows.filter((r) => r.complete);
  const last = complete[complete.length - 1] ?? null;
  return {
    rounds: rows.map((r) => r.round),
    lastComplete: last?.round ?? null,
    lastCompleteAt: last ? new Date(last.last_tipoff).toISOString() : null,
  };
}

export interface RoundRecap {
  season: string;
  round: number;
  // Last tipoff of the round — the client only shows a recap for a round
  // that finished recently.
  finishedAt: string;
  roundPoints: number;
  roundRank: number | null;
  roundPlayers: number;
  // Overall leaderboard rank now and before this round's points counted.
  // Null for admins, who aren't on the board.
  rank: number | null;
  rankBefore: number | null;
  leagues: { id: string; name: string; rank: number; members: number }[];
}

/**
 * Recap of the latest fully final round for one user, or null if no round
 * has finished or the user made no pick in it. rankBefore re-ranks everyone
 * by (overall points − that round's points), which is exact for prediction
 * points; bonus adjustments are treated as if they predate the round.
 */
export async function getRoundRecap(userId: string, season: string): Promise<RoundRecap | null> {
  const { lastComplete, lastCompleteAt } = await getPlayedRounds(season);
  if (lastComplete === null || !lastCompleteAt) return null;

  // Admins aren't ranked, but still get a recap of their own points.
  const withAdmins = await getRoundStandings(season, lastComplete, { includeAdmins: true });
  const mine = withAdmins.find((r) => r.userId === userId);
  if (!mine) return null;
  const overall = await getLeaderboardEntries();
  const rankedIds = new Set(overall.map((e) => e.userId));
  const roundRows = withAdmins.filter((r) => rankedIds.has(r.userId) || r.userId === userId);

  const roundPointsById = new Map(roundRows.map((r) => [r.userId, r.points]));
  const rankAfterIdx = overall.findIndex((e) => e.userId === userId);
  const before = overall
    .map((e) => ({ userId: e.userId, points: e.points - (roundPointsById.get(e.userId) ?? 0), accuracy: e.accuracy }))
    .sort((a, b) => b.points - a.points || b.accuracy - a.accuracy);
  const rankBeforeIdx = before.findIndex((e) => e.userId === userId);

  // Every member of every league this user is in, in one statement.
  const memberships = await db.execute<{ league_id: string; name: string; user_id: string }>(sql`
    select lm.league_id, l.name, lm.user_id
    from ${leagueMembers} lm
    join ${leagues} l on l.id = lm.league_id
    join ${users} u on u.id = lm.user_id
    where u.is_admin = false
      and lm.league_id in (select league_id from ${leagueMembers} where user_id = ${userId})
  `);
  const overallIdx = new Map(overall.map((e, i) => [e.userId, i]));
  const byLeague = new Map<string, { name: string; members: string[] }>();
  for (const m of memberships) {
    const entry = byLeague.get(m.league_id) ?? { name: m.name, members: [] };
    entry.members.push(m.user_id);
    byLeague.set(m.league_id, entry);
  }
  const leagueRanks = [...byLeague.entries()]
    .filter(([, l]) => l.members.includes(userId))
    .map(([id, l]) => {
      // Members with no points yet sit below everyone ranked.
      const ordered = [...l.members].sort((a, b) => (overallIdx.get(a) ?? Infinity) - (overallIdx.get(b) ?? Infinity));
      return { id, name: l.name, rank: ordered.indexOf(userId) + 1, members: l.members.length };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    season,
    round: lastComplete,
    finishedAt: lastCompleteAt,
    roundPoints: mine.points,
    roundRank: rankedIds.has(userId) ? roundRows.filter((r) => rankedIds.has(r.userId)).indexOf(mine) + 1 : null,
    roundPlayers: roundRows.filter((r) => rankedIds.has(r.userId)).length,
    rank: rankAfterIdx === -1 ? null : rankAfterIdx + 1,
    rankBefore: rankBeforeIdx === -1 ? null : rankBeforeIdx + 1,
    leagues: leagueRanks,
  };
}
