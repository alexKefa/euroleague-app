// Matchup preview (2026-10-09) — DB layer. Loads rows in as few statements
// as possible (latency here is DB round trips, not query count) and hands
// them to ./core.ts. Spec: docs/superpowers/specs/2026-10-09-matchup-preview-design.md
import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { CACHE_KEYS, cached } from "../responseCache.js";
import { SHORT_REST_MAX_DAYS } from "../restSplits.js";
import {
  buildEdges,
  buildH2H,
  buildTeamForm,
  isUpcoming,
  pickKeyBattle,
  ratio,
  restDays,
  toStrip,
  type FinalGameRow,
  type InjuredPlayer,
  type InjuryStatus,
  type MatchupPreview,
  type PlayerAvg,
  type PreviewStrip,
  type TeamAvailability,
  type TeamRef,
  type TeamStatLine,
} from "./core.js";

export type { MatchupPreview, PreviewStrip } from "./core.js";

// A team needs this many final games in the game's season before the edge
// bars and key battle use it instead of the previous season.
const MIN_SEASON_GAMES = 3;
const PREVIEW_TTL_MS = 10 * 60_000;
const SEVERITY: Record<InjuryStatus, number> = { out: 0, doubtful: 1, questionable: 2, probable: 3 };

const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

type RawFinal = {
  id: string;
  season: string;
  tipoffAt: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
};
const toFinal = (r: RawFinal): FinalGameRow => ({ ...r, tipoffAt: new Date(r.tipoffAt) });

// Final games from the two most recent seasons with finals (the same window
// as getRecentSeasons(2)), inlined so it doesn't cost its own round trip.
const recentSeasonsSql = sql`(select season from (select distinct season from games where status = 'final' order by season desc limit 2) s)`;
const finalJson = sql`json_build_object('id', g.id, 'season', g.season, 'tipoffAt', g.tipoff_at, 'homeTeamId', g.home_team_id,
  'awayTeamId', g.away_team_id, 'homeScore', g.home_score, 'awayScore', g.away_score)`;
const teamJson = (alias: string) =>
  sql.raw(`json_build_object('id', ${alias}.id, 'code', ${alias}.code, 'name', ${alias}.name, 'primaryColor', ${alias}.primary_color, 'logoUrl', ${alias}.logo_url)`);

/** null = unknown game. */
export async function getMatchupPreview(gameId: string): Promise<MatchupPreview | { available: false } | null> {
  // 1. The game itself.
  const [game] = await db.execute<{ id: string; season: string; status: string; tipoffAt: Date; home: TeamRef; away: TeamRef }>(sql`
    select g.id, g.season, g.status, g.tipoff_at as "tipoffAt", ${teamJson("ht")} as home, ${teamJson("at")} as away
    from games g join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
    where g.id = ${gameId}`);
  if (!game) return null;
  if (!isUpcoming(game)) return { available: false };
  // Only the heavy part is cached; the lookup above always runs, so a game
  // that just tipped off is never served from cache.
  return cached(`${CACHE_KEYS.preview}game:${gameId}`, PREVIEW_TTL_MS, () =>
    buildFullPreview(game.season, new Date(game.tipoffAt), game.home, game.away)
  );
}

