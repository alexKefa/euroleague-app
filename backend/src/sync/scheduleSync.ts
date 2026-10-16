import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// Keeps the season's games in step with EuroLeague's schedule (2026-10-08).
// Times otherwise only came from a manual games_sync.py run, which can't run
// on this machine or in production, so every later reschedule was missed:
// round 4 had TEL-MIL two hours late, MUN-VIR half an hour late and DUB-RED
// on the wrong day, and two IST/PAR games had swapped home and away. One
// request for the whole season, then:
//
// 1. UPDATE scheduled games whose tipoff or home/away changed.
// 2. INSERT games the feed has that we don't (2026-10-15). games_sync.py
//    only ever imported regular-season rounds 1-38, so the play-in, playoffs
//    and Final Four (rounds 39+, published by the feed as matchups are
//    decided) never reached the app: 2025-26 has no postseason games at all.
// 3. DELETE scheduled postseason games the feed no longer lists. A playoff
//    Game 4/5 that isn't needed disappears from the feed; left in place it
//    would keep its round from ever counting as finished (round rewards,
//    fantasy grants and recaps all wait for every game in a round to be
//    final). Picks on it go too, since it was never played. Limited to
//    rounds after the regular season so a partial feed can't touch those.
//
// Live/final games are left to liveGamesSync.
const GAMES_URL = "https://api-live.euroleague.net/v2/competitions/E/seasons";

interface FeedGame {
  gameCode: number;
  utcDate: string | null;
  played: boolean;
  round: number;
  phaseType?: { code: string } | null;
  local?: { club?: { code: string } | null; score?: number | null } | null;
  road?: { club?: { code: string } | null; score?: number | null } | null;
  venue?: { name?: string | null } | null;
}

export interface ScheduleSyncResult {
  checked: number;
  changed: { gameCode: number; tipoffAt: string; home: string; away: string }[];
  added: { gameCode: number; round: number; home: string; away: string }[];
  removed: { gameCode: number; round: number }[];
}

export async function syncScheduleTimes(season: string): Promise<ScheduleSyncResult> {
  const res = await fetch(`${GAMES_URL}/E${season.slice(0, 4)}/games`);
  if (!res.ok) throw new Error(`schedule feed ${res.status}`);
  const json = (await res.json()) as { data?: FeedGame[] } | FeedGame[];
  // Postseason slots can be listed before their clubs are known; skip those
  // until the matchup is set.
  const feed = (Array.isArray(json) ? json : (json.data ?? [])).filter(
    (g) => g.utcDate && g.local?.club?.code && g.road?.club?.code
  );
  const empty: ScheduleSyncResult = { checked: 0, changed: [], added: [], removed: [] };
  if (feed.length === 0) return empty;

  const home = (g: FeedGame) => g.local!.club!.code;
  const away = (g: FeedGame) => g.road!.club!.code;
  const iso = (g: FeedGame) => new Date(g.utcDate!).toISOString();

  // 1. Reschedules.
  const upcoming = feed.filter((g) => !g.played);
  let changed: ScheduleSyncResult["changed"] = [];
  if (upcoming.length > 0) {
    const values = sql.join(
      upcoming.map((g) => sql`(${g.gameCode}::int, ${iso(g)}::timestamptz, ${home(g)}::text, ${away(g)}::text)`),
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
    changed = rows.map((r) => ({ gameCode: r.game_code, tipoffAt: new Date(r.tipoff_at).toISOString(), home: r.home_code, away: r.away_code }));
  }

  // 2 + 3 in one statement. Removal needs the regular season's last round
  // from the feed itself; without any regular-season rows the feed looks
  // partial, so nothing is removed.
  const rsRounds = feed.filter((g) => g.phaseType?.code === "RS").map((g) => g.round);
  const lastRsRound = rsRounds.length > 0 ? Math.max(...rsRounds) : null;
  const allValues = sql.join(
    feed.map((g) => {
      const final = g.played && g.local?.score != null && g.road?.score != null;
      return sql`(${g.gameCode}::int, ${iso(g)}::timestamptz, ${home(g)}::text, ${away(g)}::text, ${g.round}::int,
        ${final ? "final" : "scheduled"}::text, ${final ? g.local!.score : null}::int, ${final ? g.road!.score : null}::int, ${g.venue?.name ?? null}::text)`;
    }),
    sql`, `
  );
  const removalFilter =
    lastRsRound === null
      ? sql`false`
      : sql`g.season = ${season} and g.status = 'scheduled' and g.round > ${lastRsRound}
          and g.game_code not in (select game_code from feed)`;

  // Data-modifying CTEs share one snapshot, and the foreign keys are checked
  // at the end of the statement, so the child rows and the game go together.
  const result = (await db.execute(sql`
    with feed (game_code, tipoff_at, home_code, away_code, round, status, home_score, away_score, venue_name) as (
      values ${allValues}
    ),
    added as (
      insert into games (game_code, season, home_team_id, away_team_id, tipoff_at, round, status, home_score, away_score, venue_name)
      select f.game_code, ${season}, h.id, a.id, f.tipoff_at, f.round, f.status, f.home_score, f.away_score, f.venue_name
      from feed f
      join teams h on h.code = f.home_code
      join teams a on a.code = f.away_code
      on conflict (season, game_code) do nothing
      returning game_code, round, home_team_id, away_team_id
    ),
    gone as (select g.id, g.game_code, g.round from games g where ${removalFilter}),
    d1 as (delete from predictions where game_id in (select id from gone)),
    d2 as (delete from top_scorer_predictions where game_id in (select id from gone)),
    d3 as (delete from watch_pins where game_id in (select id from gone)),
    d4 as (delete from game_odds where game_id in (select id from gone)),
    d5 as (delete from game_win_prob where game_id in (select id from gone)),
    d6 as (delete from fantasy_price_change_log where game_id in (select id from gone)),
    d7 as (delete from fantasy_coach_price_change_log where game_id in (select id from gone)),
    d8 as (delete from game_referees where game_id in (select id from gone)),
    -- Never filled for an unplayed game; listed so a stray row can't block the delete.
    d9 as (delete from player_game_stats where game_id in (select id from gone)),
    d10 as (delete from shot_events where game_id in (select id from gone)),
    d11 as (delete from pbp_events where game_id in (select id from gone)),
    d12 as (delete from lineup_stints where game_id in (select id from gone)),
    d13 as (delete from game_alerts where game_id in (select id from gone)),
    removed as (delete from games where id in (select id from gone) returning game_code, round)
    select 'added' as kind, ad.game_code, ad.round, h.code as home, a.code as away
      from added ad join teams h on h.id = ad.home_team_id join teams a on a.id = ad.away_team_id
    union all
    select 'removed', game_code, round, null, null from removed
  `)) as unknown as { kind: "added" | "removed"; game_code: number; round: number; home: string | null; away: string | null }[];

  return {
    checked: feed.length,
    changed,
    added: result.filter((r) => r.kind === "added").map((r) => ({ gameCode: r.game_code, round: r.round, home: r.home!, away: r.away! })),
    removed: result.filter((r) => r.kind === "removed").map((r) => ({ gameCode: r.game_code, round: r.round })),
  };
}
