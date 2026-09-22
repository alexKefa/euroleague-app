/**
 * One-off (kept for history, not idempotent-safe to run twice — see the
 * bottom of this file): replaces the entire legendary catalog with each
 * current-season team's top 2 players by real season PIR (playerSeasonStats
 * .valuation), 2 per team instead of the previous 1 — direct request
 * ("replace our legendary cards with the brand name players of each team"),
 * 2026-09-22.
 *
 * Explicit decisions made with the user before running this:
 * - 2 legendaries per team (not 1, not a hand-picked list) — 20 current
 *   teams x 2 = 40 total, up from 20.
 * - Picked by real synced stats (season PIR), not a hand-curated "fame"
 *   list — objective, reproducible, no guessing.
 * - Old legendary rows are deleted outright, not renamed in place, with NO
 *   compensation to anyone who owned one — explicitly confirmed safe to do
 *   this way because production had ZERO real userCollectibles rows for a
 *   legendary at the time this ran (verified directly before writing this
 *   script) and zero pending trades referencing one. Only 6 historical
 *   packOpeningResults rows referenced the old catalog (a rolled-in-the-
 *   past log, not live ownership) — deleted along with the old rows rather
 *   than orphaned. If this is ever re-run after real legendary ownership
 *   exists, this blanket delete is NOT safe as-is and needs the same
 *   "verify zero references, abort if any exist" guard
 *   remove-collectibles-without-team.ts already uses.
 *
 * Season PIR fallback: current season (getCurrentSeason()) if a player has
 * a row there, else their own most recent prior season — same per-player
 * fallback shape as reprice-fantasy-players.ts, needed because 2026-27 has
 * zero played games as of this pass, so every pick actually comes from
 * each player's real 2025-26 form.
 *
 * Usage: npx tsx src/scripts/replace-legendary-catalog.ts
 */
import "dotenv/config";
import { eq, or, sql, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  players,
  teams,
  games,
  collectibles,
  userCollectibles,
  packOpeningResults,
  wheelSpins,
  roundRewards,
  legendaryMilestones,
  coachMilestones,
  tradeOffers,
  tradeOfferItems,
} from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";

const LEGENDARY_COST = 2500; // matches the existing catalog's real value
const LEGENDARIES_PER_TEAM = 2;

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** "PETERS, ALEC" -> "Alec Peters" — same as expand-collectibles.ts. */
function displayName(rawName: string): string {
  const [last, first] = rawName.split(",").map((s) => s.trim());
  const toTitle = (s: string) => s.split(/\s+/).map(titleCase).join(" ");
  return `${toTitle(first)} ${toTitle(last)}`;
}

async function main() {
  const season = await getCurrentSeason();
  if (!season) throw new Error("no season synced — nothing to build a catalog from");
  console.log("season:", season);

  // Same "teams with a real game this season" scoping expand-collectibles.ts
  // already uses (excludes a team like AS Monaco that's dropped out).
  const currentSeasonTeamIds = new Set(
    (
      await db
        .selectDistinct({ id: teams.id })
        .from(teams)
        .innerJoin(games, or(eq(games.homeTeamId, teams.id), eq(games.awayTeamId, teams.id)))
        .where(eq(games.season, season))
    ).map((t) => t.id)
  );
  console.log("current-season teams:", currentSeasonTeamIds.size);

  // One grouped query for every active player's best-available valuation —
  // current season if they have a row there, else their own latest prior
  // season (standard Postgres DISTINCT ON "latest row per group" idiom,
  // same trick reprice-fantasy-players.ts already uses).
  const rows = await db.execute<{
    player_id: string;
    team_id: string;
    name: string;
    photo_url: string | null;
    valuation: number | null;
  }>(sql`
    with prior_season as (
      select distinct on (player_id) player_id, valuation
      from player_season_stats
      where season < ${season}
      order by player_id, season desc
    )
    select p.id as player_id, p.team_id, p.name, p.photo_url,
      coalesce(cs.valuation, ps.valuation) as valuation
    from ${players} p
    left join player_season_stats cs on cs.player_id = p.id and cs.season = ${season}
    left join prior_season ps on ps.player_id = p.id
    where p.active = true
  `);

  type PlayerRow = { player_id: string; team_id: string; name: string; photo_url: string | null; valuation: number | null };
  const byTeam = new Map<string, PlayerRow[]>();
  for (const r of rows) {
    if (!currentSeasonTeamIds.has(r.team_id)) continue;
    const arr = byTeam.get(r.team_id) ?? [];
    arr.push(r);
    byTeam.set(r.team_id, arr);
  }

  const picks: { name: string; teamId: string; imageUrl: string | null; valuation: number | null }[] = [];
  for (const [teamId, roster] of byTeam) {
    const ranked = [...roster].sort((a, b) => (b.valuation ?? -Infinity) - (a.valuation ?? -Infinity));
    const top = ranked.slice(0, LEGENDARIES_PER_TEAM).filter((r) => r.valuation !== null);
    for (const r of top) {
      picks.push({ name: displayName(r.name), teamId, imageUrl: r.photo_url, valuation: r.valuation });
    }
  }
  console.log(`\npicked ${picks.length} players across ${byTeam.size} teams:`);
  for (const p of picks) console.log(` - ${p.name} (PIR ${p.valuation})`);

  const oldLegendaries = await db.select({ id: collectibles.id }).from(collectibles).where(eq(collectibles.tier, "legendary"));
  const oldIds = oldLegendaries.map((c) => c.id);
  console.log(`\nremoving ${oldIds.length} old legendary collectibles and every row referencing them...`);

  if (oldIds.length > 0) {
    await db.transaction(async (tx) => {
      const items = await tx.select({ id: tradeOfferItems.id, tradeOfferId: tradeOfferItems.tradeOfferId }).from(tradeOfferItems).where(inArray(tradeOfferItems.collectibleId, oldIds));
      if (items.length > 0) {
        await tx.delete(tradeOfferItems).where(inArray(tradeOfferItems.id, items.map((i) => i.id)));
        const offerIds = [...new Set(items.map((i) => i.tradeOfferId))];
        await tx.delete(tradeOffers).where(inArray(tradeOffers.id, offerIds));
      }
      await tx.delete(tradeOffers).where(inArray(tradeOffers.requestedCollectibleId, oldIds));
      await tx.delete(userCollectibles).where(inArray(userCollectibles.collectibleId, oldIds));
      await tx.delete(packOpeningResults).where(inArray(packOpeningResults.collectibleId, oldIds));
      await tx.delete(wheelSpins).where(inArray(wheelSpins.collectibleId, oldIds));
      await tx.delete(roundRewards).where(inArray(roundRewards.collectibleId, oldIds));
      await tx.delete(legendaryMilestones).where(inArray(legendaryMilestones.collectibleId, oldIds));
      await tx.delete(coachMilestones).where(inArray(coachMilestones.collectibleId, oldIds));
      await tx.delete(collectibles).where(inArray(collectibles.id, oldIds));
    });
  }

  await db.insert(collectibles).values(
    picks.map((p) => ({
      name: p.name,
      teamId: p.teamId,
      tier: "legendary",
      pointsCost: LEGENDARY_COST,
      imageUrl: p.imageUrl,
    }))
  );

  console.log(`\ninserted ${picks.length} new legendary collectibles. Done.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("replace-legendary-catalog failed:", err);
  process.exit(1);
});
