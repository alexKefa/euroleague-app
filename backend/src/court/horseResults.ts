// Saves a finished H-O-R-S-E game: one transaction, two statements
// (the game row, then every player's row in one multi-row insert).
import { db } from "../db/client.js";
import { horseGamePlayers, horseGames } from "../db/schema.js";
import { lettersOf, type HorseResult } from "../../../shared/court/horse.js";

export async function saveHorseResult(courtId: string, result: HorseResult, userIdBySession: Map<string, string>): Promise<void> {
  const userId = (sid: string | null) => (sid ? userIdBySession.get(sid) ?? null : null);
  await db.transaction(async (tx) => {
    const [game] = await tx
      .insert(horseGames)
      .values({
        courtId,
        winnerUserId: userId(result.winnerId),
        startedAt: new Date(result.startedAt),
        endedAt: new Date(result.endedAt),
      })
      .returning({ id: horseGames.id });
    const rows = result.players
      .map((p) => ({ uid: userId(p.id), p }))
      .filter((r): r is { uid: string; p: HorseResult["players"][number] } => r.uid !== null)
      .map(({ uid, p }) => ({ gameId: game!.id, userId: uid, finalLetters: lettersOf(p.letters), placement: p.placement }));
    if (rows.length) await tx.insert(horseGamePlayers).values(rows);
  });
}
