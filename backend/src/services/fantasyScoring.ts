import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  games,
  users,
  collectibles,
  teams,
  players,
  playerFantasyPrices,
  coachFantasyPrices,
  fantasyLineups,
  fantasyCoachPicks,
  fantasyRoundPoints,
  pointAdjustments,
  playerGameStats,
} from "../db/schema.js";

// --- Squad shape (2026-09-05 rebuild to match EuroLeague Fantasy's real
// Classic Mode rules directly, rather than our own simplified variant —
// see CLAUDE.md's Fantasy Five section for the sourced rules and why each
// of these matches them exactly) ---
//
// 10 outfield players (4 Guards + 4 Forwards + 2 Centers) + 1 head coach,
// under one FANTASY_BUDGET_CAP. Of the 10 outfield players: 5 "starters" +
// 1 "sixth man" score 100% of a locked round's points; the remaining 4
// "bench" players score BENCH_SCORE_MULTIPLIER (50%). The captain (always
// one of the 5 starters) doubles on top of that. The coach always scores
// 100% — see pointsForCoachResult below — never bench-reduced, since there's
// only ever one of them.
export const FANTASY_STARTER_COUNT = 5;
export const FANTASY_SIXTH_MAN_COUNT = 1;
export const FANTASY_BENCH_COUNT = 4;
export const FANTASY_TOTAL_OUTFIELD = FANTASY_STARTER_COUNT + FANTASY_SIXTH_MAN_COUNT + FANTASY_BENCH_COUNT; // 10
export const FANTASY_POSITION_QUOTA: Record<"Guard" | "Forward" | "Center", number> = {
  Guard: 4,
  Forward: 4,
  Center: 2,
};

// Mirrors frontend/src/app/features/fantasy/fantasy.ts's FORMATION_POSITIONS
// count vectors (2-2-1/2-1-2/3-1-1/1-2-2/1-3-1) — the 5 on-court shapes a
// valid 5-starter group can take. The backend has no formation concept of
// its own (slotRole is just "starter"/"sixth_man"/"bench", never a specific
// court slot — see saveFantasyLineup's doc comment), but autoFillFantasySquad
// still needs this to guarantee its randomly-picked starters actually form
// one of these shapes, rather than an arbitrary 5-of-10 split that might
// match none of them. Keep in sync with the frontend list by hand if a
// formation is ever added/removed there.
const FANTASY_FORMATION_VECTORS: Record<"Guard" | "Forward" | "Center", number>[] = [
  { Guard: 2, Forward: 2, Center: 1 }, // 2-2-1
  { Guard: 2, Forward: 1, Center: 2 }, // 2-1-2
  { Guard: 3, Forward: 1, Center: 1 }, // 3-1-1
  { Guard: 1, Forward: 2, Center: 2 }, // 1-2-2
  { Guard: 1, Forward: 3, Center: 1 }, // 1-3-1
];
// EuroLeague Fantasy's own published rules (2026-09-16 read) cap how many
// of the 10 outfield players can come from the same real club, to stop a
// degenerate "just draft one contender's whole roster" strategy — not
// previously enforced here at all. Scoped to the outfield 10 only, not the
// coach (a separate roster slot with its own club, same as real rules).
export const FANTASY_MAX_PLAYERS_PER_CLUB = 6;
export const BENCH_SCORE_MULTIPLIER = 0.5;

// Round-to-round transfers (2026-09-07, limit corrected 2026-09-16): a
// squad now carries forward automatically from the previous round (see
// routes/fantasy.ts's GET /lineup carry-forward and getBaselineSquad)
// instead of starting every round from an empty court — real
// fantasy-sports "gameweek" model. Only up to this many *player* changes
// are allowed against that carried-over baseline before the round locks
// (EuroLeague Fantasy's own published rules say 4, not 3 — corrected
// against a direct read of their rules site); the coach is a separate,
// unlimited change (real rules don't ration coach picks the way they
// ration transfers), and moving an already-selected player between
// starter/sixth-man/bench costs nothing since no player id actually
// changed. Round 1 (no prior round to carry from) stays a free, unlimited
// draft, same as always.
export const FANTASY_TRANSFERS_PER_ROUND = 4;

// Real EuroLeague Fantasy also grants a handful of *unlimited*-transfer
// rounds across a season, roughly tied to real-world FIBA/schedule
// breaks — the round immediately following each of these regular-season
// rounds has no transfer cap at all, on top of the regular-season's last
// round (34) onward, once playoffs start. Exact round numbers are an
// approximation (EuroLeague's rules page describes them as tied to real
// calendar breaks, not fixed round numbers we could read verbatim) —
// revisit once a real 2026-27 schedule confirms the actual break rounds.
const FANTASY_UNLIMITED_TRANSFER_TRIGGER_ROUNDS = [6, 13, 18, 23, 28, 34];
export function isUnlimitedTransferRound(round: number): boolean {
  return FANTASY_UNLIMITED_TRANSFER_TRIGGER_ROUNDS.some((r) => round === r + 1) || round > 34;
}

export const FANTASY_BUDGET_CAP = 100;
export const FANTASY_MIN_PRICE = 4;
export const FANTASY_MAX_PRICE = 17;

// A player with zero usable PIR at all (no games this season or any prior
// one — a true rookie or a signing new to EuroLeague, e.g. an NBA/other-
// league transfer) used to floor at the flat FANTASY_MIN_PRICE here, same
// as a genuine deep-bench player. First calibrated 2026-09-18 (median 5.7/
// mean 6.45 off a 71-player Dunkest sample) to 6; re-calibrated 2026-09-19
// off a much larger 335-player pull (306 matched our own `players` — 100
// landed in this exact zero-history bucket), exported directly from the
// live EuroLeague Fantasy app's own "Download" button while logged in
// (not scraped — every unauthenticated attempt against either the app's
// real API or Dunkest's public stats page returned 401/empty, see the
// session notes; this data came from the app's own built-in export
// instead). Real prices in that 100-player zero-history group had a
// median of 6.6 and a mean of 6.84, both a bit above the old 6, so this
// constant moves to 6.5. The underlying limit is unchanged and worth
// restating: this group's real range is 4-11.3, a spread no single flat
// number can represent — Valančiūnas (the marquee-signing example that
// justified the original 4->6 bump) is *still* underpriced even now that
// he has some real EuroLeague data on file (see the price-curve comment
// below) — reputation/role-expectation pricing isn't something a
// stats-only pipeline can compute at all, only work around with a flat,
// imprecise average.
export const FANTASY_NO_DATA_PRICE = 6.5;

// --- Fantasy Five draft-price formula (scripts/reprice-fantasy-players.ts) ---
//
// v1 (the original build) priced a player off nothing but their season-long
// average PIR — a single flat number that can't move until the next manual
// reprice and treats a guy on a 10-game hot streak identically to one on a
// 10-game cold one, as long as their season average landed the same. Real
// fantasy-credit systems (EuroLeague Fantasy included) visibly react to
// recent form, not just a season-to-date average. This blends two signals
// instead of one:
//
// 1. **Recent form** — average PIR over a player's last RECENT_FORM_WINDOW
//    *final* games this season, once at least MIN_RECENT_GAMES of them
//    exist. Below that many games (early season, a call-up, a return from
//    injury), recent form is too noisy a sample to trust at all, so pricing
//    falls back to the season-long baseline alone.
// 2. **Season baseline** — playerSeasonStats.valuation (or, once the
//    current season has no rows for a player yet, their own most recent
//    *prior* season's — see the reprice script), blended in at
//    (1 - RECENT_FORM_WEIGHT) once recent form is trusted, purely as a
//    stabilizer so one huge or tiny recent game can't swing a price as hard
//    as recent-form-only pricing would.
//
// Deliberately NOT a separate explicit "minutes" term multiplied in on top
// of PIR — PIR is already a box-score sum, so more minutes already produces
// a higher raw PIR on its own; a second multiplier on top of that would be
// double-counting the same signal. What raw PIR alone *can't* tell apart is
// a legitimate role player from someone padding an artificially high rate
// in mop-up garbage time — LOW_MINUTES_DAMPEN exists only for that narrow
// case (average minutes below LOW_MINUTES_THRESHOLD), not as a general
// playing-time multiplier.
export const RECENT_FORM_WINDOW = 8;
export const MIN_RECENT_GAMES = 3;
export const RECENT_FORM_WEIGHT = 0.65;
export const LOW_MINUTES_THRESHOLD = 12;
export const LOW_MINUTES_DAMPEN = 0.7;

