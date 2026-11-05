import { desc, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, playerSeasonStats } from "../db/schema.js";

// Single source of truth for "current season", used anywhere a route needs
// to pick one without an explicit ?season= param (standings, roster, the
// game-detail preview, a collectible's linked player stats).
//
// This used to be resolved independently per-route as "whichever season has
// the most games actually played" — a deliberate guard against a season
// that's been synced early for team-identity purposes (e.g. round 1, to
// pick up a newly promoted club) prematurely "winning" over a real
// completed season with an all-zero standings table. That guard is now the
// wrong default: during an actual season transition (see CLAUDE.md,
// 2026-09-02) it kept every one of those pages stuck on the prior season
// indefinitely, since the new season doesn't accumulate "most played games"
// until real rounds happen — weeks after the schedule/rosters are already
// live. `games` is always the first thing imported for a season (see
// backend/src/sync-py), so "latest season with games synced" is the
// intentional new default: it flips the moment a season transition actually
// starts, at the cost of the old guard no longer applying. If a season is
// ever synced that far ahead again without also wanting the site to treat
// it as current, this should go back to an explicit toggle instead of an
// inferred one.
export async function getCurrentSeason(): Promise<string | null> {
  const [row] = await db.select({ season: games.season }).from(games).orderBy(desc(games.season)).limit(1);
  return row?.season ?? null;
}

// player_season_stats holds everyone who played, including a one-game
// cameo. Anything treating a row as a reliable baseline or ranking (leaders,
// pricing, card power) must filter with this, or a small sample wins. The
// rule reproduces the feed's own PerGame cutoff (checked 2026-11-05, most
// games played = 10: every player with 6+ listed, nobody with 5 or fewer).
// The subquery is uncorrelated, so it runs once per statement.
export function hasQualifyingGames(gamesPlayed: SQL | typeof playerSeasonStats.gamesPlayed, season: string): SQL {
  return sql`(${gamesPlayed} * 2 > (select max(q.games_played) from ${playerSeasonStats} q where q.season = ${season}))`;
}
