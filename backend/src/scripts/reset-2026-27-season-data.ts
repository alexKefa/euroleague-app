import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, playerGameStats, shotEvents, predictions, roundRewards, players } from "../db/schema.js";

// One-off pre-season cleanup (2026-09-02): the 2026-27 schedule/rosters were
// synced early (see CLAUDE.md's season-transition note and
// scripts/check-2026-27.ts), but rounds 2-5 also carried leftover dev/test
// data — games marked "final" with fabricated scores despite tipoff dates
// weeks in the future (Sept 29 - Oct 13), plus fabricated player_game_stats,
// real predictions made against those fake results, and round_rewards
// grants for "completing" round 2-4 off the back of them. Run once, before
// the real season actually starts. Always run scripts/backup-db.ts first —
// this deletes rows.
async function main() {
  const bogusGames = await db
    .select({ id: games.id, round: games.round })
    .from(games)
    .where(and(eq(games.season, "2026-27"), eq(games.status, "final")));

  if (bogusGames.length === 0) {
    console.log("No final 2026-27 games found — nothing to revert.");
  } else {
    const ids = bogusGames.map((g) => g.id);
    const rounds = [...new Set(bogusGames.map((g) => g.round).filter((r): r is number => r != null))];
    console.log(`Reverting ${ids.length} fake-final 2026-27 game(s) across round(s) ${rounds.join(", ")}...`);

    const delStats = await db.delete(playerGameStats).where(inArray(playerGameStats.gameId, ids)).returning({ id: playerGameStats.id });
    console.log(`  deleted ${delStats.length} player_game_stats row(s)`);

    const delShots = await db.delete(shotEvents).where(inArray(shotEvents.gameId, ids)).returning({ id: shotEvents.id });
    console.log(`  deleted ${delShots.length} shot_events row(s)`);

    const delPreds = await db.delete(predictions).where(inArray(predictions.gameId, ids)).returning({ id: predictions.id });
    console.log(`  deleted ${delPreds.length} prediction(s) made against them`);

    // Only rounds that were fully "complete" via the fake data could have
    // triggered a round_rewards grant (checkAndGrantRoundRewards requires
    // every game in the round to be final) — deleting those ledger rows
    // lets the real completion of that round grant normally later, rather
    // than finding a claim already on file and silently skipping it.
    if (rounds.length > 0) {
      const delRewards = await db
        .delete(roundRewards)
        .where(and(eq(roundRewards.season, "2026-27"), inArray(roundRewards.round, rounds)))
        .returning({ id: roundRewards.id, userId: roundRewards.userId, round: roundRewards.round });
      console.log(`  deleted ${delRewards.length} round_rewards ledger row(s) (the cards/packs already granted from them are left in place)`);
    }

    await db
      .update(games)
      .set({ status: "scheduled", homeScore: null, awayScore: null, quarter: null, gameClockSeconds: null })
      .where(inArray(games.id, ids));
    console.log(`  reverted ${ids.length} game(s) to "scheduled"`);
  }

  const photoReset = await db
    .update(players)
    .set({ photoUrl: null })
    .returning({ id: players.id });
  console.log(`Cleared photoUrl on ${photoReset.length} player row(s) — the PlayerPhotoComponent placeholder shows until player_stats_sync.py repopulates them from real 2026-27 games.`);

  process.exit(0);
}

main().catch((err) => {
  console.error("reset-2026-27-season-data failed:", err);
  process.exit(1);
});