// --- PIR-to-credit scaling (2026-09-06; re-anchoring added 2026-09-09) ---
//
// Every version of this formula up to now used the blended PIR number
// *as* the credit price directly (just rounded and clamped to
// [MIN_PRICE, MAX_PRICE]) — which happened to look reasonable only
// because real PIR values loosely fall in a similar numeric range to a
// plausible credit scale. It wasn't an actual scale: the top of the
// league (Vezenkov, ~22 PIR) priced at 22cr, while real EuroLeague
// Fantasy prices its own current top player (Vezenkov) at 17cr — a
// directly comparable, sourced reference point (2026-09-06). Rather than
// re-guess a ceiling, the scale is calibrated to exactly that: a player
// performing at Vezenkov's day-one level lands at FANTASY_MAX_PRICE, and
// everyone else is scaled linearly against that same anchor, not just
// individually clamped. This also gives real differentiation at the low
// end, which the old 1:1 mapping didn't: two bench players at PIR 1 and
// PIR 4 used to both floor at identical MIN_PRICE; now they land at
// visibly different (still low) prices.
//
// FANTASY_PIR_CEILING_FLOOR was originally a single fixed constant
// (FANTASY_PIR_CEILING) — pinned forever at Vezenkov's day-one raw value,
// so nobody could ever price above FANTASY_MAX_PRICE even once their real
// in-season form clearly overtook him (flagged 2026-09-09). Fixed by
// re-anchoring the ceiling to the season's actual current top raw value on
// every reprice run instead (scripts/reprice-fantasy-players.ts computes
// this across the whole pool via computeRawFantasyValue below and passes
// it into computeFantasyPrice as `ceiling`) — the constant here is now
// only a *floor* on that dynamic value, kept at the original Vezenkov
// calibration so a thin early-season sample can't collapse the whole price
// curve just because nobody has matched his real level yet; the ceiling
// can only ever move up from here, never down, rewarding someone who
// genuinely overtakes it.
export const FANTASY_PIR_CEILING_FLOOR = 22;

// (raw/ceiling)^k before scaling into [MIN_PRICE, MAX_PRICE] — k=1 (a
// straight line) was the formula from 2026-09-06 until this pass.
// Calibrated 2026-09-19 against the same 335-player live export
// FANTASY_NO_DATA_PRICE's comment describes: bucketing the 206 matched
// players with real PIR data by raw value showed the *linear* formula
// (k=1) systematically overpricing the bottom half of the pool — 70% of
// its misses in the raw<10 range were "priced too high," vs. a roughly
// even split above raw=10 — real EuroLeague Fantasy compresses bench-tier
// prices more tightly toward the floor than a straight line does. A sweep
// of k from 1.0 to 2.0 against that same real-price data found 1.1-1.2 as
// the actual minimum-error range (mean abs error 1.23 -> 1.13 credits,
// RMSE 1.60 -> 1.53); error gets worse quickly past ~1.3, so this is a
// mild, data-fitted correction, not a guess at a dramatically different
// curve shape. k has no effect at raw=0 (still floors at MIN_PRICE) or
// raw=ceiling (still exactly MAX_PRICE, ratio=1 regardless of exponent) —
// only points in between shift, toward the floor.
export const FANTASY_PRICE_CURVE_EXPONENT = 1.15;

export interface FantasyPriceInput {
  recentAvgPIR: number | null;
  recentAvgMinutes: number | null;
  recentGameCount: number;
  seasonPIR: number | null;
  seasonMinutesPerGame: number | null;
}

/**
 * The pre-scale "raw" value computeFantasyPrice would otherwise scale
 * straight to a credit price — recent-form/season-baseline blend, with the
 * low-minutes dampen applied. Pulled out on its own so
 * scripts/reprice-fantasy-players.ts can find the pool's actual maximum
 * (the dynamic ceiling's re-anchor point) without duplicating this blend
 * logic. Returns null for a player with no usable PIR at all yet (no games
 * played this season or any prior one — a true rookie/new signing).
 */
export function computeRawFantasyValue(input: FantasyPriceInput): number | null {
  const hasRecentForm = input.recentGameCount >= MIN_RECENT_GAMES && input.recentAvgPIR !== null;

  const blendedPIR = hasRecentForm
    ? RECENT_FORM_WEIGHT * input.recentAvgPIR! + (1 - RECENT_FORM_WEIGHT) * (input.seasonPIR ?? input.recentAvgPIR!)
    : input.seasonPIR ?? input.recentAvgPIR;

  if (blendedPIR === null || blendedPIR === undefined) return null;

  const effectiveMinutes = hasRecentForm ? input.recentAvgMinutes : input.seasonMinutesPerGame;
  return effectiveMinutes !== null && effectiveMinutes < LOW_MINUTES_THRESHOLD ? blendedPIR * LOW_MINUTES_DAMPEN : blendedPIR;
}

/**
 * See the formula comment above this file's constants. `ceiling` is the
 * dynamic re-anchor point (defaults to the original fixed calibration,
 * FANTASY_PIR_CEILING_FLOOR, for any caller that doesn't pass one — e.g. a
 * one-off/test call with no whole-pool context to compute a real ceiling
 * from). Returns FANTASY_NO_DATA_PRICE for a player with no usable PIR at all.
 */
export function computeFantasyPrice(input: FantasyPriceInput, ceiling: number = FANTASY_PIR_CEILING_FLOOR): number {
  const raw = computeRawFantasyValue(input);
  if (raw === null) return FANTASY_NO_DATA_PRICE;

  // Math.max(0, raw) before the exponent — a fractional power of a
  // negative base is NaN in JS, and a single bad recent stretch can
  // legitimately push the recent-form/season blend below 0. Clamping to 0
  // here is harmless either way, since the final Math.max(MIN_PRICE, ...)
  // below would floor a negative result to MIN_PRICE regardless.
  const ratio = Math.max(0, raw) / ceiling;
  const scaled = FANTASY_MIN_PRICE + ratio ** FANTASY_PRICE_CURVE_EXPONENT * (FANTASY_MAX_PRICE - FANTASY_MIN_PRICE);
  // Rounded to the nearest 0.1 credit, not a whole number (2026-09-06) —
  // two players a fraction of a PIR point apart used to collapse onto the
  // same integer price; the tenth-credit precision differentiates them
  // without needing a wider [MIN_PRICE, MAX_PRICE] range. See the matching
  // `real` column type on player_fantasy_prices/coach_fantasy_prices in
  // schema.ts (was `integer`) and the price formatting in fantasy.html.
  return Math.min(FANTASY_MAX_PRICE, Math.max(FANTASY_MIN_PRICE, Math.round(scaled * 10) / 10));
}

/**
 * The budget cap for a season — always the flat FANTASY_BUDGET_CAP for
 * every user (2026-09-17, reverted the same day it was reported: a fresh
 * account was showing 100.5cr instead of a plain 100). This used to scale
 * with fantasy_pricing_state.ceiling (the same dynamic ceiling
 * computeFantasyPrice's own price scaling still uses), on the reasoning
 * that rising prices should grow the budget to match — but that meant
 * *every* user's cap silently drifted off 100 the moment the ceiling
 * moved at all, including a brand-new account that had never played a
 * game, which read as a bug rather than a feature. Kept as an async
 * function (not a bare constant) so routes/fantasy.ts's existing
 * `await getBudgetCap(season)` call sites don't need to change.
 */
export async function getBudgetCap(_season: string): Promise<number> {
  return FANTASY_BUDGET_CAP;
}

// --- Live per-game player scoring (2026-09-16) ---
//
// Replaces the earlier PIR-as-fantasy-score shortcut with EuroLeague
// Fantasy's own actual per-stat formula (read directly off their rules
// site): +1/point, +1/rebound, +1/assist, +1 steal, -1 turnover, +1
// block-for, -1 block-against, +1 foul drawn, -1 foul committed, -1 missed
// field goal, -1 missed free throw — then a +10% bonus on that line if the
// player's own team won the game. Applied per player per game (not once
// per fantasy manager's whole round) since it's evaluated inside the same
// per-player join every other scoring path already uses; PIR wasn't a bad
// proxy (both roughly reward the same good performances) but it's not
// what the real game actually uses, and a "wait why doesn't this match
// the real number I'd expect" report was only a matter of time.
export interface FantasyGameBoxScore {
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  turnovers: number | null;
  blocksFavour: number | null;
  blocksAgainst: number | null;
  foulsCommitted: number | null;
  foulsReceived: number | null;
  fieldGoalsMade2: number | null;
  fieldGoalsAttempted2: number | null;
  fieldGoalsMade3: number | null;
  fieldGoalsAttempted3: number | null;
  freeThrowsMade: number | null;
  freeThrowsAttempted: number | null;
}
export const FANTASY_TEAM_WIN_BONUS = 0.1;

