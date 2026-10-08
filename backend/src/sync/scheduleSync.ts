import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// Keeps scheduled games' tipoff times in step with EuroLeague's schedule
// (2026-10-08). Times otherwise only came from a manual games_sync.py run,
// which can't run on this machine or in production, so every later
// reschedule was missed: round 4 had TEL-MIL two hours late, MUN-VIR half an
// hour late and DUB-RED on the wrong day, and two IST/PAR games had swapped
// home and away. One request for the whole season, one UPDATE for the
// changed games (tipoff, and home/away by the feed's club codes). Live/final
// games are left to liveGamesSync.
const GAMES_URL = "https://api-live.euroleague.net/v2/competitions/E/seasons";

interface FeedGame {
  gameCode: number;
  utcDate: string | null;
  played: boolean;
  local: { club: { code: string } };
  road: { club: { code: string } };
}

export interface ScheduleSyncResult {
  checked: number;
  changed: { gameCode: number; tipoffAt: string; home: string; away: string }[];
}

export async function syncScheduleTimes(season: string): Promise<ScheduleSyncResult> {
  const res = await fetch(`${GAMES_URL}/E${season.slice(0, 4)}/games`);
  if (!res.ok) throw new Error(`schedule feed ${res.status}`);
  const json = (await res.json()) as { data?: FeedGame[] } | FeedGame[];
  const feed = (Array.isArray(json) ? json : (json.data ?? [])).filter((g) => !g.played && g.utcDate);
  if (feed.length === 0) return { checked: 0, changed: [] };

  const values = sql.join(
    feed.map(
      (g) =>
        sql`(${g.gameCode}::int, ${new Date(g.utcDate!).toISOString()}::timestamptz, ${g.local.club.code}::text, ${g.road.club.code}::text)`
    ),
    sql`, `
  );
  // A club code we don't know drops out of the join instead of nulling a team.
  const rows = (await db.execute(sql`
    update games set tipoff_at = v.tipoff_at, home_team_id = h.id, away_team_id = a.id
    from (values ${values}) as v(game_code, tipoff_at, home_code, away_code)
    join teams h on h.code = v.home_code
    join teams a on a.code = v.away_code
    where games.season = ${season}
      and games.game_code = v.game_code
      and games.status = 'scheduled'
      and (games.tipoff_at <> v.tipoff_at or games.home_team_id <> h.id or games.away_team_id <> a.id)
    returning games.game_code, games.tipoff_at, v.home_code, v.away_code
  `)) as unknown as { game_code: number; tipoff_at: Date | string; home_code: string; away_code: string }[];

  return {
    checked: feed.length,
    changed: rows.map((r) => ({
      gameCode: r.game_code,
      tipoffAt: new Date(r.tipoff_at).toISOString(),
      home: r.home_code,
      away: r.away_code,
    })),
  };
}
