import { db } from "../db/client.js";
import { collectibles, players, teams } from "../db/schema.js";
import { eq } from "drizzle-orm";

// One-off (2026-09-02): collectibles.teamId is a snapshot taken when
// scripts/expand-collectibles.ts first created each card (matched by name
// against players.teamId at that time). That script only ever INSERTs for
// a (teamId, tier, name) key it hasn't seen before — it never re-checks an
// existing row when a player transfers teams — so a full 2025-26 -> 2026-27
// offseason's worth of real transfers left 117 of 437 collectibles pointing
// at a player's old team (confirmed 2026-09-02, including every AS Monaco
// card: Monaco isn't in the 2026-27 competition at all, so every one of its
// 21 cards was for a player who has since moved somewhere else). Safe to
// correct directly now that scripts/reset-economy-full.ts already wiped
// every user_collectibles/trade/pack-opening row referencing these ids —
// this only rewrites teamId in place, same card identity (id, name, tier,
// pointsCost), so it would have been risky to do this before that reset.
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "PETERS, ALEC" -> "alec peters" (same transform expand-collectibles.ts uses to produce collectible.name, just normalized) */
function playerKey(rawName: string): string {
  const [last, first] = rawName.split(",").map((s) => s.trim());
  if (!first) return normalize(rawName);
  return normalize(`${first} ${last}`);
}

async function main() {
  const allCollectibles = await db.select().from(collectibles);
  const allPlayers = await db.select({ name: players.name, teamId: players.teamId }).from(players);
  const allTeams = await db.select({ id: teams.id, code: teams.code }).from(teams);
  const codeById = new Map(allTeams.map((t) => [t.id, t.code]));

  const teamIdByPlayerKey = new Map<string, string>();
  for (const p of allPlayers) {
    teamIdByPlayerKey.set(playerKey(p.name), p.teamId);
  }

  let updated = 0;
  let unmatched = 0;
  for (const c of allCollectibles) {
    const actualTeamId = teamIdByPlayerKey.get(normalize(c.name));
    if (!actualTeamId) {
      unmatched++;
      continue;
    }
    if (actualTeamId !== c.teamId) {
      console.log(`  ${c.name} (${c.tier}): ${codeById.get(c.teamId)} -> ${codeById.get(actualTeamId)}`);
      await db.update(collectibles).set({ teamId: actualTeamId }).where(eq(collectibles.id, c.id));
      updated++;
    }
  }

  console.log(`\nUpdated ${updated} collectible(s), ${unmatched} unmatched by name (left as-is).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("fix-collectible-teams failed:", err);
  process.exit(1);
});