export function computeFantasyGamePoints(stats: FantasyGameBoxScore, teamWon: boolean): number {
  const n = (v: number | null) => v ?? 0;
  const missedFieldGoals =
    n(stats.fieldGoalsAttempted2) - n(stats.fieldGoalsMade2) + (n(stats.fieldGoalsAttempted3) - n(stats.fieldGoalsMade3));
  const missedFreeThrows = n(stats.freeThrowsAttempted) - n(stats.freeThrowsMade);
  const base =
    n(stats.points) +
    n(stats.rebounds) +
    n(stats.assists) +
    n(stats.steals) -
    n(stats.turnovers) +
    n(stats.blocksFavour) -
    n(stats.blocksAgainst) +
    n(stats.foulsReceived) -
    n(stats.foulsCommitted) -
    missedFieldGoals -
    missedFreeThrows;
  return teamWon ? base * (1 + FANTASY_TEAM_WIN_BONUS) : base;
}

// --- Coach pricing + scoring ---
//
// No coach-specific stat is synced anywhere (coaches aren't in `players`),
// so there's nothing like PIR to price them off. Real standings position
// is the best available proxy for "how good is this team, and therefore
// how many wins will its coach's fantasy points rack up" — team_season_stats
// .position, falling back to the most recent prior season with a row for
// that team the same way computeFantasyPrice falls back for a player (see
// the reprice script). Linearly interpolated across the whole standings
// table rather than banded, so 20 teams spread smoothly across the price
// range instead of clustering at a few values.
// Recalibrated 2026-09-20 against a real 20-coach EuroLeague Fantasy price
// export (players_stats.xlsx's "Head Coach" rows) — the old 4-16 range was
// never validated against real data and was badly off (real quotations run
// exactly 5-10: Obradovic/Bartzokas top out at 10, four coaches sit at the
// 5 floor). Real coach prices are also now written directly per-team by
// scripts/import-real-coach-fantasy-prices.ts (every one of the 20 current
// teams matched, unlike the player import's partial match rate) — this
// range only matters for a *future* reprice run with no fresh export to
// import, so a team's price stays in the right neighborhood instead of
// drifting back toward the old, wrong 4-16 spread.
export const COACH_MIN_PRICE = 5;
export const COACH_MAX_PRICE = 10;

export function computeCoachPrice(position: number | null, totalTeams: number): number {
  if (position === null || totalTeams <= 1) return COACH_MIN_PRICE;
  const clampedPosition = Math.min(Math.max(position, 1), totalTeams);
  const raw = COACH_MAX_PRICE - ((clampedPosition - 1) * (COACH_MAX_PRICE - COACH_MIN_PRICE)) / (totalTeams - 1);
  // Same tenth-credit rounding as computeFantasyPrice above, for the same
  // reason — a linear interpolation across 20-ish standings positions
  // otherwise collapses several adjacent teams onto the same integer price.
  return Math.min(COACH_MAX_PRICE, Math.max(COACH_MIN_PRICE, Math.round(raw * 10) / 10));
}

// A coach scores off their real team's game result and its margin, not a
// stat line — corrected 2026-09-16 against EuroLeague Fantasy's own
// published rules (was flat +20/0, which turned out to not match): win by
// 0-10 (or in OT) = +10, win by 11-20 = +20, win by 21+ = +25; loss by
// 0-10 (or in OT) = -5, loss by 11-20 = -10, loss by 21+ = -20. `games`
// doesn't track overtime at all (see schema.ts's comment on `quarter`), so
// an OT win/loss is scored purely by its final margin like any other game
// — a real simplification, but a mild one in practice, since an OT game's
// final margin is almost always small anyway (it was tied at the end of
// regulation). No game that round (bye) or the game not final yet both
// correctly resolve to 0 via the SQL in getFantasyLeaderboardEntries below
// (coalesce onto a missing/non-final row).
export const COACH_MARGIN_CLOSE = 10; // inclusive upper bound of the "close" tier
export const COACH_MARGIN_MID = 20; // inclusive upper bound of the "mid" tier; above this is a blowout
export const COACH_WIN_CLOSE_POINTS = 10;
export const COACH_WIN_MID_POINTS = 20;
export const COACH_WIN_BLOWOUT_POINTS = 25;
export const COACH_LOSS_CLOSE_POINTS = -5;
export const COACH_LOSS_MID_POINTS = -10;
export const COACH_LOSS_BLOWOUT_POINTS = -20;

/** JS equivalent of the SQL CASE in getFantasyLeaderboardEntries below — used
 * by routes/fantasy.ts's single-round lineup computation, which already has
 * the game row in hand and doesn't need a second query for it. */
export function pointsForCoachResult(scoreFor: number, scoreAgainst: number): number {
  const margin = Math.abs(scoreFor - scoreAgainst);
  const won = scoreFor > scoreAgainst;
  if (won) {
    if (margin <= COACH_MARGIN_CLOSE) return COACH_WIN_CLOSE_POINTS;
    if (margin <= COACH_MARGIN_MID) return COACH_WIN_MID_POINTS;
    return COACH_WIN_BLOWOUT_POINTS;
  }
  if (margin <= COACH_MARGIN_CLOSE) return COACH_LOSS_CLOSE_POINTS;
  if (margin <= COACH_MARGIN_MID) return COACH_LOSS_MID_POINTS;
  return COACH_LOSS_BLOWOUT_POINTS;
}

// Fantasy Five's own points (2026-09-16, see fantasyRoundPoints' doc
// comment in schema.ts for the full context) feed the shared points
// economy at this fraction of a completed round's real totalPoints —
// picked to land in roughly the same order of magnitude a good round of
// win/loss predictions earns (10-40/correct pick), not a guess at exact
// parity. Floored to a whole point; tune this constant (and re-run
// economy:simulate once it models fantasy, which it doesn't yet) if real
// play shows the economy skewing too hard toward fantasy or barely moved
// by it at all.
export const FANTASY_POINTS_CONVERSION_RATE = 0.5;

/**
 * Grants `Math.floor(totalPoints * FANTASY_POINTS_CONVERSION_RATE)` points
 * into the shared economy for one user's one completed fantasy round —
 * call only once that round's `roundComplete` is true (see routes/
 * fantasy.ts), since totalPoints for a still-live round keeps changing as
 * games progress. Claim-first via fantasyRoundPoints' unique index: a
 * conflict means this round was already granted, so this is safe to call
 * on every read of a completed round (same pattern as
 * checkAndGrantRoundRewards), not just once — returns the newly-inserted
 * row (for a "+N points" banner) or null if already claimed / the round
 * scored zero-or-negative. A bad fantasy round or a coach blowout loss
 * never *deducts* from the shared economy — this is a bonus channel only.
 */
export async function checkAndGrantFantasyRoundPoints(
  userId: string,
  season: string,
  round: number,
  totalPoints: number
): Promise<{ id: string; round: number; points: number } | null> {
  const points = Math.floor(totalPoints * FANTASY_POINTS_CONVERSION_RATE);
  if (points <= 0) return null;

  const [claimed] = await db
    .insert(fantasyRoundPoints)
    .values({ userId, season, round, points })
    .onConflictDoNothing()
    .returning({ id: fantasyRoundPoints.id });
  if (claimed) {
    await db.insert(pointAdjustments).values({
      userId,
      points,
      reason: `Fantasy Five — Round ${round}`,
      createdByUserId: userId,
    });
  }

  // Read back this round's row regardless of whether *this* call was the
  // one that inserted it — a second, unrelated page load hitting this same
  // still-unseen round shouldn't silently "eat" the banner the way a naive
  // insert-returning-only check would (same race roundRewards.seenAt
  // guards against, see its own doc comment).
  const [row] = await db
    .select({ id: fantasyRoundPoints.id, round: fantasyRoundPoints.round, points: fantasyRoundPoints.points })
    .from(fantasyRoundPoints)
    .where(
      and(
        eq(fantasyRoundPoints.userId, userId),
        eq(fantasyRoundPoints.season, season),
        eq(fantasyRoundPoints.round, round),
        isNull(fantasyRoundPoints.seenAt)
      )
    );
  return row ?? null;
}

/** Same pattern as markRoundRewardsSeen (services/cards.ts) — marks every
 * currently-unseen fantasy-points grant as seen once the frontend's shown
 * its banner for it. */
export async function markFantasyRoundPointsSeen(userId: string): Promise<void> {
  await db
    .update(fantasyRoundPoints)
    .set({ seenAt: new Date() })
    .where(and(eq(fantasyRoundPoints.userId, userId), isNull(fantasyRoundPoints.seenAt)));
}

/**
 * A round locks the moment its first game tips off — the whole round, not
 * per-game, same "whole gameweek locks at the first game" rule real fantasy
 * apps use. Governs the coach pick (real rules don't give the coach its own
 * per-player turn window) and is the lineup builder's default "which round
 * am I drafting for" boundary. Null if the round doesn't exist (no games)
 * for that season.
 */
