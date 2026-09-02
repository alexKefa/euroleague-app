import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, playerGameStats, teams } from "../db/schema.js";

// One-off (but reusable) cleanup for liveScoreSimulator.ts test runs. The
// simulator ticks a real `games` row through live -> final and writes
// quarter/gameClockSeconds along the way; the real sync (games_sync.py)
// never touches those two columns (see the comment on games.quarter in
// schema.ts), so status='live', or status='final' with quarter still set,
// is a reliable signature of a simulator-touched row rather than a real
// result. Reverts those games to a clean "scheduled" state and drops the
// fabricated player_game_stats rows the simulator wrote for them.

async function main() {
  const affected = await db
    .select({
      id: games.id,
      season: games.season,
      gameCode: games.gameCode,
      tipoffAt: games.tipoffAt,
      status: games.status,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
      homeTeam: teams.name,
    })
    .from(games)
    .innerJoin(teams, eq(teams.id, games.homeTeamId))
    .where(or(eq(games.status, "live"), and(eq(games.status, "final"), isNotNull(games.quarter))));

  if (affected.length === 0) {
    console.log("No simulator-touched games found — nothing to reset.");
    return;
  }

  console.log(`Found ${affected.length} simulator-touched game(s):`);
  for (const g of affected) {
    console.log(
      `  ${g.season} #${g.gameCode} — ${g.homeTeam} — ${g.status} ${g.homeScore ?? "?"}-${g.awayScore ?? "?"} (tipoff ${g.tipoffAt.toISOString()})`
    );
  }

  const ids = affected.map((g) => g.id);

  await db.delete(playerGameStats).where(inArray(playerGameStats.gameId, ids));
  await db
    .update(games)
    .set({ status: "scheduled", homeScore: null, awayScore: null, quarter: null, gameClockSeconds: null })
    .where(inArray(games.id, ids));

  console.log(`Reset ${ids.length} game(s) back to "scheduled" and cleared their fabricated box scores.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("reset-simulated-games failed:", err);
  process.exit(1);
});
