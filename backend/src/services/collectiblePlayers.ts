// Links cards to the player they depict (collectibles.player_id, 2026-11-12).
// Cards were created from players by (team, display name) and never stored
// the player, so this re-derives the link the same way:
//  - Series 2 Moments: exact, from collectible_moments.player_id.
//  - Series 1 player cards: a player on the card's team whose
//    "LAST, FIRST" name displays as the card's name. If none, a unique
//    name match anywhere (the player already moved and the card was left on
//    the old team; the roster sync then moves it). Ambiguous names stay
//    unlinked and are reported.
// Coach cards are never linked. The roster sync runs this every day, so
// cards created by any path (scripts, polls, admin) get linked on the next run.
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { displayName } from "./imageSync.js";

export interface LinkResult {
  linked: { id: string; player_id: string; name: string; tier: string; series: number; match: "moment" | "team" | "name" }[];
  unmatched: { id: string; name: string; tier: string; team: string }[];
}

// "PETERS, ALEC" and "Alec Peters" both become "alec peters".
const PLAYER_KEY = sql.raw(`regexp_replace(lower(trim(case when position(',' in p.name) > 0
  then split_part(p.name, ',', 2) || ' ' || split_part(p.name, ',', 1) else p.name end)), '\\s+', ' ', 'g')`);
const CARD_KEY = sql.raw(`regexp_replace(lower(trim(c.name)), '\\s+', ' ', 'g')`);

export async function linkCollectiblesToPlayers(opts: { dryRun?: boolean } = {}): Promise<LinkResult> {
  const picks = sql`
    with np as (select p.id, p.team_id, ${PLAYER_KEY} as key from players p),
    cards as (
      select c.id, c.team_id, ${CARD_KEY} as key from collectibles c
      where c.player_id is null and c.series = 1 and c.tier <> 'coach'
    ),
    by_team as (
      select cards.id as cid, min(np.id::text)::uuid as pid, count(*) as n
      from cards join np on np.key = cards.key and np.team_id = cards.team_id group by cards.id
    ),
    by_name as (
      select cards.id as cid, min(np.id::text)::uuid as pid, count(*) as n
      from cards join np on np.key = cards.key
      where cards.id not in (select cid from by_team) group by cards.id
    ),
    picked as (
      select cid, pid, 'team' as match from by_team where n = 1
      union all select cid, pid, 'name' from by_name where n = 1
      union all
      select c.id, m.player_id, 'moment' from collectibles c
      join collectible_moments m on m.collectible_id = c.id where c.player_id is null
    )`;

  const linked = opts.dryRun
    ? await db.execute<LinkResult["linked"][number]>(sql`
        ${picks}
        select c.id, picked.pid as player_id, c.name, c.tier, c.series, picked.match from picked join collectibles c on c.id = picked.cid`)
    : await db.execute<LinkResult["linked"][number]>(sql`
        ${picks}
        update collectibles c set player_id = picked.pid from picked where c.id = picked.cid
        returning c.id, c.player_id, c.name, c.tier, c.series, picked.match`);

  const linkedIds = new Set(linked.map((r) => r.id));
  const stillNull = await db.execute<LinkResult["unmatched"][number]>(sql`
    select c.id, c.name, c.tier, t.code as team from collectibles c join teams t on t.id = c.team_id
    where c.player_id is null and c.tier <> 'coach'`);

  return { linked: [...linked], unmatched: stillNull.filter((r) => !linkedIds.has(r.id)) };
}

// Same prices as scripts/expand-collectibles.ts.
const COMMON_COST = 50;
const RARE_COST = 250;

/**
 * Gives every active player on the given clubs who has no series-1 card a
 * common and a rare (2026-11-12), so a new signing joins the album on the
 * next roster sync instead of waiting for someone to run
 * collectibles:expand. Legendaries stay curated (expand-collectibles' top-up,
 * polls). Run after linkCollectiblesToPlayers, so an existing card that only
 * needed linking is never duplicated. One select, one multi-row insert.
 */
export async function createCardsForNewPlayers(
  teamIds: string[],
  opts: { dryRun?: boolean } = {}
): Promise<{ name: string; team: string }[]> {
  if (teamIds.length === 0) return [];
  const ids = sql.join(teamIds.map((id) => sql`${id}::uuid`), sql`, `);
  const missing = await db.execute<{ id: string; name: string; team_id: string; photo_url: string | null; team: string }>(sql`
    select p.id, p.name, p.team_id, p.photo_url, t.code as team from players p join teams t on t.id = p.team_id
    where p.active and p.team_id in (${ids})
      and not exists (select 1 from collectibles c where c.player_id = p.id and c.series = 1)
    order by t.code, p.name`);
  if (!opts.dryRun && missing.length > 0) {
    const rows = missing.flatMap((p) =>
      (["common", "rare"] as const).map(
        (tier) =>
          sql`(${displayName(p.name)}, ${p.team_id}::uuid, ${tier}, ${tier === "common" ? COMMON_COST : RARE_COST}, ${p.photo_url}, ${p.id}::uuid)`
      )
    );
    await db.execute(sql`
      insert into collectibles (name, team_id, tier, points_cost, image_url, player_id)
      values ${sql.join(rows, sql`, `)}`);
  }
  return missing.map((p) => ({ name: displayName(p.name), team: p.team }));
}
