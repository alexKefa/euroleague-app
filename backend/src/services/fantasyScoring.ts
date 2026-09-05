import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, users, collectibles, teams } from "../db/schema.js";

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
// 100% — see COACH_WIN_POINTS below — never bench-reduced, since there's
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
export const BENCH_SCORE_MULTIPLIER = 0.5;

export const FANTASY_BUDGET_CAP = 100;
export const FANTASY_MIN_PRICE = 4;
export const FANTASY_MAX_PRICE = 17;

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

// --- PIR-to-credit scaling (2026-09-06) ---
//
// Every version of this formula up to now used the blended PIR number
// *as* the credit price directly (just rounded and clamped to
// [MIN_PRICE, MAX_PRICE]) — which happened to look reasonable only
// because real PIR values loosely fall in a similar numeric range to a
// plausible credit scale. It wasn't an actual scale: the top of the
// league (Vezenkov, ~22 PIR) priced at 22cr, while real EuroLeague
// Fantasy prices its own current top player (Vezenkov) at 17cr — a
// directly comparable, sourced reference point (2026-09-06). Rather than
// re-guess a ceiling, FANTASY_PIR_CEILING is calibrated to exactly that:
// a player performing at Vezenkov's current level lands at FANTASY_MAX_PRICE,
// and everyone else is scaled linearly against that same anchor, not just
// individually clamped. This also gives real differentiation at the low
// end, which the old 1:1 mapping didn't: two bench players at PIR 1 and
// PIR 4 used to both floor at identical MIN_PRICE; now they land at
// visibly different (still low) prices.
export const FANTASY_PIR_CEILING = 22;

export interface FantasyPriceInput {
  recentAvgPIR: number | null;
  recentAvgMinutes: number | null;
  recentGameCount: number;
  seasonPIR: number | null;
  seasonMinutesPerGame: number | null;
}

/**
 * See the formula comment above this file's constants. Returns
 * FANTASY_MIN_PRICE for a player with no usable PIR at all yet (no games
 * played this season or any prior one — a true rookie/new signing).
 */
