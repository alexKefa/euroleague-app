import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { fetchFeedJson } from "./playByPlay.js";

// Referee crews (2026-10-06) for the /referees page: the Header feed's
// Referee1-3 for each final game. Same hooks as gameExtrasSync.ts: when a
// game goes final (liveGamesSync.ts), hourly for any final game of the
// current season still missing a crew (index.ts), and
// `npm run sync:referees -- <season>` for past seasons.

const HEADER_URL = "https://live.euroleague.net/api/Header";
const BETWEEN_GAMES_MS = 1500;

interface RefereeHeader {
  Referee1?: string | null;
  Referee2?: string | null;
  Referee3?: string | null;
}

type GameRow = { id: string; season: string; game_code: number };

/** Stores one game's crew. Returns how many referees were found (0 = feed had none yet). */
export async function syncGameReferees(gameId: string): Promise<number> {
  const [game] = await db.execute<GameRow>(sql`select id, season, game_code from games where id = ${gameId}`);
  if (!game) return 0;
  const header = await fetchFeedJson<RefereeHeader>(
    `${HEADER_URL}?gamecode=${game.game_code}&seasoncode=E${game.season.slice(0, 4)}`
  );
  const names = [header?.Referee1, header?.Referee2, header?.Referee3]
    .map((n) => (n ?? "").trim())
    .map((n, i) => ({ name: n, position: i + 1 }))
    .filter((r) => r.name.length > 0);
  if (names.length === 0) return 0;

  // One statement: upsert the names, then link them to the game.
  const nameList = sql.join(names.map((r) => sql`(${r.name}, ${r.position})`), sql`, `);
  await db.execute(sql`
    with crew(name, position) as (values ${nameList}),
    upserted as (
      insert into referees (name) select name from crew
      on conflict (name) do update set name = excluded.name
      returning id, name
    )
    insert into game_referees (game_id, referee_id, position)
    select ${gameId}::uuid, u.id, c.position::int from crew c join upserted u on u.name = c.name
    on conflict (game_id, referee_id) do update set position = excluded.position
  `);
  return names.length;
}

/** Final games of `season` with no crew stored yet, oldest first. */
export async function syncMissingReferees(season: string, limit: number): Promise<{ synced: number; empty: number; failed: number }> {
  const rows = await db.execute<{ id: string }>(sql`
    select g.id from games g
    where g.season = ${season} and g.status = 'final'
      and not exists (select 1 from game_referees gr where gr.game_id = g.id)
    order by g.tipoff_at
    limit ${limit}
  `);
  let synced = 0;
  let empty = 0;
  let failed = 0;
  for (const [i, r] of rows.entries()) {
    if (i > 0) await new Promise((res) => setTimeout(res, BETWEEN_GAMES_MS));
    const found = await syncGameReferees(r.id).catch((err) => {
      console.error(`[referees] ${r.id} failed:`, err);
      return null;
    });
    if (found == null) failed++;
    else if (found > 0) synced++;
    else empty++;
  }
  return { synced, empty, failed };
}