export async function getRoundLockTime(season: string, round: number): Promise<Date | null> {
  const [row] = await db
    .select({ tipoffAt: games.tipoffAt })
    .from(games)
    .where(and(eq(games.season, season), eq(games.round, round)))
    .orderBy(asc(games.tipoffAt))
    .limit(1);
  return row ? new Date(row.tipoffAt) : null;
}


/**
 * The round the lineup builder should default to: the first round that
 * isn't entirely final yet, falling back to the last round once the whole
 * season is done — exact same rule GET /games/schedule already uses to pick
 * a default round, reused here so "which round am I drafting for" agrees
 * with "which round does the schedule page show" without a second concept.
 */
export async function getDefaultRound(season: string): Promise<number | null> {
  const rows = await db
    .select({ round: games.round, status: games.status })
    .from(games)
    .where(and(eq(games.season, season), isNotNull(games.round)));

  const byRound = new Map<number, string[]>();
  for (const r of rows) {
    const arr = byRound.get(r.round!) ?? [];
    arr.push(r.status);
    byRound.set(r.round!, arr);
  }
  const sortedRounds = [...byRound.keys()].sort((a, b) => a - b);
  if (sortedRounds.length === 0) return null;
  return sortedRounds.find((rnd) => byRound.get(rnd)!.some((s) => s !== "final")) ?? sortedRounds[sortedRounds.length - 1];
}

export interface FantasyBaselineSquad {
  playerIds: Set<string>;
  rows: { playerId: string; slotRole: string; isCaptain: boolean }[];
  coachTeamId: string | null;
}

/**
 * The "transfer baseline" for a round: the user's saved squad + coach from
 * the round immediately before it. Used two ways in routes/fantasy.ts —
 * GET /lineup seeds a never-touched current round from it (so a squad
 * carries forward instead of starting empty every round), and POST
 * /lineup/batch limits how many *players* may differ from it
 * (FANTASY_TRANSFERS_PER_ROUND) when saving. Null for round 1 (nothing
 * before it) or when the user has no saved squad for that prior round
 * either (missed a round, or this is their first round playing) — both
 * fall back to a free, unlimited draft, same as round 1 always has been.
 */
export async function getBaselineSquad(userId: string, season: string, round: number): Promise<FantasyBaselineSquad | null> {
  if (round <= 1) return null;
  const [lineupRows, coachRows] = await Promise.all([
    db
      .select({ playerId: fantasyLineups.playerId, slotRole: fantasyLineups.slotRole, isCaptain: fantasyLineups.isCaptain })
      .from(fantasyLineups)
      .where(and(eq(fantasyLineups.userId, userId), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round - 1))),
    db
      .select({ teamId: fantasyCoachPicks.teamId })
      .from(fantasyCoachPicks)
      .where(and(eq(fantasyCoachPicks.userId, userId), eq(fantasyCoachPicks.season, season), eq(fantasyCoachPicks.round, round - 1)))
      .limit(1),
  ]);
  if (lineupRows.length === 0) return null;
  return {
    playerIds: new Set(lineupRows.map((r) => r.playerId)),
    rows: lineupRows,
    coachTeamId: coachRows[0]?.teamId ?? null,
  };
}

export const SLOT_ROLES = ["starter", "sixth_man", "bench"] as const;
export type SlotRole = (typeof SLOT_ROLES)[number];

export interface SaveLineupEntry {
  playerId: string;
  slotRole: SlotRole;
  isCaptain?: boolean;
}

export type SaveLineupResult = { ok: true } | { error: string; code?: string; [key: string]: unknown };

// Slot-role counts + the one-starter-captain rule — shared by a normal
// pre-lock save and a mid-round substitution save below.
function validateSquadShape(entries: SaveLineupEntry[]): SaveLineupResult | null {
  if (entries.length !== FANTASY_TOTAL_OUTFIELD) {
    return { error: `Squad must contain exactly ${FANTASY_TOTAL_OUTFIELD} players` };
  }
  const seenIds = new Set<string>();
  for (const e of entries) {
    if (seenIds.has(e.playerId)) return { error: "Duplicate player in squad" };
    seenIds.add(e.playerId);
  }
  const starters = entries.filter((e) => e.slotRole === "starter");
  const sixthMen = entries.filter((e) => e.slotRole === "sixth_man");
  const bench = entries.filter((e) => e.slotRole === "bench");
  if (starters.length !== FANTASY_STARTER_COUNT || sixthMen.length !== FANTASY_SIXTH_MAN_COUNT || bench.length !== FANTASY_BENCH_COUNT) {
    return { error: `Need exactly ${FANTASY_STARTER_COUNT} starters, ${FANTASY_SIXTH_MAN_COUNT} sixth man, ${FANTASY_BENCH_COUNT} bench` };
  }
  const captains = starters.filter((e) => e.isCaptain);
  if (captains.length !== 1 || entries.some((e) => e.isCaptain && e.slotRole !== "starter")) {
    return { error: "Exactly one starter must be captain" };
  }
  return null;
}

/**
 * Mid-round substitutions (2026-09-25, direct request: "since we are on day
 * 2/2 unlock the changes — can change bench players and switch captains").
 * Once a round has tipped off, the squad itself stays frozen — no transfers
 * (exact same 10 players), no coach change, and no new priceAtPick (rows
 * are updated in place, never re-inserted) — but all 10 players can move
 * freely between starter / sixth man / bench (so the formation can change
 * too), and the captaincy can move — but only *to* a starter whose game
 * hasn't tipped off yet (it can leave a played captain). Originally a player whose
 * game had already started stayed fixed; loosened the same day by direct
 * request ("all players should be switchable with each other and change
 * formation. Not traded with others that dont exist"). Scoring is computed
 * on read, so moving an already-played player rescores their finished game
 * at the new role. Closes for good once every game in the round has tipped off.
 */
async function saveMidRoundSubstitutions(
  userId: string,
  season: string,
  round: number,
  entries: SaveLineupEntry[],
  coachTeamId: string
): Promise<SaveLineupResult> {
  const [roundGames, existingRows, coachRows] = await Promise.all([
    db
      .select({ homeTeamId: games.homeTeamId, awayTeamId: games.awayTeamId, tipoffAt: games.tipoffAt, status: games.status })
      .from(games)
      .where(and(eq(games.season, season), eq(games.round, round))),
    db
      .select({ id: fantasyLineups.id, playerId: fantasyLineups.playerId, slotRole: fantasyLineups.slotRole, isCaptain: fantasyLineups.isCaptain, teamId: players.teamId })
      .from(fantasyLineups)
      .innerJoin(players, eq(players.id, fantasyLineups.playerId))
      .where(and(eq(fantasyLineups.userId, userId), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round))),
    db
      .select({ teamId: fantasyCoachPicks.teamId })
      .from(fantasyCoachPicks)
      .where(and(eq(fantasyCoachPicks.userId, userId), eq(fantasyCoachPicks.season, season), eq(fantasyCoachPicks.round, round)))
      .limit(1),
  ]);

  const now = Date.now();
  const hasStarted = (g: (typeof roundGames)[number]) => new Date(g.tipoffAt).getTime() <= now || g.status !== "scheduled";
  if (existingRows.length === 0 || roundGames.every(hasStarted)) {
    return { error: "This round has already locked", code: "ROUND_LOCKED" };
  }
  if (coachRows[0]?.teamId !== coachTeamId) {
    return { error: "The coach can't be changed once the round has started", code: "COACH_LOCKED" };
  }
  const existingByPlayerId = new Map(existingRows.map((r) => [r.playerId, r]));
  if (existingRows.length !== entries.length || entries.some((e) => !existingByPlayerId.has(e.playerId))) {
    return { error: "Transfers are closed once the round has started — only substitutions are allowed", code: "TRANSFERS_LOCKED" };
  }

  // The armband can leave a player who already played, but can only be
  // handed to someone whose game hasn't tipped off yet (a day-2 player).
  const newCaptain = entries.find((e) => e.isCaptain);
  const oldCaptain = existingRows.find((r) => r.isCaptain);
  if (newCaptain && newCaptain.playerId !== oldCaptain?.playerId) {
    const startedTeamIds = new Set<string>();
    for (const g of roundGames) {
      if (!hasStarted(g)) continue;
      startedTeamIds.add(g.homeTeamId);
      startedTeamIds.add(g.awayTeamId);
    }
    if (startedTeamIds.has(existingByPlayerId.get(newCaptain.playerId)!.teamId)) {
      return { error: "The captaincy can only move to a player whose game hasn't started yet", code: "CAPTAIN_PLAYED", playerId: newCaptain.playerId };
    }
  }

  const changed: { id: string; slotRole: SlotRole; isCaptain: boolean }[] = [];
  for (const e of entries) {
    const existing = existingByPlayerId.get(e.playerId)!;
    const isCaptain = !!e.isCaptain;
    if (existing.slotRole === e.slotRole && existing.isCaptain === isCaptain) continue;
    changed.push({ id: existing.id, slotRole: e.slotRole, isCaptain });
  }

  if (changed.length > 0) {
    await db.transaction(async (tx) => {
      for (const c of changed) {
        await tx.update(fantasyLineups).set({ slotRole: c.slotRole, isCaptain: c.isCaptain }).where(eq(fantasyLineups.id, c.id));
      }
    });
  }
  return { ok: true };
}

