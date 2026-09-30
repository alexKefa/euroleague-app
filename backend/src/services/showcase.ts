import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, teams } from "../db/schema.js";

export interface ShowcaseCard {
  id: string;
  name: string;
  tier: string;
  imageUrl: string | null;
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
  // Per owner, not per card: foil lives on user_collectibles, so the same
  // legendary can be foil in one user's showcase and standard in another's.
  finish: "standard" | "foil";
}

type LoadedCard = Omit<ShowcaseCard, "finish"> & { foilOwnerIds: string[] };

/**
 * Resolves showcase collectible ids (users.showcaseCollectibleIds) to card
 * data for a leaderboard — shared by the predictions, fantasy and album
 * leaderboards and routes/leagues.ts's zero-activity rows, which each used
 * to carry their own copy of this query. Which users own each card as foil
 * rides along as a subquery column (2026-09-30), so showing foil costs no
 * extra round trip. Pair with showcaseFor() per entry.
 */
export async function loadShowcaseCards(showcaseIds: string[]): Promise<Map<string, LoadedCard>> {
  const ids = [...new Set(showcaseIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      collectible: collectibles,
      team: teams,
      foilOwnerIds: sql<string[]>`coalesce((
        select array_agg(uc.user_id::text) from user_collectibles uc
        where uc.collectible_id = ${collectibles.id} and uc.finish = 'foil'
      ), '{}')`,
    })
    .from(collectibles)
    .innerJoin(teams, eq(collectibles.teamId, teams.id))
    .where(inArray(collectibles.id, ids));
  return new Map(
    rows.map(({ collectible, team, foilOwnerIds }) => [
      collectible.id,
      {
        id: collectible.id,
        name: collectible.name,
        tier: collectible.tier,
        imageUrl: collectible.imageUrl,
        team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor, logoUrl: team.logoUrl },
        foilOwnerIds,
      },
    ])
  );
}

/** One user's showcase, in their chosen order, with their own finish on each card. */
export function showcaseFor(ids: string[], cards: Map<string, LoadedCard>, userId: string): ShowcaseCard[] {
  const out: ShowcaseCard[] = [];
  for (const id of ids) {
    const card = cards.get(id);
    if (!card) continue;
    const { foilOwnerIds, ...rest } = card;
    out.push({ ...rest, finish: foilOwnerIds.includes(userId) ? "foil" : "standard" });
  }
  return out;
}