async function buildFullPreview(season: string, tipoff: Date, home: TeamRef, away: TeamRef): Promise<MatchupPreview> {
  // 2. Both teams' final games (form, streak, H2H, rest) plus opponent refs.
  const [finalsRow] = await db.execute<{ finals: RawFinal[] | null; teams: TeamRef[] | null }>(sql`
    select
      (select json_agg(${finalJson}) from games g
        where g.status = 'final' and g.season in ${recentSeasonsSql}
          and (g.home_team_id in (${home.id}, ${away.id}) or g.away_team_id in (${home.id}, ${away.id}))) as finals,
      (select json_agg(${teamJson("t")}) from teams t) as teams`);
  const finals = (finalsRow?.finals ?? []).map(toFinal);
  const teamsById = new Map((finalsRow?.teams ?? []).map((t) => [t.id, t]));
  const seasonFinals = finals.filter((g) => g.season === season);

  // 3. Injured players on either current roster.
  type InjuredRow = { [K in keyof InjuredPlayer]: InjuredPlayer[K] } & { teamId: string };
  const injuredRows = await db.execute<InjuredRow>(sql`
    select p.id as "playerId", p.name, p.photo_url as "photoUrl", p.team_id as "teamId", i.status, i.note, i.note_el as "noteEl"
    from player_injuries i join players p on p.id = i.player_id
    where p.team_id in (${home.id}, ${away.id}) and p.active`);
  const injuredFor = (teamId: string) =>
    injuredRows
      .filter((r) => r.teamId === teamId)
      .sort((a, b) => (SEVERITY[a.status] ?? 9) - (SEVERITY[b.status] ?? 9) || a.name.localeCompare(b.name))
      .map(({ teamId: _t, ...rest }) => rest);

  // Edge bars + key battle use the game's season unless either team has
  // too few final games in it yet — then both use the previous season.
  const gamesIn = (teamId: string) => seasonFinals.filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId).length;
  const usingPriorSeason = gamesIn(home.id) < MIN_SEASON_GAMES || gamesIn(away.id) < MIN_SEASON_GAMES;

  // 4. Team ratings, per-team box-score averages, and current-roster player
  // averages for the stats season, in one statement.
  const [stats] = await db.execute<{
    season: string | null;
    ratings: { teamId: string; offRating: number | null; defRating: number | null }[] | null;
    box: { teamId: string; games: number; fg3m: number; fg3a: number; reb: number; ast: number; tov: number }[] | null;
    players: (Omit<PlayerAvg, "injuryStatus">)[] | null;
  }>(sql`
    with stats_season as (
      select ${usingPriorSeason ? sql`(select max(season) from games where season < ${season} and status = 'final')` : sql`${season}::varchar`} as season
    ),
    -- A line counts only if the player actually played: liveGamesSync stores
    -- "DNP" as null minutes, but it also leaves minutes null when the feed's
    -- format doesn't parse, so null minutes with any stat still counts.
    played as (
      select s.*, g.home_team_id, g.away_team_id
      from player_game_stats s
      join games g on g.id = s.game_id and g.status = 'final' and g.season = (select season from stats_season)
      where s.minutes > 0
        or (s.minutes is null and (coalesce(s.points, 0) <> 0 or coalesce(s.rebounds, 0) <> 0
          or coalesce(s.assists, 0) <> 0 or coalesce(s.valuation, 0) <> 0))
    ),
    lines as (
      select pl.*, coalesce(pss.team_id, p.team_id) as line_team_id
      from played pl
      join players p on p.id = pl.player_id
      left join player_season_stats pss on pss.player_id = pl.player_id and pss.season = (select season from stats_season)
    ),
    team_box as (
      select line_team_id as team_id, game_id,
        sum(coalesce(field_goals_made_3, 0)) fg3m, sum(coalesce(field_goals_attempted_3, 0)) fg3a,
        sum(coalesce(rebounds, 0)) reb, sum(coalesce(assists, 0)) ast, sum(coalesce(turnovers, 0)) tov
      -- Only credit a line to a team that played in that game: a traded
      -- player's season team would otherwise invent games for it.
      from lines where line_team_id in (${home.id}, ${away.id}) and line_team_id in (home_team_id, away_team_id)
      group by line_team_id, game_id
    )
    select
      (select season from stats_season) as season,
      (select json_agg(json_build_object('teamId', team_id, 'offRating', off_rating, 'defRating', def_rating))
        from team_season_stats where season = (select season from stats_season) and team_id in (${home.id}, ${away.id})) as ratings,
      (select json_agg(b) from (
        select team_id as "teamId", count(*)::int as games, sum(fg3m)::int as fg3m, sum(fg3a)::int as fg3a,
          avg(reb)::float as reb, avg(ast)::float as ast, avg(tov)::float as tov
        from team_box group by team_id) b) as box,
      (select json_agg(pl) from (
        select p.id as "playerId", p.name, p.photo_url as "photoUrl", coalesce(p.position, '') as position, p.team_id as "teamId",
          count(*)::int as games, avg(l.points)::float as pts, avg(l.rebounds)::float as reb,
          avg(l.assists)::float as ast, avg(l.valuation)::float as pir
        from lines l join players p on p.id = l.player_id
        where p.team_id in (${home.id}, ${away.id}) and p.active
        group by p.id) pl) as players`);

  const statLine = (teamId: string): TeamStatLine => {
    const r = stats?.ratings?.find((x) => x.teamId === teamId);
    const b = stats?.box?.find((x) => x.teamId === teamId);
    const pct = b ? ratio(b.fg3m, b.fg3a) : null;
    return {
      offRating: round1(r?.offRating ?? null),
      defRating: round1(r?.defRating ?? null),
      threePct: round1(pct === null ? null : pct * 100),
      rebPg: round1(b ? b.reb : null),
      astPg: round1(b ? b.ast : null),
      tovPg: round1(b ? b.tov : null),
    };
  };

  const injuryByPlayer = new Map(injuredRows.map((r) => [r.playerId, r.status]));
  const players: PlayerAvg[] = (stats?.players ?? []).map((p) => ({
    ...p,
    pts: round1(p.pts) ?? 0,
    reb: round1(p.reb) ?? 0,
    ast: round1(p.ast) ?? 0,
    pir: round1(p.pir) ?? 0,
    injuryStatus: injuryByPlayer.get(p.playerId) ?? null,
  }));

  const availability = (teamId: string): TeamAvailability => {
    const rest = restDays(teamId, seasonFinals, tipoff);
    return { injured: injuredFor(teamId), restDays: rest, shortRest: rest !== null && rest <= SHORT_REST_MAX_DAYS };
  };

  return {
    available: true,
    statsSeason: stats?.season ?? season,
    usingPriorSeason,
    form: { home: buildTeamForm(home.id, seasonFinals, teamsById), away: buildTeamForm(away.id, seasonFinals, teamsById) },
    h2h: buildH2H(home.id, away.id, finals),
    availability: { home: availability(home.id), away: availability(away.id) },
    edges: buildEdges(statLine(home.id), statLine(away.id)),
    keyBattle: pickKeyBattle(home.id, away.id, players),
  };
}