/**
 * The actual domain validation + write behind POST /fantasy/lineup/batch —
 * extracted (2026-09-17) so autoFillFantasySquad below can produce a real,
 * fully-valid saved squad by calling the exact same rules a real user's
 * save goes through, rather than a special-cased shortcut that could drift
 * from them. The route still does its own request-shape parsing (types,
 * uuid format, slotRole enum) before calling this — everything from "is
 * this a legal squad" onward (round lock, exact slot-role counts, the
 * position/club quotas, transfer limit, budget) lives here instead.
 */
export async function saveFantasyLineup(
  userId: string,
  season: string,
  round: number,
  entries: SaveLineupEntry[],
  coachTeamId: string
): Promise<SaveLineupResult> {
  const roundLockAt = await getRoundLockTime(season, round);
  if (roundLockAt === null) {
    return { error: "Unknown round", code: "ROUND_NOT_FOUND" };
  }
  const shapeError = validateSquadShape(entries);
  if (shapeError) return shapeError;
  if (roundLockAt.getTime() <= Date.now()) {
    return saveMidRoundSubstitutions(userId, season, round, entries, coachTeamId);
  }

  const newIds = entries.map((e) => e.playerId);
  const playerRows = await db
    .select({ id: players.id, teamId: players.teamId, position: players.position })
    .from(players)
    .where(inArray(players.id, newIds));
  const playerById = new Map(playerRows.map((p) => [p.id, p]));

  const posCounts: Record<string, number> = { Guard: 0, Forward: 0, Center: 0 };
  for (const id of newIds) {
    const p = playerById.get(id);
    if (!p) return { error: "Unknown player in squad" };
    if (p.position && p.position in posCounts) posCounts[p.position]++;
  }
  for (const [position, quota] of Object.entries(FANTASY_POSITION_QUOTA)) {
    if (posCounts[position] !== quota) {
      return { error: `Need exactly ${quota} ${position}s, got ${posCounts[position] ?? 0}`, code: "POSITION_QUOTA" };
    }
  }

  const countByTeamId = new Map<string, number>();
  for (const id of newIds) {
    const teamId = playerById.get(id)!.teamId;
    countByTeamId.set(teamId, (countByTeamId.get(teamId) ?? 0) + 1);
  }
  for (const [teamId, count] of countByTeamId) {
    if (count > FANTASY_MAX_PLAYERS_PER_CLUB) {
      return { error: `At most ${FANTASY_MAX_PLAYERS_PER_CLUB} players from the same club are allowed`, code: "CLUB_LIMIT_EXCEEDED", teamId, count };
    }
  }

  const baseline = await getBaselineSquad(userId, season, round);
  if (baseline && !isUnlimitedTransferRound(round)) {
    const transfersUsed = newIds.filter((id) => !baseline.playerIds.has(id)).length;
    if (transfersUsed > FANTASY_TRANSFERS_PER_ROUND) {
      return {
        error: `Too many changes — up to ${FANTASY_TRANSFERS_PER_ROUND} player changes are allowed per round`,
        code: "TRANSFERS_EXCEEDED",
        transfersUsed,
        transfersAllowed: FANTASY_TRANSFERS_PER_ROUND,
      };
    }
  }

  const [priceRows, coachPriceRows] = await Promise.all([
    db
      .select({ playerId: playerFantasyPrices.playerId, price: playerFantasyPrices.price })
      .from(playerFantasyPrices)
      .where(and(eq(playerFantasyPrices.season, season), inArray(playerFantasyPrices.playerId, newIds))),
    db
      .select({ price: coachFantasyPrices.price })
      .from(coachFantasyPrices)
      .where(and(eq(coachFantasyPrices.teamId, coachTeamId), eq(coachFantasyPrices.season, season)))
      .limit(1),
  ]);
  const priceByPlayerId = new Map(priceRows.map((r) => [r.playerId, r.price]));
  const playersCost = newIds.reduce((sum, id) => sum + (priceByPlayerId.get(id) ?? FANTASY_MIN_PRICE), 0);
  const coachCost = coachPriceRows[0]?.price ?? COACH_MIN_PRICE;
  const totalCost = Math.round((playersCost + coachCost) * 10) / 10;
  const budgetCap = await getBudgetCap(season);
  if (totalCost > budgetCap) {
    return { error: `Squad costs ${totalCost}, over the ${budgetCap}-credit budget`, code: "OVER_BUDGET" };
  }

  await db.transaction(async (tx) => {
    await tx.delete(fantasyLineups).where(and(eq(fantasyLineups.userId, userId), eq(fantasyLineups.season, season), eq(fantasyLineups.round, round)));
    await tx.insert(fantasyLineups).values(
      entries.map((e) => ({
        userId,
        season,
        round,
        playerId: e.playerId,
        slotRole: e.slotRole,
        isCaptain: !!e.isCaptain,
        priceAtPick: priceByPlayerId.get(e.playerId) ?? FANTASY_MIN_PRICE,
      }))
    );
    await tx
      .insert(fantasyCoachPicks)
      .values({ userId, season, round, teamId: coachTeamId, priceAtPick: coachCost })
      .onConflictDoUpdate({
        target: [fantasyCoachPicks.userId, fantasyCoachPicks.season, fantasyCoachPicks.round],
        set: { teamId: coachTeamId, priceAtPick: coachCost },
      });
  });

  return { ok: true };
}

