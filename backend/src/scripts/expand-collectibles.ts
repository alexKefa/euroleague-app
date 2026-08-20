/**
 * One-time (but idempotent — safe to re-run) catalog expansion: grows the
 * `collectibles` table from a hand-curated ~40 cards covering 2 teams to a
 * common + rare card for every real player across every team, plus one
 * legendary per team (the roster's top season PIR) for teams that don't
 * already have a legendary.
 *
 * Existing hand-curated rows are left untouched and matched by normalized
 * name + team so this never creates a duplicate for a player who already
 * has a card — critical since real users already own some of these
 * (user_collectibles, pack_openings reference collectible IDs by FK).
 *
 * Usage: npm run collectibles:expand
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, teams, collectibles, playerSeasonStats } from "../db/schema.js";

const COMMON_COST = 50;
const RARE_COST = 250;
const LEGENDARY_COST = 2500;
const SEASON = "2025-26";

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
  const allPlayers = await db.select().from(players);
  const allTeams = await db.select().from(teams);
  const teamById = new Map(allTeams.map((t) => [t.id, t]));

  const existing = await db.select().from(collectibles);
  // Key: `${teamId}::${tier}::${normalizedName}` -> exists
  const existingKeys = new Set(existing.map((c) => `${c.teamId}::${c.tier}::${normalize(c.name)}`));
  const legendaryTeamIds = new Set(existing.filter((c) => c.tier === "legendary").map((c) => c.teamId));

  const seasonStats = await db
    .select()
    .from(playerSeasonStats)
    .where(eq(playerSeasonStats.season, SEASON));
  const statsByPlayerId = new Map(seasonStats.map((s) => [s.playerId, s]));

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

  // One legendary per team that doesn't already have one — the roster's
  // top season PIR (playerSeasonStats.valuation), an objective "best
  // player" pick now that boxscore-derived stats are synced.
  const byTeam = new Map<string, typeof allPlayers>();
  for (const p of allPlayers) {
    const arr = byTeam.get(p.teamId) ?? [];
    arr.push(p);
    byTeam.set(p.teamId, arr);
  }

  for (const [teamId, roster] of byTeam) {
    if (legendaryTeamIds.has(teamId)) continue;
    const team = teamById.get(teamId);
    if (!team) continue;

    const ranked = roster
      .map((p) => ({ player: p, valuation: statsByPlayerId.get(p.id)?.valuation ?? -Infinity }))
      .sort((a, b) => b.valuation - a.valuation);
    const best = ranked[0];
    if (!best || best.valuation === -Infinity) continue; // no stats to rank by

    const name = displayName(best.player.name);
    const key = `${team.id}::legendary::${normalize(name)}`;
    if (existingKeys.has(key)) continue;

    await db.insert(collectibles).values({
      name,
      teamId: team.id,
      tier: "legendary",
      pointsCost: LEGENDARY_COST,
      imageUrl: best.player.photoUrl,
    });
    existingKeys.add(key);
    legendariesInserted++;
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
