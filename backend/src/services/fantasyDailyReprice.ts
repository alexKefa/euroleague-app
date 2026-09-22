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
 * Real EuroLeague Fantasy's own published price-variation formulas
 * (2026-09-21, sourced directly — two separate EuroLeague Fantasist/
 * @ELFantasist graphics, not a guess). Players and coaches use genuinely
 * different formulas, not just different constants plugged into one shape:
 *
 * - **Player**: `X = (N - P*1.1) / 25` — a player needs to outscore ~110%
 *   of their own price in fantasy points just to hold steady; anything
 *   short of that costs credits, anything past it gains them.
 * - **Coach**: `X = (N - P) / 40` — no breakeven multiplier at all (merely
 *   matching your own price holds steady), and a wider /40 divisor, so a
 *   coach's price moves more gently per round for a same-sized miss than a
 *   player's does.
 *
 * X is always the credit gain/loss, N the entity's real fantasy points that
 * round (`computeFantasyGamePoints`/`pointsForCoachResult`), P their price
 * *before* the round. Both replace this file's original launch-day formula
 * (`gamePoints / (currentPrice * 10)`, applied identically to both), which
 * was never sourced — picked only to land in the rough ballpark of
 * EuroLeague Fantasy's own public worked example (a 20.5cr player gaining
 * +1.5cr from one big game) because neither real formula was known yet at
 * the time. Both still clamped to +-DAILY_PRICE_MAX_DELTA as a safety net
 * against one outlier stat line — not part of either sourced formula
 * itself, but the natural range each produces already sits close to this
 * bound in practice (e.g. a 40-point game from a 4cr player:
 * (40-4.4)/25 ≈ 1.42), so this only ever clips genuine extremes.
 *
 * Deliberately separate from computeFantasyPrice/computeCoachPrice and the
 * periodic `fantasy:reprice` script, which still set each entity's
 * *baseline* price off season-long form/standings — this only ever nudges
 * that baseline day to day, it never recomputes from scratch. An
 * over-budget squad from a price increase is never invalidated
 * retroactively (explicit decision, 2026-09-16) — POST /lineup/batch's
 * budget check only blocks a *new* submission from exceeding the cap, same
 * as budgetCap itself already only ever moves up without breaking an
 * existing squad.
 */
export const FANTASY_PRICE_VARIATION_MULTIPLIER = 1.1;
export const FANTASY_PRICE_VARIATION_DIVISOR = 25;
export const DAILY_PRICE_MAX_DELTA = 1.0;

// Coaches have their own, genuinely different published formula (same
// source, a second EuroLeague Fantasist/@ELFantasist graphic, 2026-09-21):
// `X = (N - P) / 40` — no 1.1 breakeven multiplier on price at all (a coach
// needs to merely match their own price in fantasy points to hold steady,
// not out-earn 110% of it), and a wider /40 divisor than a player's /25, so
// a coach's price moves more gently per round for the same-sized miss.
export const COACH_PRICE_VARIATION_DIVISOR = 40;

function priceVariationDelta(gamePoints: number, currentPrice: number): number {
  return clampDelta((gamePoints - currentPrice * FANTASY_PRICE_VARIATION_MULTIPLIER) / FANTASY_PRICE_VARIATION_DIVISOR);
}

function coachPriceVariationDelta(gamePoints: number, currentPrice: number): number {
  return clampDelta((gamePoints - currentPrice) / COACH_PRICE_VARIATION_DIVISOR);
}

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
    const delta = priceVariationDelta(gamePoints, currentPrice);
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
    const delta = coachPriceVariationDelta(gamePoints, currentPrice);
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
