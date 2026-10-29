// Account deletion (2026-10-12). Anonymizes, never hard-deletes: the users
// row stays as a tombstone so shared history (battles, trades, league
// tables, other people's records) keeps its foreign keys, while everything
// that identifies the person is erased. Spec:
// docs/superpowers/specs/2026-10-12-account-deletion-design.md
// Checked by scripts/check-account-deletion.ts.
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { forfeitDuelsForDeletedUser } from "./duels.js";

export type DeleteAccountResult =
  | { ok: true; cancelledTrades: { id: string; otherUserId: string }[]; cancelledBattles: { id: string; otherUserId: string }[]; notifyDuels: () => void }
  | { ok: false; status: 400 | 404 | 409; code: "USERNAME_MISMATCH" | "NOT_FOUND" | "ALREADY_DELETED" };

// Rows that are only about this person, removed outright.
const PERSONAL_TABLES = [
  "push_subscriptions",
  "device_tokens",
  "league_members",
  "favorites",
  "favorite_players",
  "push_preferences",
  "watch_pins",
  "game_alerts",
] as const;

/**
 * Deletes (anonymizes) a user who typed their username to confirm. The
 * typed name is trimmed and compared case-sensitively. One transaction;
 * the user row is locked first, so a second delete at the same moment
 * waits and then gets ALREADY_DELETED.
 */
export async function deleteAccount(userId: string, confirmUsername: string): Promise<DeleteAccountResult> {
  const result = await db.transaction(async (tx) => {
    const [user] = await tx.execute<{ username: string; deleted_at: string | null }>(
      sql`select username, deleted_at from users where id = ${userId} for update`
    );
    if (!user) return { ok: false, status: 404, code: "NOT_FOUND" } as const;
    if (user.deleted_at) return { ok: false, status: 409, code: "ALREADY_DELETED" } as const;
    if (confirmUsername.trim() !== user.username) return { ok: false, status: 400, code: "USERNAME_MISMATCH" } as const;

    // '!' is never a valid bcrypt hash, so no password can match it.
    await tx.execute(sql`
      update users set
        email = 'deleted-' || id || '@deleted.invalid',
        username = 'deleted-' || left(id::text, 8),
        password_hash = '!',
        avatar_url = null,
        favorite_team_id = null,
        referral_code = null,
        password_reset_token_hash = null,
        password_reset_token_expires_at = null,
        showcase_collectible_ids = '[]'::jsonb,
        deleted_at = now()
      where id = ${userId}
    `);
    for (const table of PERSONAL_TABLES) {
      await tx.execute(sql`delete from ${sql.raw(table)} where user_id = ${userId}`);
    }
    // The cards stay, but off the marketplace: nobody can answer an offer
    // made to a deleted account (review fix 2026-10-12).
    await tx.execute(sql`update user_collectibles set tradeable = false, wishlist = '[]'::jsonb where user_id = ${userId}`);

    // Close what other people are waiting on.
    const trades = await tx.execute<{ id: string; from_user_id: string; to_user_id: string }>(sql`
      update trade_offers set status = 'cancelled', responded_at = now()
      where status = 'pending' and (from_user_id = ${userId} or to_user_id = ${userId})
      returning id, from_user_id, to_user_id
    `);
    const battles = await tx.execute<{ id: string; challenger_user_id: string; opponent_user_id: string }>(sql`
      update battles set status = 'cancelled', responded_at = now()
      where status = 'pending' and (challenger_user_id = ${userId} or opponent_user_id = ${userId})
      returning id, challenger_user_id, opponent_user_id
    `);

    // Four Quarters duels: cancel open/pending, forfeit active ones, drop ratings.
    const duelWork = await forfeitDuelsForDeletedUser(userId, tx);

    return {
      ok: true,
      notifyDuels: duelWork.notify,
      cancelledTrades: [...trades].map((t) => ({ id: t.id, otherUserId: t.from_user_id === userId ? t.to_user_id : t.from_user_id })),
      cancelledBattles: [...battles].map((b) => ({
        id: b.id,
        otherUserId: b.challenger_user_id === userId ? b.opponent_user_id : b.challenger_user_id,
      })),
    } as const;
  });
  // SSE only after the transaction has committed.
  if (result.ok) {
    try {
      result.notifyDuels();
    } catch (err) {
      console.error("duel notify after account deletion failed:", err);
    }
  }
  return result;
}
