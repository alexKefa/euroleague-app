import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { getCurrentSeason } from "./season.js";
import { COACH_MIN_PRICE, FANTASY_MIN_PRICE, FANTASY_POINTS_CONVERSION_RATE, getDefaultRound, getFantasyLeaderboardEntries } from "./fantasyScoring.js";

/**
 * Server-side Fantasy Five round bookkeeping, so it no longer depends on
 * the user opening the right page (2026-09-29: 12 of 15 players never got
 * their round-1 points because GET /fantasy/lineup only granted them for the
 * round being viewed, and the page had already moved on to round 2).
 *
 * 1. Carry-forward: anyone with no squad for the current round gets last
 *    round's squad/coach copied in at today's prices, the same seed GET
 *    /fantasy/lineup does on read. Without it, skipping a round's visit
 *    scored 0 and broke the chain for every round after.
 * 2. Grants: every squad in a fully-final round gets a fantasy_round_points
 *    row (0-point rows included, so a round stops being re-checked) plus the
 *    "Fantasy Five — Round N" adjustment when points > 0. Claim-first via the
 *    unique index, so this and the on-read grant never double-pay.
 *
 * Runs hourly and whenever a game goes final (index.ts). Few statements per
 * run: most runs find nothing to seed or grant.
 */
export async function runFantasyRoundSweep(): Promise<{ seededUsers: number; grants: number }> {
  const season = await getCurrentSeason();
  if (!season) return { seededUsers: 0, grants: 0 };

  let seededUsers = 0;
  const round = await getDefaultRound(season);
  if (round !== null && round > 1) {
    // Coach first: its "no squad yet this round" guard must see the state
    // before the lineup insert below fills it in.
    await db.execute(sql`
      insert into fantasy_coach_picks (user_id, season, round, team_id, price_at_pick)
      select c.user_id, c.season, ${round}, c.team_id, coalesce(cfp.price, ${COACH_MIN_PRICE})
      from fantasy_coach_picks c
      left join coach_fantasy_prices cfp on cfp.team_id = c.team_id and cfp.season = c.season
      where c.season = ${season} and c.round = ${round - 1}
        and not exists (select 1 from fantasy_lineups x where x.user_id = c.user_id and x.season = ${season} and x.round = ${round})
        and not exists (select 1 from fantasy_coach_picks y where y.user_id = c.user_id and y.season = ${season} and y.round = ${round})
      on conflict do nothing
    `);
    const seeded = await db.execute<{ user_id: string }>(sql`
      insert into fantasy_lineups (user_id, season, round, player_id, slot_role, is_captain, price_at_pick)
      select fl.user_id, fl.season, ${round}, fl.player_id, fl.slot_role, fl.is_captain, coalesce(pfp.price, ${FANTASY_MIN_PRICE})
      from fantasy_lineups fl
      left join player_fantasy_prices pfp on pfp.player_id = fl.player_id and pfp.season = fl.season
      where fl.season = ${season} and fl.round = ${round - 1}
        and not exists (select 1 from fantasy_lineups x where x.user_id = fl.user_id and x.season = ${season} and x.round = ${round})
      on conflict do nothing
      returning user_id
    `);
    seededUsers = new Set(seeded.map((r) => r.user_id)).size;
  }

  const pending = await db.execute<{ round: number }>(sql`
    select distinct fl.round
    from fantasy_lineups fl
    where fl.season = ${season}
      and fl.round in (
        select g.round from games g where g.season = ${season} and g.round is not null
        group by g.round having bool_and(g.status = 'final')
      )
      and not exists (
        select 1 from fantasy_round_points f where f.user_id = fl.user_id and f.season = ${season} and f.round = fl.round
      )
  `);

  let grants = 0;
  for (const { round: doneRound } of pending) {
    const entries = await getFantasyLeaderboardEntries({ season, round: doneRound, includeAdmins: true });
    if (entries.length === 0) continue;
    const rows = entries.map((e) => ({
      userId: e.userId,
      points: Math.max(0, Math.floor(e.fantasyPoints * FANTASY_POINTS_CONVERSION_RATE)),
    }));
    // One statement: claim the rows, then insert adjustments only for the
    // ones this call actually claimed (with points > 0).
    const claimed = await db.execute<{ user_id: string }>(sql`
      with claimed as (
        insert into fantasy_round_points (user_id, season, round, points)
        values ${sql.join(
          rows.map((r) => sql`(${r.userId}::uuid, ${season}, ${doneRound}, ${r.points})`),
          sql`, `
        )}
        on conflict do nothing
        returning user_id, points
      ),
      adj as (
        insert into point_adjustments (user_id, points, reason, created_by_user_id)
        select user_id, points, ${`Fantasy Five — Round ${doneRound}`}, user_id from claimed where points > 0
      )
      select user_id from claimed where points > 0
    `);
    grants += claimed.length;
  }

  return { seededUsers, grants };
}
