/**
 * Computes each player's AND each team's head-coach Fantasy Five draft
 * price for the current season and upserts into player_fantasy_prices /
 * coach_fantasy_prices. Idempotent — safe to re-run periodically (e.g.
 * weekly, same manual cadence as the other sync/economy scripts, not a
 * cron) as real form/standings numbers move throughout the season. The
 * actual formulas (player: recent form + season baseline, minutes-dampened;
 * coach: standings-position based) live in services/fantasyScoring.ts's
 * computeFantasyPrice/computeCoachPrice — see that file's doc comments.
 *
 * Season-baseline fallback (2026-09-05): early in a season transition, the
 * current season has no player_season_stats/team_season_stats at all yet
 * (nothing played), which used to mean every player/coach floored at the
 * minimum with zero differentiation — a real, verified state (see
 * CLAUDE.md's Fantasy Five section) rather than a bug, but a boring one to
 * actually draft against on day one. Both queries below coalesce onto each
 * player's/team's own most recent *prior* season with data (e.g. 2025-26)
 * when the current season has none yet — real last-season performance
 * instead of a flat floor, self-correcting to current-season form the
 * moment real games start. A brand-new player/an expansion team's coach
 * with no history at all still correctly floors — there's nothing to fall
 * back to.
 *
 * Usage: npm run fantasy:reprice
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, playerFantasyPrices, coachFantasyPrices } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";
import { computeFantasyPrice, computeCoachPrice, RECENT_FORM_WINDOW } from "../services/fantasyScoring.js";

async function repricePlayers(season: string): Promise<{ updated: number; usedFallback: number }> {
  const allPlayers = await db.select({ id: players.id }).from(players);

  // One grouped query for every player's recent-form + season-baseline
  // inputs at once, rather than a per-player round trip (same "fewer
  // statements" lever as everywhere else in this app against the remote
  // DB). `recent_agg` ranks each player's own final games this season
  // most-recent-first and averages just the top RECENT_FORM_WINDOW of
  // them; `prior_season` picks each player's own latest season *before*
  // the current one with a player_season_stats row (season is a
  // lexicographically-sortable "YYYY-YY" string, same trick
  // getCurrentSeason() already relies on), via the standard Postgres
  // DISTINCT ON "latest row per group" idiom.
  const rows = await db.execute<{
    player_id: string;
    recent_avg_pir: number | null;
    recent_avg_minutes: number | null;
    recent_count: number;
    season_pir: number | null;
    season_minutes: number | null;
    used_fallback_season: string | null;
  }>(sql`
    with recent_games as (
      select pgs.player_id, pgs.valuation, pgs.minutes,
        row_number() over (partition by pgs.player_id order by g.tipoff_at desc) as rn
      from player_game_stats pgs
      join games g on g.id = pgs.game_id
      where g.season = ${season} and g.status = 'final'
    ),
    recent_agg as (
      select player_id,
        avg(valuation) as recent_avg_pir,
        avg(minutes) as recent_avg_minutes,
        count(*)::int as recent_count
      from recent_games
      where rn <= ${RECENT_FORM_WINDOW}
      group by player_id
    ),
    prior_season as (
      select distinct on (player_id) player_id, valuation, minutes_per_game, season
      from player_season_stats
      where season < ${season}
      order by player_id, season desc
    )
    select p.id as player_id,
      ra.recent_avg_pir, ra.recent_avg_minutes, coalesce(ra.recent_count, 0)::int as recent_count,
      coalesce(pss.valuation, prior.valuation) as season_pir,
      coalesce(pss.minutes_per_game, prior.minutes_per_game) as season_minutes,
      case when pss.valuation is null then prior.season else null end as used_fallback_season
    from ${players} p
    left join recent_agg ra on ra.player_id = p.id
    left join player_season_stats pss on pss.player_id = p.id and pss.season = ${season}
    left join prior_season prior on prior.player_id = p.id
  `);
  const inputByPlayerId = new Map(rows.map((r) => [r.player_id, r]));

  let updated = 0;
  let usedFallback = 0;
  for (const player of allPlayers) {
    const input = inputByPlayerId.get(player.id);
    if (input?.used_fallback_season) usedFallback++;
    const price = computeFantasyPrice({
      recentAvgPIR: input?.recent_avg_pir ?? null,
      recentAvgMinutes: input?.recent_avg_minutes ?? null,
      recentGameCount: input?.recent_count ?? 0,
      seasonPIR: input?.season_pir ?? null,
      seasonMinutesPerGame: input?.season_minutes ?? null,
    });
    await db
      .insert(playerFantasyPrices)
      .values({ playerId: player.id, season, price })
      .onConflictDoUpdate({
        target: [playerFantasyPrices.playerId, playerFantasyPrices.season],
        set: { price, updatedAt: new Date() },
      });
    updated++;
  }

  return { updated, usedFallback };
}

async function repriceCoaches(season: string): Promise<{ updated: number; usedFallback: number }> {
  // Only teams actually playing this season are coach-pickable — same
  // "teams with a real game this season" scoping GET /teams already uses
  // to exclude a club that's dropped out of the competition (see
  // CLAUDE.md). position falls back to each team's own most recent prior
  // season the same way a player's PIR does above.
  const rows = await db.execute<{
    team_id: string;
    position: number | null;
    used_fallback_season: string | null;
  }>(sql`
    with season_teams as (
      select distinct home_team_id as team_id from games where season = ${season}
      union
      select distinct away_team_id as team_id from games where season = ${season}
    ),
    prior_position as (
      select distinct on (team_id) team_id, position, season
      from team_season_stats
      where season < ${season}
      order by team_id, season desc
    )
    select st.team_id,
      coalesce(tss.position, prior.position) as position,
      case when tss.position is null then prior.season else null end as used_fallback_season
    from season_teams st
    left join team_season_stats tss on tss.team_id = st.team_id and tss.season = ${season}
    left join prior_position prior on prior.team_id = st.team_id
  `);

  const totalTeams = rows.length;
  let updated = 0;
  let usedFallback = 0;
  for (const row of rows) {
    if (row.used_fallback_season) usedFallback++;
    const price = computeCoachPrice(row.position, totalTeams);
    await db
      .insert(coachFantasyPrices)
      .values({ teamId: row.team_id, season, price })
      .onConflictDoUpdate({
        target: [coachFantasyPrices.teamId, coachFantasyPrices.season],
        set: { price, updatedAt: new Date() },
      });
    updated++;
  }

  return { updated, usedFallback };
}

async function main() {
  const season = await getCurrentSeason();
  if (!season) {
    console.log("No season found (no games synced yet) — nothing to price.");
    return;
  }

  const players_ = await repricePlayers(season);
  console.log(
    `Player prices upserted for ${players_.updated} players, season ${season} (${players_.usedFallback} priced off a prior season's stats).`
  );

  const coaches = await repriceCoaches(season);
  console.log(
    `Coach prices upserted for ${coaches.updated} teams, season ${season} (${coaches.usedFallback} priced off a prior season's standings).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("reprice-fantasy-players failed:", err);
    process.exit(1);
  });
