import "dotenv/config";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
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
  FANTASY_PIR_CEILING_FLOOR,
} from "./fantasyScoring.js";
import { refreshFinalBoxscore } from "../sync/liveGamesSync.js";

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

/**
 * Rounding, as matched against every round-1 move in the real game
 * (2026-09-29, Dunkest quotations: 225/225 players who played, 20/20
 * coaches): the raw X is rounded to 2 decimals first, then to 1 (half up),
 * e.g. -0.252 -> -0.25 -> -0.2 and 0.149 -> 0.15 -> 0.2. Rounding straight to
 * 1 decimal got about 1 in 3 moves wrong by 0.1.
 */
function roundMove(x: number): number {
  const hundredths = Math.round(x * 100);
  return Math.round(hundredths / 10) / 10;
}

function priceVariationDelta(gamePoints: number, currentPrice: number): number {
  return roundMove(clampDelta((gamePoints - currentPrice * FANTASY_PRICE_VARIATION_MULTIPLIER) / FANTASY_PRICE_VARIATION_DIVISOR));
}

function coachPriceVariationDelta(gamePoints: number, currentPrice: number): number {
  return roundMove(clampDelta((gamePoints - currentPrice) / COACH_PRICE_VARIATION_DIVISOR));
}

function clampDelta(delta: number): number {
  return Math.max(-DAILY_PRICE_MAX_DELTA, Math.min(DAILY_PRICE_MAX_DELTA, delta));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * A rostered player who didn't get on the floor loses a flat 0.1 in the real
 * game, not the formula's (0 - P*1.1)/25 (which would be -0.2 to -0.6):
 * 73 of 89 such round-1 players above the floor moved exactly -0.1. The
 * other 16 held, probably players left out of the game-day squad, which our
 * box score can't tell apart from a DNP, so this can be 0.1 off for them.
 */
export const DNP_PRICE_DELTA = -0.1;

// Coaches aren't floored at COACH_MIN_PRICE in the real game (four 5.0
// coaches dropped to 4.6-4.8 after round 1); that constant is only the
// bottom of the season-start curve. This is just a sanity floor.
const COACH_PRICE_FLOOR = 1;

/**
 * Prices move once per *round*, not per game (2026-09-30, direct report: a
 * double-day round 2 had its Tuesday games priced before Wednesday's were
 * played, so budgets showed a half-round loss). That's the real game's rule
 * too: "The credit value assigned to each player increases or decreases
 * after each Round" (Dunkest's EuroLeague Fantasy rules). A round is priced
 * only once every game in it is final and its last tipoff is this old; box
 * scores are re-fetched right before, so the move uses the official final
 * sheet, not whatever the last live poll stored (see refreshFinalBoxscore).
 * 12h -> 3h (2026-10-01): EuroLeague Fantasy moves prices overnight, so a
 * 12h wait left budgets a round behind the real game every morning. The
 * box-score re-fetch above already covers late stat corrections.
 */
export const PRICE_SETTLE_MS = 3 * 60 * 60 * 1000;

// An unfinished game only holds its round back if it was due within this
// long of the round's last finished game. There's no "postponed" status, so
// without this a game moved weeks later would freeze everyone's credits;
// it's priced on its own once it's actually played.
const ROUND_STRAGGLER_WINDOW = "2 days";

/**
 * SQL condition on a games row aliased `g`: its whole round is settled
 * (see PRICE_SETTLE_MS).
 */
function roundSettled(settledBefore: string) {
  const lastFinal = sql`(select max(f.tipoff_at) from games f where f.season = g.season and f.round = g.round and f.status = 'final')`;
  return sql`${lastFinal} < ${settledBefore}::timestamptz
    and not exists (
      select 1 from games r
      where r.season = g.season and r.round = g.round and r.status <> 'final'
        and r.tipoff_at < ${lastFinal} + ${ROUND_STRAGGLER_WINDOW}::interval
    )`;
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
 * Applies every pending price move for both players and coaches. Safe to
 * call on any interval, any number of times: each run only processes
 * (player/coach, game) pairs with no change-log row yet, so restarts or an
 * irregular schedule can't double-apply or silently skip a game.
 */
export async function applyDailyFantasyPriceChanges(season: string): Promise<{ playersUpdated: number; coachesUpdated: number }> {
  const settledBefore = new Date(Date.now() - PRICE_SETTLE_MS).toISOString();
  // Games about to be priced for the first time (no coach move logged yet;
  // both teams' coach rows are always written together) get their official
  // box score re-fetched first.
  const unpriced = await db.execute<{ id: string; game_code: number }>(sql`
    select g.id, g.game_code from games g
    where g.season = ${season} and g.status = 'final' and ${roundSettled(settledBefore)}
      and not exists (select 1 from fantasy_coach_price_change_log l where l.game_id = g.id)
  `);
  for (const g of unpriced) {
    await refreshFinalBoxscore(g.id, season, g.game_code).catch((err) =>
      console.error(`[fantasy daily reprice] box score refresh failed for ${g.id}:`, err)
    );
  }
  const playersUpdated = await applyPlayerPriceChanges(season, settledBefore);
  const coachesUpdated = await applyCoachPriceChanges(season, settledBefore);
  return { playersUpdated, coachesUpdated };
}

type PlayerMoveRow = {
  player_id: string;
  game_id: string;
  team_id: string;
  price: number;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  has_row: boolean;
  minutes: number | null;
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
};

function didPlay(r: PlayerMoveRow): boolean {
  if (!r.has_row) return false;
  if ((r.minutes ?? 0) > 0) return true;
  return [
    r.points, r.rebounds, r.assists, r.steals, r.turnovers, r.blocks_favour, r.blocks_against,
    r.fouls_committed, r.fouls_received, r.field_goals_attempted_2, r.field_goals_attempted_3, r.free_throws_attempted,
  ].some((v) => (v ?? 0) !== 0);
}

async function applyPlayerPriceChanges(season: string, settledBefore: string): Promise<number> {
  // Every priced player who either has a box-score row for the game, or is
  // on one of its two teams' active rosters (so a DNP still moves).
  const pending = (await db.execute<PlayerMoveRow>(sql`
    select p.id as player_id, g.id as game_id, p.team_id, pfp.price,
      g.home_team_id, g.away_team_id, g.home_score, g.away_score,
      pgs.player_id is not null as has_row, pgs.minutes,
      pgs.points, pgs.rebounds, pgs.assists, pgs.steals, pgs.turnovers,
      pgs.blocks_favour, pgs.blocks_against, pgs.fouls_committed, pgs.fouls_received,
      pgs.field_goals_made_2, pgs.field_goals_attempted_2,
      pgs.field_goals_made_3, pgs.field_goals_attempted_3,
      pgs.free_throws_made, pgs.free_throws_attempted
    from games g
    join player_fantasy_prices pfp on pfp.season = g.season
    join players p on p.id = pfp.player_id
    left join player_game_stats pgs on pgs.game_id = g.id and pgs.player_id = p.id
    where g.season = ${season} and g.status = 'final' and ${roundSettled(settledBefore)}
      and (pgs.player_id is not null or (p.active and p.team_id in (g.home_team_id, g.away_team_id)))
      and not exists (
        select 1 from fantasy_price_change_log l where l.player_id = p.id and l.game_id = g.id
      )
    order by g.tipoff_at
  `)) as PlayerMoveRow[];
  if (pending.length === 0) return 0;

  const priceByPlayerId = new Map<string, number>();
  let highestPrice = 0;
  const logRows: { playerId: string; gameId: string; delta: number; appliedDelta: number }[] = [];

  for (const row of pending) {
    const currentPrice = priceByPlayerId.get(row.player_id) ?? Number(row.price);
    let rawDelta: number;
    let delta: number;
    if (didPlay(row)) {
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
      rawDelta = (gamePoints - currentPrice * FANTASY_PRICE_VARIATION_MULTIPLIER) / FANTASY_PRICE_VARIATION_DIVISOR;
      delta = priceVariationDelta(gamePoints, currentPrice);
    } else {
      rawDelta = DNP_PRICE_DELTA;
      delta = DNP_PRICE_DELTA;
    }
    // Floor only, no ceiling (2026-09-28): FANTASY_MAX_PRICE is the top of
    // computeFantasyPrice's season-start curve, not a limit on in-season
    // moves. A price above it is what bumpCeilingIfNeeded turns into a
    // bigger budget.
    const newPrice = round1(Math.max(FANTASY_MIN_PRICE, currentPrice + delta));
    priceByPlayerId.set(row.player_id, newPrice);
    logRows.push({ playerId: row.player_id, gameId: row.game_id, delta: rawDelta, appliedDelta: round1(newPrice - currentPrice) });
    highestPrice = Math.max(highestPrice, newPrice);
  }

  // One batched UPDATE...FROM (VALUES ...) rather than one round trip per
  // player, same lever CLAUDE.md documents elsewhere for this DB.
  const values = [...priceByPlayerId].map(([playerId, price]) => sql`(${playerId}::uuid, ${price}::real)`);
  await db.execute(sql`
    update player_fantasy_prices
    set price = v.price, updated_at = now()
    from (values ${sql.join(values, sql`, `)}) as v(player_id, price)
    where player_fantasy_prices.player_id = v.player_id and player_fantasy_prices.season = ${season}
  `);
  await db.insert(fantasyPriceChangeLog).values(logRows).onConflictDoNothing();

  if (highestPrice > 0) await bumpCeilingIfNeeded(season, highestPrice);
  return priceByPlayerId.size;
}

async function applyCoachPriceChanges(season: string, settledBefore: string): Promise<number> {
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
    where g.status = 'final' and g.season = ${season} and ${roundSettled(settledBefore)}
      and not exists (
        select 1 from fantasy_coach_price_change_log l where l.team_id = t.id and l.game_id = g.id
      )
    order by g.tipoff_at
  `);
  if (pending.length === 0) return 0;

  const teamIds = [...new Set(pending.map((r) => r.team_id))];
  const priceRows = await db
    .select({ teamId: coachFantasyPrices.teamId, price: coachFantasyPrices.price })
    .from(coachFantasyPrices)
    .where(and(eq(coachFantasyPrices.season, season), inArray(coachFantasyPrices.teamId, teamIds)));
  const priceByTeamId = new Map(priceRows.map((r) => [r.teamId, r.price]));

  const priceUpdates: { teamId: string; newPrice: number }[] = [];
  const logRows: { teamId: string; gameId: string; delta: number; appliedDelta: number }[] = [];

  for (const row of pending) {
    const currentPrice = priceByTeamId.get(row.team_id) ?? COACH_MIN_PRICE;
    const scoreFor = row.team_id === row.home_team_id ? row.home_score ?? 0 : row.away_score ?? 0;
    const scoreAgainst = row.team_id === row.home_team_id ? row.away_score ?? 0 : row.home_score ?? 0;
    const gamePoints = pointsForCoachResult(scoreFor, scoreAgainst);
    const delta = coachPriceVariationDelta(gamePoints, currentPrice);
    const newPrice = round1(Math.max(COACH_PRICE_FLOOR, currentPrice + delta));
    priceByTeamId.set(row.team_id, newPrice);
    priceUpdates.push({ teamId: row.team_id, newPrice });
    logRows.push({
      teamId: row.team_id,
      gameId: row.game_id,
      delta: (gamePoints - currentPrice) / COACH_PRICE_VARIATION_DIVISOR,
      appliedDelta: round1(newPrice - currentPrice),
    });
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