export function computeFantasyPrice(input: FantasyPriceInput): number {
  const hasRecentForm = input.recentGameCount >= MIN_RECENT_GAMES && input.recentAvgPIR !== null;

  const blendedPIR = hasRecentForm
    ? RECENT_FORM_WEIGHT * input.recentAvgPIR! + (1 - RECENT_FORM_WEIGHT) * (input.seasonPIR ?? input.recentAvgPIR!)
    : input.seasonPIR ?? input.recentAvgPIR;

  if (blendedPIR === null || blendedPIR === undefined) return FANTASY_MIN_PRICE;

  const effectiveMinutes = hasRecentForm ? input.recentAvgMinutes : input.seasonMinutesPerGame;
  const raw = effectiveMinutes !== null && effectiveMinutes < LOW_MINUTES_THRESHOLD ? blendedPIR * LOW_MINUTES_DAMPEN : blendedPIR;

  const scaled = FANTASY_MIN_PRICE + (raw / FANTASY_PIR_CEILING) * (FANTASY_MAX_PRICE - FANTASY_MIN_PRICE);
  return Math.min(FANTASY_MAX_PRICE, Math.max(FANTASY_MIN_PRICE, Math.round(scaled)));
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
export const COACH_MIN_PRICE = 4;
export const COACH_MAX_PRICE = 16;

export function computeCoachPrice(position: number | null, totalTeams: number): number {
  if (position === null || totalTeams <= 1) return COACH_MIN_PRICE;
  const clampedPosition = Math.min(Math.max(position, 1), totalTeams);
  const raw = COACH_MAX_PRICE - ((clampedPosition - 1) * (COACH_MAX_PRICE - COACH_MIN_PRICE)) / (totalTeams - 1);
  return Math.min(COACH_MAX_PRICE, Math.max(COACH_MIN_PRICE, Math.round(raw)));
}

// A coach scores off their real team's game result that round, not a stat
// line — +20 for a win, 0 for a loss, straight from EuroLeague Fantasy's
// own published rules (see CLAUDE.md). No game that round (bye) or the
// game not final yet both correctly resolve to 0 via the SQL in
// getFantasyLeaderboardEntries below (coalesce onto a missing/non-final row).
export const COACH_WIN_POINTS = 20;
export const COACH_LOSS_POINTS = 0;

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
 * A single player's own lock moment for one round: their team's specific
 * game tipoff within that round — NOT the round's overall first tipoff.
 * This is what actually implements EuroLeague Fantasy's real "Turns" rule
 * (a round split across match-days; you can swap bench<->starter for any
 * player who "has not yet taken the field" this round, right up until
 * their own team's game starts, even if other teams in the same round
 * already played). Null if that team has no game in this round at all
 * (a bye) — treated as "never locks" by callers, since there's no tipoff
 * event to lock against.
 */
export async function getTeamRoundGameTipoff(season: string, round: number, teamId: string): Promise<Date | null> {
  const [row] = await db
    .select({ tipoffAt: games.tipoffAt })
    .from(games)
    .where(
      and(eq(games.season, season), eq(games.round, round), or(eq(games.homeTeamId, teamId), eq(games.awayTeamId, teamId)))
    )
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

export interface FantasyLeaderboardEntry {
  userId: string;
  displayName: string;
  fantasyPoints: number;
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
 * picked players' playerGameStats.valuation (PIR) for that round's *final*
 * games — captain doubled, bench scored at BENCH_SCORE_MULTIPLIER — plus
 * each round's coach pick's real-result points (COACH_WIN_POINTS/
 * COACH_LOSS_POINTS, always 100%, never bench-reduced). A player/coach who
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
  options: { userIds?: string[]; season: string; round?: number }
): Promise<FantasyLeaderboardEntry[]> {
  const roundFilterFl = options.round !== undefined ? sql`and fl.round = ${options.round}` : sql``;
  const roundFilterFcp = options.round !== undefined ? sql`and fcp.round = ${options.round}` : sql``;

  const totals = await db.execute<{
    user_id: string;
    username: string;
    showcase_collectible_ids: string[];
    fantasy_points: number;
  }>(sql`
    with round_stats as (
      select pgs.player_id, g.season, g.round, pgs.valuation
      from player_game_stats pgs
      join games g on g.id = pgs.game_id
      where g.status = 'final'
    ),
    player_totals as (
      select fl.user_id,
        sum(
          coalesce(rs.valuation, 0)
          * (case when fl.is_captain then 2 else 1 end)
          * (case when fl.slot_role = 'bench' then ${BENCH_SCORE_MULTIPLIER} else 1 end)
        ) as pts
      from fantasy_lineups fl
      left join round_stats rs on rs.player_id = fl.player_id and rs.season = fl.season and rs.round = fl.round
      where fl.season = ${options.season} ${roundFilterFl}
      group by fl.user_id
    ),
    coach_game_result as (
      select season, round, home_team_id as team_id,
        case when status = 'final' and home_score > away_score then ${COACH_WIN_POINTS}::int
             when status = 'final' then ${COACH_LOSS_POINTS}::int
             else 0 end as pts
      from games
      union all
      select season, round, away_team_id as team_id,
        case when status = 'final' and away_score > home_score then ${COACH_WIN_POINTS}::int
             when status = 'final' then ${COACH_LOSS_POINTS}::int
             else 0 end as pts
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
      (coalesce(pt.pts, 0) + coalesce(ct.pts, 0))::int as fantasy_points
    from player_totals pt
    full outer join coach_totals ct on ct.user_id = pt.user_id
    join ${users} u on u.id = coalesce(pt.user_id, ct.user_id)
  `);

  const allowedIds = options.userIds ? new Set(options.userIds) : null;

  const ranked = totals
    .filter((row) => !allowedIds || allowedIds.has(row.user_id))
    .map((row) => ({
      userId: row.user_id,
      displayName: row.username,
      fantasyPoints: row.fantasy_points,
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

  return ranked.map(({ showcaseIds, ...entry }) => ({
    ...entry,
    showcase: showcaseIds.map((cid) => cardById.get(cid)).filter((c): c is NonNullable<typeof c> => !!c),
  }));
}
