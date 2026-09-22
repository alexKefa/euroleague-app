/**
 * One-time (but idempotent — safe to re-run) catalog expansion: grows the
 * `collectibles` table from a hand-curated ~40 cards covering 2 teams to a
 * common + rare card for every real player across every team, plus (as of
 * the 2026-09-22 "replace legendary with brand-name players" pass, see
 * replace-legendary-catalog.ts for the one-off migration that first set
 * this up) LEGENDARIES_PER_TEAM legendaries per team — the roster's top
 * players by season PIR — for any team that doesn't already have that many.
 *
 * Existing hand-curated rows are left untouched and matched by normalized
 * name + team so this never creates a duplicate for a player who already
 * has a card — critical since real users already own some of these
 * (user_collectibles, pack_openings reference collectible IDs by FK).
 *
 * Usage: npm run collectibles:expand
 */
import "dotenv/config";
import { eq, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, teams, collectibles, games } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";

const COMMON_COST = 50;
const RARE_COST = 250;
const LEGENDARY_COST = 2500;
const LEGENDARIES_PER_TEAM = 2;

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** "PETERS, ALEC" -> "Alec Peters"; "ALSTON JR. , DERRICK" -> "Derrick Alston Jr." */
function displayName(rawName: string): string {
  const [last, first] = rawName.split(",").map((s) => s.trim());
  const toTitle = (s: string) => s.split(/\s+/).map(titleCase).join(" ");
  return `${toTitle(first)} ${toTitle(last)}`;
}

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  // Scoped to active players on teams actually in getCurrentSeason()'s
  // schedule — same scoping GET /teams already uses (see its own comment)
  // — not every row ever synced. Without this, a team no longer in the
  // competition (e.g. AS Monaco, out for 2026-27) still gets cards for
  // whatever players its `players` rows last happened to point at,
  // because its roster feed 404s every sync run and so never gets the
  // chance to flip those players to `active: false` itself (caught
  // 2026-09-16: 5 stale Monaco rows still `active: true` months later).
  // A departed player on a real current-season team (active: false) is
  // excluded the same way.
  const season = await getCurrentSeason();
  const currentSeasonTeamIds = season
    ? new Set(
        (
          await db
            .selectDistinct({ id: teams.id })
            .from(teams)
            .innerJoin(games, or(eq(games.homeTeamId, teams.id), eq(games.awayTeamId, teams.id)))
            .where(eq(games.season, season))
        ).map((t) => t.id)
      )
    : null; // no season with any game synced yet — fall back to every team rather than cataloging nothing

  const allPlayers = (await db.select().from(players)).filter(
    (p) => p.active && (!currentSeasonTeamIds || currentSeasonTeamIds.has(p.teamId))
  );
  const allTeams = await db.select().from(teams);
  const teamById = new Map(allTeams.map((t) => [t.id, t]));

  const existing = await db.select().from(collectibles);
  // Key: `${teamId}::${tier}::${normalizedName}` -> exists
  const existingKeys = new Set(existing.map((c) => `${c.teamId}::${c.tier}::${normalize(c.name)}`));
  const legendaryCountByTeam = new Map<string, number>();
  for (const c of existing) {
    if (c.tier !== "legendary") continue;
    legendaryCountByTeam.set(c.teamId, (legendaryCountByTeam.get(c.teamId) ?? 0) + 1);
  }

  // Current season's own valuation if a player has a row there, else their
  // own most recent prior season — same per-player fallback
  // replace-legendary-catalog.ts uses, needed since a freshly-transitioned
  // season has zero rows league-wide for a while.
  const valuationRows = season
    ? await db.execute<{ player_id: string; valuation: number | null }>(sql`
        with prior_season as (
          select distinct on (player_id) player_id, valuation
          from player_season_stats
          where season < ${season}
          order by player_id, season desc
        )
        select p.id as player_id, coalesce(cs.valuation, ps.valuation) as valuation
        from ${players} p
        left join player_season_stats cs on cs.player_id = p.id and cs.season = ${season}
        left join prior_season ps on ps.player_id = p.id
      `)
    : [];
  const valuationByPlayerId = new Map(valuationRows.map((r) => [r.player_id, r.valuation]));

  let commonsInserted = 0;
  let raresInserted = 0;
  let legendariesInserted = 0;

  for (const player of allPlayers) {
    const team = teamById.get(player.teamId);
    if (!team) continue;

    const name = displayName(player.name);
    const key = (tier: string) => `${team.id}::${tier}::${normalize(name)}`;

    if (!existingKeys.has(key("common"))) {
      await db.insert(collectibles).values({
        name,
        teamId: team.id,
        tier: "common",
        pointsCost: COMMON_COST,
        imageUrl: player.photoUrl,
      });
      existingKeys.add(key("common"));
      commonsInserted++;
    }

    if (!existingKeys.has(key("rare"))) {
      await db.insert(collectibles).values({
        name,
        teamId: team.id,
        tier: "rare",
        pointsCost: RARE_COST,
        imageUrl: player.photoUrl,
      });
      existingKeys.add(key("rare"));
      raresInserted++;
    }
  }

  // Up to LEGENDARIES_PER_TEAM legendaries per team, topping up whatever's
  // missing — the roster's top players by season PIR (an objective "best
  // player" pick now that boxscore-derived stats are synced), skipping
  // anyone already a legendary for that team (existingKeys) so a re-run
  // never creates a duplicate.
  const byTeam = new Map<string, typeof allPlayers>();
  for (const p of allPlayers) {
    const arr = byTeam.get(p.teamId) ?? [];
    arr.push(p);
    byTeam.set(p.teamId, arr);
  }

  for (const [teamId, roster] of byTeam) {
    const already = legendaryCountByTeam.get(teamId) ?? 0;
    const need = LEGENDARIES_PER_TEAM - already;
    if (need <= 0) continue;
    const team = teamById.get(teamId);
    if (!team) continue;

    const ranked = roster
      .map((p) => ({ player: p, valuation: valuationByPlayerId.get(p.id) ?? -Infinity }))
      .sort((a, b) => b.valuation - a.valuation);

    let filled = 0;
    for (const { player, valuation } of ranked) {
      if (filled >= need) break;
      if (valuation === -Infinity) break; // no stats to rank the rest by either

      const name = displayName(player.name);
      const key = `${team.id}::legendary::${normalize(name)}`;
      if (existingKeys.has(key)) continue;

      await db.insert(collectibles).values({
        name,
        teamId: team.id,
        tier: "legendary",
        pointsCost: LEGENDARY_COST,
        imageUrl: player.photoUrl,
      });
      existingKeys.add(key);
      legendariesInserted++;
      filled++;
    }
  }

  console.log(
    `Inserted ${commonsInserted} common, ${raresInserted} rare, ${legendariesInserted} legendary collectibles.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Collectibles expansion failed:", err);
  process.exit(1);
});
