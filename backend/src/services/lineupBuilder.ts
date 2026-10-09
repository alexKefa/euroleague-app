// Lineup builder (2026-10-09): how any 2-5 players did together this
// season, how the team did otherwise, and which teammate makes the group
// best. Built from lineup_stints in one statement (latency here is round
// trips). Spec: docs/superpowers/specs/2026-10-09-lineup-builder-design.md
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

// A partner needs this much time with the group to be ranked.
export const PARTNER_MIN_SECONDS = 600;
export const PARTNER_LIMIT = 5;

export interface LineupSums {
  seconds: number;
  games: number;
  ptsFor: number;
  ptsAgainst: number;
  possFor: number;
  possAgainst: number;
}

export interface LineupPartner extends LineupSums {
  player: { id: string | null; code: string; name: string | null; photoUrl: string | null };
}

export interface LineupBuilderResult {
  season: string;
  together: LineupSums;
  otherwise: LineupSums;
  partners: LineupPartner[];
}

const CODE_RE = /^[A-Za-z0-9]{1,20}$/;
const MIN_PICK = 2;
const MAX_PICK = 5;

/** `?players=` → sorted, deduped codes, or null unless 2-5 well-formed codes. */
export function normalizePlayerCodes(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.some((p) => !CODE_RE.test(p))) return null;
  const codes = [...new Set(parts)].sort((a, b) => a.localeCompare(b));
  return codes.length >= MIN_PICK && codes.length <= MAX_PICK ? codes : null;
}

const sumsJson = (from: string) =>
  sql.raw(`(select json_build_object(
      'seconds', coalesce(sum(seconds), 0)::int, 'games', count(distinct game_id)::int,
      'ptsFor', coalesce(sum(pts_for), 0)::int, 'ptsAgainst', coalesce(sum(pts_against), 0)::int,
      'possFor', coalesce(sum(poss_for), 0)::float, 'possAgainst', coalesce(sum(poss_against), 0)::float) from ${from})`);

export async function getLineupBuilder(teamId: string, season: string, codes: string[]): Promise<LineupBuilderResult> {
  const group = sql`array[${sql.join(codes.map((c) => sql`${c}`), sql`, `)}]::text[]`;
  const [row] = await db.execute<Omit<LineupBuilderResult, "season">>(sql`
    with stints as (
      -- Same possession estimate as services/teamAnalytics.ts.
      select player_codes, game_id, seconds, pts_for, pts_against,
        (fga_for - oreb_for + tov_for + 0.44 * fta_for) as poss_for,
        (fga_against - oreb_against + tov_against + 0.44 * fta_against) as poss_against
      from lineup_stints where team_id = ${teamId} and season = ${season}
    ),
    grp as (select * from stints where player_codes @> ${group}),
    -- Everything else: the team's minutes when the group isn't all on court.
    rest as (select * from stints where not (player_codes @> ${group})),
    partner as (
      select c.code, sum(g.seconds)::int as sec, count(distinct g.game_id)::int as games,
        sum(g.pts_for)::int as pf, sum(g.pts_against)::int as pa,
        sum(g.poss_for)::float as posf, sum(g.poss_against)::float as posa
      from grp g cross join lateral unnest(g.player_codes) as c(code)
      where c.code <> all(${group})
      group by c.code
      having sum(g.seconds) >= ${PARTNER_MIN_SECONDS}
      order by 100 * (sum(g.pts_for) / nullif(sum(g.poss_for), 0) - sum(g.pts_against) / nullif(sum(g.poss_against), 0)) desc nulls last,
        sum(g.seconds) desc
      limit ${PARTNER_LIMIT}
    )
    select
      ${sumsJson("grp")} as together,
      ${sumsJson("rest")} as otherwise,
      coalesce((select json_agg(json_build_object(
          'player', json_build_object('id', p.id, 'code', pt.code, 'name', p.name, 'photoUrl', p.photo_url),
          'seconds', pt.sec, 'games', pt.games, 'ptsFor', pt.pf, 'ptsAgainst', pt.pa,
          'possFor', pt.posf, 'possAgainst', pt.posa)
        order by 100 * (pt.pf / nullif(pt.posf, 0) - pt.pa / nullif(pt.posa, 0)) desc nulls last, pt.sec desc)
        from partner pt left join players p on p.code = pt.code), '[]'::json) as partners`);
  return { season, together: row.together, otherwise: row.otherwise, partners: row.partners };
}
