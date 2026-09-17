import "dotenv/config";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  games,
  players,
  playerGameStats,
  playerFantasyPrices,
  coachFantasyPrices,
  fantasyPriceChangeLog,
  fantasyCoachPriceChangeLog,
  fantasyPricingState,
} from "../db/schema.js";
import {
  computeFantasyGamePoints,
  pointsForCoachResult,
  FANTASY_MIN_PRICE,
  FANTASY_MAX_PRICE,
  COACH_MIN_PRICE,
  COACH_MAX_PRICE,
  FANTASY_PIR_CEILING_FLOOR,
} from "./fantasyScoring.js";

/**
 * Real EuroLeague Fantasy moves every player's (and coach's) price a
 * little every day, based on that day's real performance weighed against
 * their *current* price — a cheap player's price moves further for the
 * same performance than an expensive one's does (their own docs example:
 * a 20.5cr player gains +1.5cr from one big game). Modeled here as
 * `delta = gamePoints / (currentPrice * DAILY_PRICE_SENSITIVITY_DIVISOR)`,
 * clamped to +-DAILY_PRICE_MAX_DELTA so one game can't swing a price
 * wildly. Neither constant is sourced from a real published number (their
 * exact formula isn't public) — picked to land in the same ballpark as
 * their own worked example and tunable from here if real play shows it
 * moving too fast or too slow.
 *
 * Deliberately separate from computeFantasyPrice/the periodic
 * `fantasy:reprice` script, which still sets a player's *baseline* price
 * off season-long form — this only ever nudges that baseline day to day,
 * it never recomputes from scratch. An over-budget squad from a price
 * increase is never invalidated retroactively (explicit decision,
 * 2026-09-16) — POST /lineup/batch's budget check only blocks a *new*
 * submission from exceeding the cap, same as budgetCap itself already
 * only ever moves up without breaking an existing squad.
 */
export const DAILY_PRICE_SENSITIVITY_DIVISOR = 10;
export const DAILY_PRICE_MAX_DELTA = 1.0;

