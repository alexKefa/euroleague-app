import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, teams, players } from "../db/schema.js";

const SEASON = "2026-27";

async function main() {
  const seasonGames = await db.select().from(games).where(eq(games.season, SEASON));
  const rounds = [...new Set(seasonGames.map((g) => g.round))].sort((a, b) => (a ?? 0) - (b ?? 0));
  const teamIds = new Set<string>();
  seasonGames.forEach((g) => {
    teamIds.add(g.homeTeamId);
    teamIds.add(g.awayTeamId);
  });

  console.log(`games in ${SEASON}: ${seasonGames.length}`);
  console.log(`distinct rounds: ${rounds.length} (min ${rounds[0]}, max ${rounds[rounds.length - 1]})`);
  console.log(`distinct teams appearing in ${SEASON} games: ${teamIds.size}`);

  const allTeams = await db.select().from(teams);
  console.log(`\nteams table total rows: ${allTeams.length}`);

  const playerCounts = await db
    .select({ teamId: players.teamId, cnt: sql<number>`count(*)` })
    .from(players)
    .groupBy(players.teamId);
  const countByTeam = new Map(playerCounts.map((p) => [p.teamId, Number(p.cnt)]));

  console.log(`\nTeams appearing in ${SEASON} schedule, with current roster size:`);
  for (const t of allTeams) {
    if (teamIds.has(t.id)) {
      console.log(`  ${t.code.padEnd(6)} ${t.name.padEnd(38)} players: ${countByTeam.get(t.id) ?? 0}`);
    }
  }

  const teamsNotInSeason = allTeams.filter((t) => !teamIds.has(t.id));
  if (teamsNotInSeason.length > 0) {
    console.log(`\nTeams in DB but NOT appearing in ${SEASON} games (${teamsNotInSeason.length}):`);
    for (const t of teamsNotInSeason) {
      console.log(`  ${t.code.padEnd(6)} ${t.name.padEnd(38)} players: ${countByTeam.get(t.id) ?? 0}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
