import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { COACH_MILESTONE_INTERVAL, FANTASY_MILESTONE_INTERVAL, LEGENDARY_MILESTONE_INTERVAL } from "./cards.js";

/**
 * Why an unopened pack is in "My Packs" (2026-09-30, direct request after
 * a user found an unexplained Final Four pack there: "show next to pack
 * that this was granted for this reason"). owned_packs has no source column
 * of its own, so this is derived: the reward ledgers (round_rewards and the
 * three milestone tables) point at their pack via owned_pack_id; a wheel
 * spin inserts its wheel_spins row and its pack in one transaction, so both
 * share the same defaultNow() timestamp; welcome/referral/qr packs have
 * their own pack types. A promo code can grant any pack type, so it's
 * matched by a redemption within a few seconds of the pack. Admin test
 * grants match none of these and come back as null (no caption).
 *
 * Milestone counts use today's intervals, so a milestone granted before an
 * interval retune shows the current threshold, not the one it was earned at.
 */
export type PackSource =
  | { kind: "perfectRound" | "greatRound"; round: number }
  | { kind: "pickMilestone" | "coachMilestone" | "fantasyMilestone"; count: number }
  | { kind: "wheel" | "welcome" | "referral" | "promo" };

export interface UnopenedPackWithSource {
  id: string;
  packType: string;
  acquiredAt: Date;
  source: PackSource | null;
}

interface Row extends Record<string, unknown> {
  id: string;
  pack_type: string;
  acquired_at: string | Date;
  reward_round: number | null;
  pick_milestone: number | null;
  coach_milestone: number | null;
  fantasy_milestone: number | null;
  from_wheel: boolean;
  from_promo: boolean;
}

function sourceFor(r: Row): PackSource | null {
  if (r.reward_round !== null) {
    return { kind: r.pack_type === "wheelLegendary" ? "perfectRound" : "greatRound", round: r.reward_round };
  }
  if (r.pick_milestone !== null) return { kind: "pickMilestone", count: r.pick_milestone * LEGENDARY_MILESTONE_INTERVAL };
  if (r.coach_milestone !== null) return { kind: "coachMilestone", count: r.coach_milestone * COACH_MILESTONE_INTERVAL };
  if (r.fantasy_milestone !== null) return { kind: "fantasyMilestone", count: r.fantasy_milestone * FANTASY_MILESTONE_INTERVAL };
  if (r.from_wheel) return { kind: "wheel" };
  if (r.pack_type === "welcomeBonus") return { kind: "welcome" };
  if (r.pack_type === "referralBonus") return { kind: "referral" };
  if (r.pack_type === "qrBonus" || r.from_promo) return { kind: "promo" };
  return null;
}

/** Every unopened pack this user has, newest first, each with its source — one round trip. */
export async function getUnopenedPacksWithSource(userId: string): Promise<UnopenedPackWithSource[]> {
  const rows = await db.execute<Row>(sql`
    select
      op.id,
      op.pack_type,
      op.acquired_at,
      (select rr.round from round_rewards rr where rr.owned_pack_id = op.id limit 1) as reward_round,
      (select lm.milestone_number from legendary_milestones lm where lm.owned_pack_id = op.id limit 1) as pick_milestone,
      (select cm.milestone_number from coach_milestones cm where cm.owned_pack_id = op.id limit 1) as coach_milestone,
      (select fm.milestone_number from fantasy_milestones fm where fm.owned_pack_id = op.id limit 1) as fantasy_milestone,
      exists (select 1 from wheel_spins ws where ws.user_id = op.user_id and ws.spun_at = op.acquired_at) as from_wheel,
      exists (
        select 1 from promo_code_redemptions pr
        where pr.user_id = op.user_id
          and pr.redeemed_at between op.acquired_at - interval '10 seconds' and op.acquired_at + interval '10 seconds'
      ) as from_promo
    from owned_packs op
    where op.user_id = ${userId} and op.opened_at is null
    order by op.acquired_at desc
  `);
  return rows.map((r) => ({
    id: r.id,
    packType: r.pack_type,
    acquiredAt: new Date(r.acquired_at),
    source: sourceFor(r),
  }));
}