function shuffle<T>(list: T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const TARGET_SPEND_MIN_RATIO = 0.9;
const TARGET_SPEND_MAX_RATIO = 0.98;
// How many of the closest-to-target-price candidates to randomize among
// per pick — keeps the result a genuine randomize (not always the single
// closest price) while still tightly biased toward the target.
const TARGET_SPEND_CANDIDATE_BAND = 3;

/**
 * Admin-only test tool (flagged in CLAUDE.md 2026-09-17, not started until
 * now): instantly assembles a real, budget-respecting random squad for a
 * user instead of hand-picking one in the roster builder every time a test
 * account needs one — reason (1) from that TODO. Reason (2), exercising
 * Fantasy scoring against real-shaped data without waiting for real rounds,
 * turned out to already be covered: Fantasy points are read straight off
 * `games`/`player_game_stats` (see GET /fantasy/lineup), the exact tables
 * POST /api/events/simulate/round already fabricates finals into — so the
 * missing piece was only ever this auto-draft, not a second simulator.
 *
 * Spends toward a real squad, not just "whatever fits": picking purely at
 * random per slot (the original version) could land anywhere from a
 * bare-minimum-price squad to a maxed-out one with no consistency, which
 * read as a worse test fixture than a real manually-built squad usually is
 * (direct request, 2026-09-17: "randomize should be around 90-98cr"). Each
 * pick is instead chosen by TARGET_SPEND_MIN_RATIO..TARGET_SPEND_MAX_RATIO
 * of the budget cap, spread evenly over however many picks (outfield slots
 * + coach) remain, and drawn randomly from the few candidates closest to
 * that per-pick target price rather than the single closest — keeps it a
 * genuine randomize, just biased toward spending most of the budget instead
 * of any amount. This is a soft target, not a guarantee (explicitly
 * accepted: "if it's difficult, it's fine") — a thin synced pool can still
 * miss the range, same as the original cheapest-first budget fallback
 * below can still kick in on a very sparse roster.
 *
 * Reserves COACH_MIN_PRICE of the budget for the coach up front, then fills
 * each position bucket, taking ones that fit both the remaining player
 * budget and the FANTASY_MAX_PLAYERS_PER_CLUB limit — falling back to a
 * plain cheapest-first pass (club limit still enforced, budget constraint
 * dropped) if a position's pool is too thin/expensive for the targeted
 * pass to fill its quota, since the real budget cap is generous enough
 * (comfortably clears 10 * FANTASY_MIN_PRICE + COACH_MIN_PRICE) that this
 * should only ever bite on a very sparse synced roster. Delegates the
 * actual write to saveFantasyLineup, so an auto-filled squad is never a
 * special-cased shortcut — it passes the exact same rules a real save does.
 */
export async function autoFillFantasySquad(userId: string, season: string, round: number): Promise<SaveLineupResult> {
  const budgetCap = await getBudgetCap(season);
  const playerBudget = Math.max(0, budgetCap - COACH_MIN_PRICE);

  const [playerRows, coachRows, baseline] = await Promise.all([
    db
      .select({ id: players.id, position: players.position, teamId: players.teamId, price: playerFantasyPrices.price })
      .from(players)
      .leftJoin(playerFantasyPrices, and(eq(playerFantasyPrices.playerId, players.id), eq(playerFantasyPrices.season, season)))
      .where(eq(players.active, true)),
    db
      .select({ teamId: coachFantasyPrices.teamId, price: coachFantasyPrices.price })
      .from(coachFantasyPrices)
      .where(eq(coachFantasyPrices.season, season)),
    getBaselineSquad(userId, season, round),
  ]);

  type Candidate = { id: string; teamId: string; position: string; price: number };
  const allById = new Map<string, Candidate>();
  const byPosition = new Map<string, Candidate[]>();
  for (const p of playerRows) {
    if (!p.position || !(p.position in FANTASY_POSITION_QUOTA)) continue;
    const c: Candidate = { id: p.id, teamId: p.teamId, position: p.position, price: p.price ?? FANTASY_MIN_PRICE };
    allById.set(c.id, c);
    const list = byPosition.get(p.position) ?? [];
    list.push(c);
    byPosition.set(p.position, list);
  }

  // Respect the same transfer limit a manual save would (FANTASY_TRANSFERS_PER_ROUND,
  // see saveFantasyLineup) — a fully random redraft every round would almost
  // always exceed it once a baseline exists (round > 1, not an unlimited-
  // transfer round), and got caught live doing exactly that (2026-09-17):
  // round 2 carried round 1's squad forward, and a from-scratch auto-fill
  // tried to change all 10 players against a 4-player cap. Keeps a random
  // subset of the baseline squad up to that cap and only redrafts the rest.
  const unlimitedTransfers = isUnlimitedTransferRound(round);
  const maxNewPlayers = !baseline || unlimitedTransfers ? FANTASY_TOTAL_OUTFIELD : FANTASY_TRANSFERS_PER_ROUND;
  const keepCount = Math.max(0, FANTASY_TOTAL_OUTFIELD - maxNewPlayers);

  const picked: Candidate[] = [];
  const pickedIds = new Set<string>();
  const clubCount = new Map<string, number>();
  let spent = 0;

  if (baseline && keepCount > 0) {
    const keepFrom = shuffle([...baseline.playerIds]).slice(0, keepCount);
    for (const id of keepFrom) {
      const c = allById.get(id);
      if (!c) continue; // no longer an active/priced player — treat as a forced change below
      picked.push(c);
      pickedIds.add(c.id);
      clubCount.set(c.teamId, (clubCount.get(c.teamId) ?? 0) + 1);
      spent += c.price;
    }
  }

  // Rolled once per call, not per pick — a stable target for the whole
  // squad, same as a real budget-conscious drafter would set for
  // themselves rather than re-deciding "how much to spend" every slot.
  const targetSpend = budgetCap * (TARGET_SPEND_MIN_RATIO + Math.random() * (TARGET_SPEND_MAX_RATIO - TARGET_SPEND_MIN_RATIO));
  // Coach isn't drafted until every player slot is filled (below), but its
  // typical price still needs to count against the target *now* — else the
  // player-picking pass would spend as if the whole target were available
  // for players alone, then have nothing left for a coach anywhere near
  // that same target.
  const assumedCoachPrice = (COACH_MIN_PRICE + COACH_MAX_PRICE) / 2;
  const playerTargetSpend = Math.max(0, Math.min(playerBudget, targetSpend - assumedCoachPrice));

  function tryPick(pool: Candidate[], enforceBudget: boolean): Candidate | null {
    for (const c of pool) {
      if (pickedIds.has(c.id)) continue;
      const club = clubCount.get(c.teamId) ?? 0;
      if (club >= FANTASY_MAX_PLAYERS_PER_CLUB) continue;
      if (enforceBudget && spent + c.price > playerBudget) continue;
      return c;
    }
    return null;
  }

  // Randomizes among the few remaining-budget-respecting candidates whose
  // price sits closest to `targetPrice`, rather than either a uniformly
  // random pick (the original version — see this function's doc comment
  // for why that read as inconsistent) or the single closest-priced one
  // (no randomness left at all).
  function tryPickTargeted(pool: Candidate[], targetPrice: number): Candidate | null {
    const eligible = pool.filter((c) => {
      if (pickedIds.has(c.id)) return false;
      const club = clubCount.get(c.teamId) ?? 0;
      if (club >= FANTASY_MAX_PLAYERS_PER_CLUB) return false;
      return spent + c.price <= playerBudget;
    });
    if (eligible.length === 0) return null;
    const closest = [...eligible].sort((a, b) => Math.abs(a.price - targetPrice) - Math.abs(b.price - targetPrice));
    const band = closest.slice(0, Math.min(TARGET_SPEND_CANDIDATE_BAND, closest.length));
    return band[Math.floor(Math.random() * band.length)];
  }

  for (const [position, quota] of Object.entries(FANTASY_POSITION_QUOTA)) {
    const already = picked.filter((c) => c.position === position).length;
    const need = quota - already;
    if (need <= 0) continue;
    const pool = byPosition.get(position) ?? [];
    const cheapestFirst = [...pool].sort((a, b) => a.price - b.price);
    let filled = 0;
    while (filled < need) {
      // +1 for this pick itself — picksRemaining is "how many outfield
      // slots, including the one about to be filled, are still open".
      const picksRemaining = FANTASY_TOTAL_OUTFIELD - picked.length;
      const perPickTarget = Math.max(FANTASY_MIN_PRICE, (playerTargetSpend - spent) / picksRemaining);
      let choice = tryPickTargeted(pool, perPickTarget);
      if (!choice) choice = tryPick(cheapestFirst, false);
      if (!choice) {
        return { error: `Not enough eligible ${position}s synced to auto-fill a squad` };
      }
      picked.push(choice);
      pickedIds.add(choice.id);
      clubCount.set(choice.teamId, (clubCount.get(choice.teamId) ?? 0) + 1);
      spent += choice.price;
      filled++;
    }
  }

  // Same closest-to-target randomization as the player picks above — the
  // remaining room to `targetSpend` after however much the players ended
  // up actually costing (not the earlier `assumedCoachPrice` estimate).
  const coachTarget = Math.max(COACH_MIN_PRICE, targetSpend - spent);
  const affordableCoaches = coachRows.filter((c) => c.price <= budgetCap - spent);
  const coachByCloseness = [...affordableCoaches].sort((a, b) => Math.abs(a.price - coachTarget) - Math.abs(b.price - coachTarget));
  const coachBand = coachByCloseness.slice(0, Math.min(TARGET_SPEND_CANDIDATE_BAND, coachByCloseness.length));
  const coach = coachBand.length > 0 ? coachBand[Math.floor(Math.random() * coachBand.length)] : [...coachRows].sort((a, b) => a.price - b.price)[0];
  if (!coach) {
    return { error: "No coaches priced for this season yet — run fantasy:reprice first" };
  }

  // Real bug caught live (2026-09-18, direct report: "randomize places
  // wrong positions... placed guard on center") — this used to shuffle all
  // 10 picked players together and take the first 5 as "starter" with no
  // regard for position at all. saveFantasyLineup/the DB only ever track a
  // player's slotRole ("starter"/"sixth_man"/"bench"), never which of the
  // 5 on-court slots a starter occupies — that's a frontend-only concept
  // (fantasy.ts's FORMATION_POSITIONS) reconciled after load by matching
  // the 5 starters' own position counts against one of the app's 5 known
  // formations (2-2-1/2-1-2/3-1-1/1-2-2/1-3-1). A random 5-of-10 split only
  // has 2 Centers to draw from at all, so it frequently produced a starter
  // group with 0 Centers (or 2 Guards short, etc.) that matches *none* of
  // those 5 shapes — reconcileStarterFormation() then has nothing to
  // reconcile against and silently leaves the raw, position-blind slot
  // order on screen, which is how a Guard ended up rendered in the court's
  // Center slot. Fixed by picking a random one of those same 5 formation
  // shapes here first, then drawing exactly that many Guards/Forwards/
  // Centers (randomly, from within the 4/4/2 already drafted) as starters
  // — guaranteeing the 5 starters always match a real formation, the same
  // guarantee a manual save's own formation picker gives for free.
  const formationVector = FANTASY_FORMATION_VECTORS[Math.floor(Math.random() * FANTASY_FORMATION_VECTORS.length)];
  const pickedByPosition: Record<string, Candidate[]> = { Guard: [], Forward: [], Center: [] };
  for (const c of picked) pickedByPosition[c.position].push(c);

  const starters: Candidate[] = [];
  const rest: Candidate[] = [];
  for (const [position, count] of Object.entries(formationVector)) {
    const shuffledPos = shuffle(pickedByPosition[position]);
    starters.push(...shuffledPos.slice(0, count));
    rest.push(...shuffledPos.slice(count));
  }

  const shuffledStarters = shuffle(starters);
  const shuffledRest = shuffle(rest);
  const entries: SaveLineupEntry[] = [...shuffledStarters, ...shuffledRest].map((c, i) => ({
    playerId: c.id,
    slotRole: i < FANTASY_STARTER_COUNT ? "starter" : i < FANTASY_STARTER_COUNT + FANTASY_SIXTH_MAN_COUNT ? "sixth_man" : "bench",
    isCaptain: i === 0,
  }));

  return saveFantasyLineup(userId, season, round, entries, coach.teamId);
}

export interface FantasySquadPreviewPlayer {
  playerId: string;
  name: string;
  photoUrl: string | null;
  position: string | null;
  teamCode: string;
  teamPrimaryColor: string | null;
  slotRole: string;
  isCaptain: boolean;
  pir: number | null;
}

export interface FantasySquadPreviewCoach {
  teamId: string;
  teamCode: string;
  teamName: string;
  teamLogoUrl: string | null;
  teamPrimaryColor: string | null;
  // The actual person (teams.headCoach, "SURNAME, First" raw off the feed,
  // shown as-is — same convention as GET /fantasy/coaches), not just their
  // team's name. Null until roster_sync.py has captured it for that team.
  headCoach: string | null;
  // The team's coach collectible's own image (collectibles.imageUrl, tier
  // "coach") — a real photo for most teams (16/20 as of this pass), not
  // just a jersey-silhouette placeholder like FantasySquadPreviewPlayer's
  // photoUrl falls back to when null.
  imageUrl: string | null;
}

export interface FantasyLeaderboardEntry {
  userId: string;
  displayName: string;
  fantasyPoints: number;
  // Real per-game valuation (PIR), not the fantasy-points formula — purely
  // informational, same "kept separately" convention GET /fantasy/lineup's
  // own totalPir already established. roundPir is unweighted (no captain
  // double, no bench discount) for the same reason that field isn't either.
  roundPir: number;
  totalPir: number;
  // Null until pirRound's round has actually locked (getRoundLockTime <=
  // now) — revealing a squad before its round starts would let a league
  // member copy another's picks before their own lock. Set by the caller
  // (routes/fantasy.ts, routes/leagues.ts) via revealSquads, not computed
  // from "now" inside this function, so a single request has one consistent
  // answer for every entry.
  squad: FantasySquadPreviewPlayer[] | null;
  coach: FantasySquadPreviewCoach | null;
  // True for every entry this function itself returns (a real
  // fantasy_lineups/fantasy_coach_picks row exists for this season) —
  // routes/leagues.ts sets this false on the zero-point rows it backfills
  // for league members with no fantasy activity at all, so the frontend
  // can tell "never set up a team" apart from "has a team, scored zero so
  // far" instead of both reading as an identical "0 pts" row.
  hasTeam: boolean;
  showcase: {
    id: string;
    name: string;
    tier: string;
    imageUrl: string | null;
    team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
  }[];
}

/**
 * Ranked by cumulative fantasy points for a season: each locked round's
 * picked players' real per-stat fantasy score (computeFantasyGamePoints)
 * for that round's *final* games — captain doubled, bench scored at
 * BENCH_SCORE_MULTIPLIER — plus
 * each round's coach pick's margin-based real-result points (see
 * pointsForCoachResult's doc comment, always 100%, never bench-reduced). A player/coach who
 * hasn't played yet that round (game not final, or a bye) contributes 0 by
 * construction (the left joins below find no matching row), so an
 * in-progress or future round needs no special-casing — same "on-read,
 * degrades gracefully" philosophy as services/points.ts.
 *
 * Same global/league-scoped split as getLeaderboardEntries
 * (services/leaderboard.ts): one unfiltered query, userIds applied in JS.
 * `round` is optional — omit for the season-cumulative board, pass it for a
 * single round's score (e.g. a "this round" dashboard card).
 */
export async function getFantasyLeaderboardEntries(
  options: {
    userIds?: string[];
    season: string;
    round?: number;
    // Which round's raw PIR to surface as roundPir/squad — independent of
    // `round` above (that one scopes fantasyPoints itself, and stays
    // season-cumulative for every real caller today). Defaults to no round
    // PIR/squad data at all when omitted.
    pirRound?: number | null;
    // Only fetches/returns squad+coach when true — see FantasyLeaderboardEntry's
    // doc comment on `squad` for why this is the caller's call, not this
    // function's.
    revealSquads?: boolean;
  }
): Promise<FantasyLeaderboardEntry[]> {
  const roundFilterFl = options.round !== undefined ? sql`and fl.round = ${options.round}` : sql``;
  const roundFilterFcp = options.round !== undefined ? sql`and fcp.round = ${options.round}` : sql``;
  const pirRoundFilter = options.pirRound != null ? sql`and fl.round = ${options.pirRound}` : sql`and false`;

  const totals = await db.execute<{
    user_id: string;
    username: string;
    showcase_collectible_ids: string[];
    fantasy_points: number;
    round_pir: number;
    total_pir: number;
  }>(sql`
    with round_stats as (
      -- Real EuroLeague Fantasy per-stat formula (see
      -- computeFantasyGamePoints's doc comment for the JS equivalent used
      -- by routes/fantasy.ts's single-round detail view) — replaces the
      -- earlier PIR shortcut. p.team_id is the player's *current* team, not
      -- necessarily who they played for in this specific historical game
      -- (a traded player's old games), same simplification already made
      -- elsewhere in this app (e.g. usage% — see CLAUDE.md).
      select pgs.player_id, g.season, g.round,
        (
          coalesce(pgs.points, 0) + coalesce(pgs.rebounds, 0) + coalesce(pgs.assists, 0)
          + coalesce(pgs.steals, 0) - coalesce(pgs.turnovers, 0)
          + coalesce(pgs.blocks_favour, 0) - coalesce(pgs.blocks_against, 0)
          + coalesce(pgs.fouls_received, 0) - coalesce(pgs.fouls_committed, 0)
          - (coalesce(pgs.field_goals_attempted_2, 0) - coalesce(pgs.field_goals_made_2, 0))
          - (coalesce(pgs.field_goals_attempted_3, 0) - coalesce(pgs.field_goals_made_3, 0))
          - (coalesce(pgs.free_throws_attempted, 0) - coalesce(pgs.free_throws_made, 0))
        ) * (case
          when p.team_id = g.home_team_id and g.home_score > g.away_score then ${1 + FANTASY_TEAM_WIN_BONUS}::numeric
          when p.team_id = g.away_team_id and g.away_score > g.home_score then ${1 + FANTASY_TEAM_WIN_BONUS}::numeric
          else 1::numeric
        end) as fantasy_points,
        coalesce(pgs.valuation, 0) as pir
      from player_game_stats pgs
      join games g on g.id = pgs.game_id
      join players p on p.id = pgs.player_id
      where g.status = 'final'
    ),
    player_pir_round_totals as (
      select fl.user_id, sum(coalesce(rs.pir, 0)) as pir
      from fantasy_lineups fl
      left join round_stats rs on rs.player_id = fl.player_id and rs.season = fl.season and rs.round = fl.round
      where fl.season = ${options.season} ${pirRoundFilter}
      group by fl.user_id
    ),
    player_pir_season_totals as (
      select fl.user_id, sum(coalesce(rs.pir, 0)) as pir
      from fantasy_lineups fl
      left join round_stats rs on rs.player_id = fl.player_id and rs.season = fl.season and rs.round = fl.round
      where fl.season = ${options.season}
      group by fl.user_id
    ),
    player_totals as (
      select fl.user_id,
        sum(
          coalesce(rs.fantasy_points, 0)
          * (case when fl.is_captain then 2 else 1 end)
          * (case when fl.slot_role = 'bench' then ${BENCH_SCORE_MULTIPLIER}::numeric else 1 end)
        ) as pts
      from fantasy_lineups fl
      left join round_stats rs on rs.player_id = fl.player_id and rs.season = fl.season and rs.round = fl.round
      where fl.season = ${options.season} ${roundFilterFl}
      group by fl.user_id
    ),
    coach_game_result as (
      select season, round, home_team_id as team_id,
        case
          when status != 'final' then 0
          when home_score > away_score and (home_score - away_score) <= ${COACH_MARGIN_CLOSE} then ${COACH_WIN_CLOSE_POINTS}::int
          when home_score > away_score and (home_score - away_score) <= ${COACH_MARGIN_MID} then ${COACH_WIN_MID_POINTS}::int
          when home_score > away_score then ${COACH_WIN_BLOWOUT_POINTS}::int
          when (away_score - home_score) <= ${COACH_MARGIN_CLOSE} then ${COACH_LOSS_CLOSE_POINTS}::int
          when (away_score - home_score) <= ${COACH_MARGIN_MID} then ${COACH_LOSS_MID_POINTS}::int
          else ${COACH_LOSS_BLOWOUT_POINTS}::int
        end as pts
      from games
      union all
      select season, round, away_team_id as team_id,
        case
          when status != 'final' then 0
          when away_score > home_score and (away_score - home_score) <= ${COACH_MARGIN_CLOSE} then ${COACH_WIN_CLOSE_POINTS}::int
          when away_score > home_score and (away_score - home_score) <= ${COACH_MARGIN_MID} then ${COACH_WIN_MID_POINTS}::int
          when away_score > home_score then ${COACH_WIN_BLOWOUT_POINTS}::int
          when (home_score - away_score) <= ${COACH_MARGIN_CLOSE} then ${COACH_LOSS_CLOSE_POINTS}::int
          when (home_score - away_score) <= ${COACH_MARGIN_MID} then ${COACH_LOSS_MID_POINTS}::int
          else ${COACH_LOSS_BLOWOUT_POINTS}::int
        end as pts
      from games
    ),
    coach_totals as (
      select fcp.user_id, sum(coalesce(cgr.pts, 0)) as pts
      from fantasy_coach_picks fcp
      left join coach_game_result cgr
        on cgr.season = fcp.season and cgr.round = fcp.round and cgr.team_id = fcp.team_id
      where fcp.season = ${options.season} ${roundFilterFcp}
      group by fcp.user_id
    )
    select coalesce(pt.user_id, ct.user_id) as user_id, u.username, u.showcase_collectible_ids,
      (coalesce(pt.pts, 0) + coalesce(ct.pts, 0))::int as fantasy_points,
      coalesce(prt.pir, 0)::int as round_pir,
      coalesce(pst.pir, 0)::int as total_pir
    from player_totals pt
    full outer join coach_totals ct on ct.user_id = pt.user_id
    left join player_pir_round_totals prt on prt.user_id = coalesce(pt.user_id, ct.user_id)
    left join player_pir_season_totals pst on pst.user_id = coalesce(pt.user_id, ct.user_id)
    join ${users} u on u.id = coalesce(pt.user_id, ct.user_id)
    where u.is_admin = false
  `);

  const allowedIds = options.userIds ? new Set(options.userIds) : null;

  const ranked = totals
    .filter((row) => !allowedIds || allowedIds.has(row.user_id))
    .map((row) => ({
      userId: row.user_id,
      displayName: row.username,
      fantasyPoints: row.fantasy_points,
      roundPir: row.round_pir,
      totalPir: row.total_pir,
      showcaseIds: row.showcase_collectible_ids ?? [],
    }))
    .sort((a, b) => b.fantasyPoints - a.fantasyPoints);

  const allShowcaseIds = [...new Set(ranked.flatMap((r) => r.showcaseIds))];
  const cardRows = allShowcaseIds.length
    ? await db
        .select({ collectible: collectibles, team: teams })
        .from(collectibles)
        .innerJoin(teams, eq(collectibles.teamId, teams.id))
        .where(inArray(collectibles.id, allShowcaseIds))
    : [];
  const cardById = new Map(
    cardRows.map(({ collectible, team }) => [
      collectible.id,
      {
        id: collectible.id,
        name: collectible.name,
        tier: collectible.tier,
        imageUrl: collectible.imageUrl,
        team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor, logoUrl: team.logoUrl },
      },
    ])
  );

  const squadByUserId = new Map<string, FantasySquadPreviewPlayer[]>();
  const coachByUserId = new Map<string, FantasySquadPreviewCoach>();
  if (options.revealSquads && options.pirRound != null && ranked.length > 0) {
    const rankedUserIds = ranked.map((r) => r.userId);
    const pirRound = options.pirRound;

    const [squadRows, coachRows, roundGames] = await Promise.all([
      db
        .select({
          userId: fantasyLineups.userId,
          playerId: fantasyLineups.playerId,
          slotRole: fantasyLineups.slotRole,
          isCaptain: fantasyLineups.isCaptain,
          name: players.name,
          position: players.position,
          photoUrl: players.photoUrl,
          teamId: players.teamId,
          teamCode: teams.code,
          teamPrimaryColor: teams.primaryColor,
        })
        .from(fantasyLineups)
        .innerJoin(players, eq(players.id, fantasyLineups.playerId))
        .innerJoin(teams, eq(teams.id, players.teamId))
        .where(
          and(eq(fantasyLineups.season, options.season), eq(fantasyLineups.round, pirRound), inArray(fantasyLineups.userId, rankedUserIds))
        ),
      db
        .select({
          userId: fantasyCoachPicks.userId,
          teamId: fantasyCoachPicks.teamId,
          teamCode: teams.code,
          teamName: teams.name,
          teamLogoUrl: teams.logoUrl,
          teamPrimaryColor: teams.primaryColor,
          headCoach: teams.headCoach,
          imageUrl: collectibles.imageUrl,
        })
        .from(fantasyCoachPicks)
        .innerJoin(teams, eq(teams.id, fantasyCoachPicks.teamId))
        // One coach collectible per team by design — see the matching join
        // in routes/fantasy.ts's GET /coaches for the same reasoning.
        .leftJoin(collectibles, and(eq(collectibles.teamId, teams.id), eq(collectibles.tier, "coach")))
        .where(
          and(eq(fantasyCoachPicks.season, options.season), eq(fantasyCoachPicks.round, pirRound), inArray(fantasyCoachPicks.userId, rankedUserIds))
        ),
      db.select().from(games).where(and(eq(games.season, options.season), eq(games.round, pirRound))),
    ]);

    const gameByTeamId = new Map<string, (typeof roundGames)[number]>();
    for (const g of roundGames) {
      gameByTeamId.set(g.homeTeamId, g);
      gameByTeamId.set(g.awayTeamId, g);
    }
    const squadPlayerIds = [...new Set(squadRows.map((r) => r.playerId))];
    const finalGameIds = roundGames.filter((g) => g.status === "final").map((g) => g.id);
    const statsRows =
      squadPlayerIds.length && finalGameIds.length
        ? await db
            .select({ playerId: playerGameStats.playerId, gameId: playerGameStats.gameId, valuation: playerGameStats.valuation })
            .from(playerGameStats)
            .where(and(inArray(playerGameStats.playerId, squadPlayerIds), inArray(playerGameStats.gameId, finalGameIds)))
        : [];
    const statsByPlayerGame = new Map(statsRows.map((r) => [`${r.playerId}:${r.gameId}`, r.valuation]));

    for (const r of squadRows) {
      const game = gameByTeamId.get(r.teamId);
      const pir = game && game.status === "final" ? statsByPlayerGame.get(`${r.playerId}:${game.id}`) ?? 0 : null;
      const list = squadByUserId.get(r.userId) ?? [];
      list.push({
        playerId: r.playerId,
        name: r.name,
        photoUrl: r.photoUrl,
        position: r.position,
        teamCode: r.teamCode,
        teamPrimaryColor: r.teamPrimaryColor,
        slotRole: r.slotRole,
        isCaptain: r.isCaptain,
        pir,
      });
      squadByUserId.set(r.userId, list);
    }
    for (const r of coachRows) {
      coachByUserId.set(r.userId, {
        teamId: r.teamId,
        teamCode: r.teamCode,
        teamName: r.teamName,
        teamLogoUrl: r.teamLogoUrl,
        teamPrimaryColor: r.teamPrimaryColor,
        headCoach: r.headCoach,
        imageUrl: r.imageUrl,
      });
    }
  }

  const squadsRevealed = !!options.revealSquads && options.pirRound != null;
  return ranked.map(({ showcaseIds, ...entry }) => ({
    ...entry,
    squad: squadsRevealed ? squadByUserId.get(entry.userId) ?? [] : null,
    coach: squadsRevealed ? coachByUserId.get(entry.userId) ?? null : null,
    hasTeam: true,
    showcase: showcaseIds.map((cid) => cardById.get(cid)).filter((c): c is NonNullable<typeof c> => !!c),
  }));
}