function clampDelta(delta: number): number {
  return Math.max(-DAILY_PRICE_MAX_DELTA, Math.min(DAILY_PRICE_MAX_DELTA, delta));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

async function bumpCeilingIfNeeded(season: string, highestPrice: number): Promise<void> {
  const [existing] = await db.select().from(fantasyPricingState).where(eq(fantasyPricingState.season, season));
  const impliedCeiling = FANTASY_PIR_CEILING_FLOOR * ((highestPrice - FANTASY_MIN_PRICE) / (FANTASY_MAX_PRICE - FANTASY_MIN_PRICE) || 0);
  const nextCeiling = Math.max(existing?.ceiling ?? FANTASY_PIR_CEILING_FLOOR, impliedCeiling, FANTASY_PIR_CEILING_FLOOR);
  if (existing) {
    if (nextCeiling > existing.ceiling) {
      await db.update(fantasyPricingState).set({ ceiling: nextCeiling, updatedAt: new Date() }).where(eq(fantasyPricingState.season, season));
    }
  } else {
    await db.insert(fantasyPricingState).values({ season, ceiling: nextCeiling });
  }
}

/**
 * Applies one day's worth of pending price moves for both players and
 * coaches — safe to call on any interval, any number of times: each run
 * only processes (player/coach, game) pairs with no fantasy_price_change_log
 * row yet, so restarts or an irregular schedule can't double-apply or
 * silently skip a game the way a timestamp watermark could.
 */
export async function applyDailyFantasyPriceChanges(season: string): Promise<{ playersUpdated: number; coachesUpdated: number }> {
  const playersUpdated = await applyPlayerPriceChanges(season);
  const coachesUpdated = await applyCoachPriceChanges(season);
  return { playersUpdated, coachesUpdated };
}

async function applyPlayerPriceChanges(season: string): Promise<number> {
  const pending = await db.execute<{
    player_id: string;
    game_id: string;
    team_id: string;
    home_team_id: string;
    away_team_id: string;
    home_score: number | null;
    away_score: number | null;
    points: number | null;
    rebounds: number | null;
    assists: number | null;
    steals: number | null;
    turnovers: number | null;
    blocks_favour: number | null;
    blocks_against: number | null;
    fouls_committed: number | null;
    fouls_received: number | null;
    field_goals_made_2: number | null;
    field_goals_attempted_2: number | null;
    field_goals_made_3: number | null;
    field_goals_attempted_3: number | null;
    free_throws_made: number | null;
    free_throws_attempted: number | null;
  }>(sql`
    select pgs.player_id, pgs.game_id, p.team_id,
      g.home_team_id, g.away_team_id, g.home_score, g.away_score,
      pgs.points, pgs.rebounds, pgs.assists, pgs.steals, pgs.turnovers,
      pgs.blocks_favour, pgs.blocks_against, pgs.fouls_committed, pgs.fouls_received,
      pgs.field_goals_made_2, pgs.field_goals_attempted_2,
      pgs.field_goals_made_3, pgs.field_goals_attempted_3,
      pgs.free_throws_made, pgs.free_throws_attempted
    from player_game_stats pgs
    join games g on g.id = pgs.game_id and g.status = 'final' and g.season = ${season}
    join players p on p.id = pgs.player_id
    where not exists (
      select 1 from fantasy_price_change_log l where l.player_id = pgs.player_id and l.game_id = pgs.game_id
    )
  `);
  if (pending.length === 0) return 0;

  const playerIds = [...new Set(pending.map((r) => r.player_id))];
  const priceRows = await db
    .select({ playerId: playerFantasyPrices.playerId, price: playerFantasyPrices.price })
    .from(playerFantasyPrices)
    .where(and(eq(playerFantasyPrices.season, season), inArray(playerFantasyPrices.playerId, playerIds)));
  const priceByPlayerId = new Map(priceRows.map((r) => [r.playerId, r.price]));

  let highestPrice = 0;
  const priceUpdates: { playerId: string; newPrice: number }[] = [];
  const logRows: { playerId: string; gameId: string; delta: number }[] = [];

  for (const row of pending) {
    const currentPrice = priceByPlayerId.get(row.player_id) ?? FANTASY_MIN_PRICE;
    const teamWon =
      (row.team_id === row.home_team_id && (row.home_score ?? 0) > (row.away_score ?? 0)) ||
      (row.team_id === row.away_team_id && (row.away_score ?? 0) > (row.home_score ?? 0));
    const gamePoints = computeFantasyGamePoints(
      {
        points: row.points,
        rebounds: row.rebounds,
        assists: row.assists,
        steals: row.steals,
        turnovers: row.turnovers,
        blocksFavour: row.blocks_favour,
        blocksAgainst: row.blocks_against,
        foulsCommitted: row.fouls_committed,
        foulsReceived: row.fouls_received,
        fieldGoalsMade2: row.field_goals_made_2,
        fieldGoalsAttempted2: row.field_goals_attempted_2,
        fieldGoalsMade3: row.field_goals_made_3,
        fieldGoalsAttempted3: row.field_goals_attempted_3,
        freeThrowsMade: row.free_throws_made,
        freeThrowsAttempted: row.free_throws_attempted,
      },
      teamWon
    );
    const delta = clampDelta(gamePoints / (currentPrice * DAILY_PRICE_SENSITIVITY_DIVISOR));
    const newPrice = round1(Math.min(FANTASY_MAX_PRICE, Math.max(FANTASY_MIN_PRICE, currentPrice + delta)));
    priceByPlayerId.set(row.player_id, newPrice); // so a player with 2 games "today" (shouldn't normally happen) compounds correctly
    priceUpdates.push({ playerId: row.player_id, newPrice });
    logRows.push({ playerId: row.player_id, gameId: row.game_id, delta });
    highestPrice = Math.max(highestPrice, newPrice);
  }

  // One batched UPDATE...FROM (VALUES ...) rather than one round trip per
  // player — same lever CLAUDE.md documents elsewhere for this DB.
  const values = priceUpdates.map((u) => sql`(${u.playerId}::uuid, ${u.newPrice}::real)`);
  await db.execute(sql`
    update player_fantasy_prices
    set price = v.price, updated_at = now()
    from (values ${sql.join(values, sql`, `)}) as v(player_id, price)
    where player_fantasy_prices.player_id = v.player_id and player_fantasy_prices.season = ${season}
  `);
  await db.insert(fantasyPriceChangeLog).values(logRows).onConflictDoNothing();

  if (highestPrice > 0) await bumpCeilingIfNeeded(season, highestPrice);
  return priceUpdates.length;
}

async function applyCoachPriceChanges(season: string): Promise<number> {
  const pending = await db.execute<{
    team_id: string;
    game_id: string;
    home_team_id: string;
    away_team_id: string;
    home_score: number | null;
    away_score: number | null;
  }>(sql`
    select g.id as game_id, g.home_team_id, g.away_team_id, g.home_score, g.away_score, t.id as team_id
    from games g
    join teams t on t.id = g.home_team_id or t.id = g.away_team_id
    where g.status = 'final' and g.season = ${season}
      and not exists (
        select 1 from fantasy_coach_price_change_log l where l.team_id = t.id and l.game_id = g.id
      )
  `);
  if (pending.length === 0) return 0;

  const teamIds = [...new Set(pending.map((r) => r.team_id))];
  const priceRows = await db
    .select({ teamId: coachFantasyPrices.teamId, price: coachFantasyPrices.price })
    .from(coachFantasyPrices)
    .where(and(eq(coachFantasyPrices.season, season), inArray(coachFantasyPrices.teamId, teamIds)));
  const priceByTeamId = new Map(priceRows.map((r) => [r.teamId, r.price]));

  const priceUpdates: { teamId: string; newPrice: number }[] = [];
  const logRows: { teamId: string; gameId: string; delta: number }[] = [];

  for (const row of pending) {
    const currentPrice = priceByTeamId.get(row.team_id) ?? COACH_MIN_PRICE;
    const scoreFor = row.team_id === row.home_team_id ? row.home_score ?? 0 : row.away_score ?? 0;
    const scoreAgainst = row.team_id === row.home_team_id ? row.away_score ?? 0 : row.home_score ?? 0;
    const gamePoints = pointsForCoachResult(scoreFor, scoreAgainst);
    const delta = clampDelta(gamePoints / (currentPrice * DAILY_PRICE_SENSITIVITY_DIVISOR));
    const newPrice = round1(Math.min(COACH_MAX_PRICE, Math.max(COACH_MIN_PRICE, currentPrice + delta)));
    priceByTeamId.set(row.team_id, newPrice);
    priceUpdates.push({ teamId: row.team_id, newPrice });
    logRows.push({ teamId: row.team_id, gameId: row.game_id, delta });
  }

  const values = priceUpdates.map((u) => sql`(${u.teamId}::uuid, ${u.newPrice}::real)`);
  await db.execute(sql`
    update coach_fantasy_prices
    set price = v.price, updated_at = now()
    from (values ${sql.join(values, sql`, `)}) as v(team_id, price)
    where coach_fantasy_prices.team_id = v.team_id and coach_fantasy_prices.season = ${season}
  `);
  await db.insert(fantasyCoachPriceChangeLog).values(logRows).onConflictDoNothing();

  return priceUpdates.length;
}