export function getRoundPreviewStrips(season: string, round: number): Promise<Record<string, PreviewStrip>> {
  return cached(`${CACHE_KEYS.preview}round:${season}:${round}`, PREVIEW_TTL_MS, () => loadRoundPreviewStrips(season, round));
}

async function loadRoundPreviewStrips(season: string, round: number): Promise<Record<string, PreviewStrip>> {
  // 1. The round's games plus every recent final involving a team in it.
  const [row] = await db.execute<{
    games: { id: string; status: string; tipoffAt: string; homeTeamId: string; awayTeamId: string }[] | null;
    finals: RawFinal[] | null;
  }>(sql`
    with rg as (select id, status, tipoff_at, home_team_id, away_team_id from games where season = ${season} and round = ${round}),
    round_teams as (select home_team_id as team_id from rg union select away_team_id from rg)
    select
      (select json_agg(json_build_object('id', id, 'status', status, 'tipoffAt', tipoff_at, 'homeTeamId', home_team_id, 'awayTeamId', away_team_id)) from rg) as games,
      (select json_agg(${finalJson}) from games g
        where g.status = 'final' and g.season in ${recentSeasonsSql}
          and (g.home_team_id in (select team_id from round_teams) or g.away_team_id in (select team_id from round_teams))) as finals`);

  const now = Date.now();
  const upcoming = (row?.games ?? []).filter((g) => isUpcoming(g, now));
  if (upcoming.length === 0) return {};
  const finals = (row?.finals ?? []).map(toFinal);
  const seasonFinals = finals.filter((g) => g.season === season);

  // 2. Out/doubtful counts per team.
  const counts = await db.execute<{ teamId: string; n: number }>(sql`
    select p.team_id as "teamId", count(*)::int as n
    from player_injuries i join players p on p.id = i.player_id
    where i.status in ('out', 'doubtful') and p.active
    group by p.team_id`);
  const injuries = new Map(counts.map((c) => [c.teamId, c.n]));

  const noRefs = new Map<string, TeamRef>();
  const out: Record<string, PreviewStrip> = {};
  for (const g of upcoming) {
    out[g.id] = toStrip(
      { home: buildTeamForm(g.homeTeamId, seasonFinals, noRefs), away: buildTeamForm(g.awayTeamId, seasonFinals, noRefs) },
      buildH2H(g.homeTeamId, g.awayTeamId, finals),
      { home: injuries.get(g.homeTeamId) ?? 0, away: injuries.get(g.awayTeamId) ?? 0 }
    );
  }
  return out;
}
