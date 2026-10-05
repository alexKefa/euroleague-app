import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { ownedPacks } from "../db/schema.js";

// First-pick onboarding (2026-10-05). 16 of 36 signups had never made a
// single pick, so the core game never started for them. A new user who
// saves their first FIRST_PICKS_TARGET winner picks gets one free pack.
// One-off per user (users.first_picks_reward_at), same as the welcome and
// referral packs, so it doesn't change the season economy.
export const FIRST_PICKS_TARGET = 3;

export interface FirstPicksStatus {
  picks: number;
  target: number;
  claimed: boolean;
}

export async function getFirstPicksStatus(userId: string): Promise<FirstPicksStatus> {
  const [row] = await db.execute<{ picks: number; claimed: boolean }>(sql`
    select
      (select count(*)::int from predictions where user_id = ${userId}) as picks,
      (select first_picks_reward_at is not null from users where id = ${userId}) as claimed
  `);
  return { picks: row?.picks ?? 0, target: FIRST_PICKS_TARGET, claimed: row?.claimed ?? true };
}

/**
 * Claim-first: one conditional UPDATE both checks the pick count and stamps
 * the claim, so concurrent calls can't grant twice. Returns the new pack's
 * id, or null when not (yet) eligible or already claimed.
 */
export async function checkAndGrantFirstPicksReward(userId: string): Promise<string | null> {
  const claimed = await db.execute<{ id: string }>(sql`
    update users set first_picks_reward_at = now()
    where id = ${userId} and first_picks_reward_at is null
      and (select count(*) from predictions where user_id = ${userId}) >= ${FIRST_PICKS_TARGET}
    returning id
  `);
  if (claimed.length === 0) return null;
  const [pack] = await db.insert(ownedPacks).values({ userId, packType: "firstPicks" }).returning({ id: ownedPacks.id });
  return pack.id;
}
