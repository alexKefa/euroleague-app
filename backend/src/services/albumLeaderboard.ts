import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { userCollectibles, users, collectibles, teams } from "../db/schema.js";

export interface AlbumShowcaseCard {
  id: string;
  name: string;
  tier: string;
  imageUrl: string | null;
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
}

export interface AlbumLeaderboardEntry {
  userId: string;
  displayName: string;
  ownedCount: number;
  totalCount: number;
  completion: number;
  showcase: AlbumShowcaseCard[];
}

/** Total catalog size — the same number for every leaderboard entry, and
 * also needed standalone by routes/leagues.ts to fill in a league's
 * zero-card members (who never appear in getAlbumLeaderboardEntries'
 * own result at all). */
export async function getCollectibleCatalogTotal(): Promise<number> {
  const [{ total_count }] = await db.execute<{ total_count: number }>(
    sql`select count(*)::int as total_count from ${collectibles}`
  );
  return total_count;
}

/**
 * Ranked by how much of the full collectible catalog a user owns at least
 * one copy of — shared by the global album leaderboard (routes/
 * collectibles.ts, unfiltered + limit: 20) and a league's scoped board
 * (routes/leagues.ts, userIds: that league's member ids, no limit), same
 * global/league split as points (services/leaderboard.ts) and Fantasy Five
 * (services/fantasyScoring.ts's getFantasyLeaderboardEntries) — a userIds
 * filter is applied to the same unfiltered totals query in JS rather than
 * parameterized into the SQL, for the same "reuse one query, discard rows
 * that don't match" reasoning those two already use.
 *
 * totalCount is the same number for every entry (the catalog doesn't vary
 * per user) — computed once rather than per row. A user who owns nothing
 * at all has no row in `user_collectibles` and so is absent from this
 * result entirely, same as a user with zero predictions is absent from the
 * global points board; routes/leagues.ts adds back a league's zero-card
 * members itself, the same way it already does for zero-point ones.
 */
export async function getAlbumLeaderboardEntries(
  options: { userIds?: string[]; limit?: number } = {}
): Promise<AlbumLeaderboardEntry[]> {
  const totalCount = await getCollectibleCatalogTotal();

  const totals = await db.execute<{
    user_id: string;
    username: string;
    showcase_collectible_ids: string[];
    owned_count: number;
  }>(sql`
    select uc.user_id, u.username, u.showcase_collectible_ids,
      count(distinct uc.collectible_id)::int as owned_count
    from ${userCollectibles} uc
    join ${users} u on u.id = uc.user_id
    group by uc.user_id, u.username, u.showcase_collectible_ids
  `);

  const allowedIds = options.userIds ? new Set(options.userIds) : null;

  let ranked = totals
    .filter((row) => !allowedIds || allowedIds.has(row.user_id))
    .map((row) => ({
      userId: row.user_id,
      displayName: row.username,
      ownedCount: row.owned_count,
      totalCount,
      completion: totalCount > 0 ? row.owned_count / totalCount : 0,
      showcaseIds: row.showcase_collectible_ids ?? [],
    }))
    .sort((a, b) => b.ownedCount - a.ownedCount || a.displayName.localeCompare(b.displayName));

  if (options.limit) ranked = ranked.slice(0, options.limit);

  const allShowcaseIds = [...new Set(ranked.flatMap((r) => r.showcaseIds))];
  const cardRows = allShowcaseIds.length
    ? await db
        .select({ collectible: collectibles, team: teams })
        .from(collectibles)
        .innerJoin(teams, eq(collectibles.teamId, teams.id))
        .where(inArray(collectibles.id, allShowcaseIds))
    : [];
  const cardById = new Map<string, AlbumShowcaseCard>(
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
    showcase: showcaseIds.map((cid) => cardById.get(cid)).filter((c): c is AlbumShowcaseCard => !!c),
  }));
}
