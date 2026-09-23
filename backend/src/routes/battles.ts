import { Router } from "express";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { battles, collectibles, userCollectibles, users, leagueMembers, pointAdjustments, teams } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { sendToUser } from "../realtime/hub.js";
import { BATTLE_STAKE_BASE, computeCardPowers, computeStakeForWinProb, resolveDuel } from "../services/battles.js";
import { getUserPoints } from "../services/points.js";

export const battlesRouter = Router();

// Pushed to the other side whenever a challenge changes state, same pattern
// as trades.ts's notifyTradeUpdate.
function notifyBattleUpdate(userIds: string[], battleId: string, reason: string): void {
  for (const userId of new Set(userIds)) {
    sendToUser(userId, "battle-update", { battleId, reason });
  }
}

async function isLeagueMember(leagueId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: leagueMembers.id })
    .from(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId)))
    .limit(1);
  return !!row;
}

// Validates a single submitted card: owned by userId, not a coach card (no
// real PIR to weigh a coach's duel power against — coaches aren't in
// `players`).
async function validateCard(
  userId: string,
  collectibleId: unknown
): Promise<
  | { ok: true; row: { collectibleId: string; teamId: string; name: string; tier: string } }
  | { ok: false; status: number; error: string; code: string }
> {
  if (typeof collectibleId !== "string") {
    return { ok: false, status: 400, error: "collectibleId is required", code: "INVALID_CARD" };
  }

  const [row] = await db
    .select({
      collectibleId: userCollectibles.collectibleId,
      teamId: collectibles.teamId,
      name: collectibles.name,
      tier: collectibles.tier,
    })
    .from(userCollectibles)
    .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
    .where(and(eq(userCollectibles.userId, userId), eq(userCollectibles.collectibleId, collectibleId)))
    .limit(1);

  if (!row) {
    return { ok: false, status: 400, error: "You don't own that card", code: "CARD_NOT_OWNED" };
  }
  if (row.tier === "coach") {
    return { ok: false, status: 400, error: "Coach cards can't be used in duels", code: "COACH_CARD_NOT_ALLOWED" };
  }
  return { ok: true, row };
}

battlesRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { leagueId, opponentUserId, collectibleId } = req.body ?? {};
    if (typeof leagueId !== "string" || typeof opponentUserId !== "string") {
      res.status(400).json({ error: "leagueId and opponentUserId are required", code: "INVALID_REQUEST_BODY" });
      return;
    }
    if (opponentUserId === req.userId) {
      res.status(400).json({ error: "You can't battle yourself", code: "SELF_BATTLE" });
      return;
    }
    if (!(await isLeagueMember(leagueId, req.userId!)) || !(await isLeagueMember(leagueId, opponentUserId))) {
      res.status(403).json({ error: "Both players must be members of this league", code: "NOT_LEAGUE_MEMBERS" });
      return;
    }

    const card = await validateCard(req.userId!, collectibleId);
    if (!card.ok) {
      res.status(card.status).json({ error: card.error, code: card.code });
      return;
    }

    // Just a basic sanity gate here — the exact stake depends on the
    // matchup, which isn't known until the opponent picks their own card,
    // so the precise afford-your-potential-loss check happens at accept
    // time instead (below).
    if ((await getUserPoints(req.userId!)) < BATTLE_STAKE_BASE) {
      res.status(400).json({ error: `You need at least ${BATTLE_STAKE_BASE} points to challenge someone`, code: "INSUFFICIENT_POINTS" });
      return;
    }

    const [battle] = await db
      .insert(battles)
      .values({ leagueId, challengerUserId: req.userId!, opponentUserId, challengerCollectibleId: card.row.collectibleId })
      .returning();

    notifyBattleUpdate([opponentUserId], battle.id, "challenged");
    res.status(201).json({ id: battle.id, status: battle.status });
  } catch (err) {
    console.error("POST /api/battles failed:", err);
    res.status(500).json({ error: "Failed to create battle challenge", code: "FAILED_TO_CREATE_BATTLE" });
  }
});

// Accepting resolves the duel immediately — there's no waiting state in
// this version. Both cards' powers (and from them, the real variable
// stake — see computeStakeForWinProb) are computed right now, not frozen
// earlier, then a single weighted-random roll decides it, all inside one
// transaction with the battle row locked so a double-accept can't roll
// twice or transfer the stake twice.
battlesRouter.post("/:id/accept", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const card = await validateCard(req.userId!, req.body?.collectibleId);
    if (!card.ok) {
      res.status(card.status).json({ error: card.error, code: card.code });
      return;
    }

    const outcome = await db.transaction(async (tx) => {
      const [battle] = await tx.select().from(battles).where(eq(battles.id, id)).for("update");
      if (!battle) return { status: 404, error: "Battle not found", code: "BATTLE_NOT_FOUND" } as const;
      if (battle.opponentUserId !== req.userId) {
        return { status: 403, error: "Not your challenge to accept", code: "NOT_YOUR_BATTLE" } as const;
      }
      if (battle.status !== "pending") {
        return { status: 400, error: "This challenge is no longer pending", code: "BATTLE_NOT_PENDING" } as const;
      }

      const [challengerCard] = await tx
        .select({ teamId: collectibles.teamId, name: collectibles.name, tier: collectibles.tier })
        .from(collectibles)
        .where(eq(collectibles.id, battle.challengerCollectibleId))
        .limit(1);

      const [challengerPower, opponentPower] = await computeCardPowers([challengerCard, card.row]);
      const challengerWinProb = challengerPower / (challengerPower + opponentPower);
      const opponentWinProb = 1 - challengerWinProb;
      // What each side would owe if they lose — known now, before the roll,
      // since both cards (and so both win probabilities) are already fixed.
      const stakeIfChallengerWins = computeStakeForWinProb(challengerWinProb); // what the opponent would owe
      const stakeIfOpponentWins = computeStakeForWinProb(opponentWinProb); // what the challenger would owe

      // Re-check the challenger can still cover *their* potential loss too
      // — time may have passed since they sent the challenge (spent points
      // on a pack, lost another duel, etc.), same "re-verify at accept
      // time" caution trades.ts's own accept handler already applies to
      // card ownership.
      if ((await getUserPoints(battle.challengerUserId)) < stakeIfOpponentWins) {
        return { status: 400, error: "The challenger no longer has enough points to cover this duel", code: "CHALLENGER_INSUFFICIENT_POINTS" } as const;
      }
      if ((await getUserPoints(req.userId!)) < stakeIfChallengerWins) {
        return {
          status: 400,
          error: `You need at least ${stakeIfChallengerWins} points to risk against this card`,
          code: "INSUFFICIENT_POINTS",
        } as const;
      }

      const winnerSide = resolveDuel(challengerPower, opponentPower);
      const winnerUserId = winnerSide === "challenger" ? battle.challengerUserId : battle.opponentUserId;
      const loserUserId = winnerSide === "challenger" ? battle.opponentUserId : battle.challengerUserId;
      const stake = winnerSide === "challenger" ? stakeIfChallengerWins : stakeIfOpponentWins;

      await tx
        .update(battles)
        .set({
          opponentCollectibleId: card.row.collectibleId,
          status: "finished",
          winnerUserId,
          stakePoints: stake,
          respondedAt: new Date(),
          finishedAt: new Date(),
        })
        .where(eq(battles.id, id));

      // A real stake, not a minted reward — see services/battles.ts's doc
      // comment for the farming exploit this closes. Both rows count
      // toward ranking (the default): a duel result is a competitive
      // outcome, not a redemption spend, so it should move the leaderboard
      // like everything else that isn't a store purchase.
      await tx.insert(pointAdjustments).values([
        { userId: winnerUserId, points: stake, reason: "Card battle win", createdByUserId: winnerUserId },
        { userId: loserUserId, points: -stake, reason: "Card battle loss", createdByUserId: winnerUserId },
      ]);

      return { status: 200, challengerUserId: battle.challengerUserId } as const;
    });

    if (outcome.status !== 200) {
      res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
      return;
    }
    notifyBattleUpdate([outcome.challengerUserId], id, "finished");
    res.json({ status: "finished" });
  } catch (err) {
    console.error("POST /api/battles/:id/accept failed:", err);
    res.status(500).json({ error: "Failed to accept battle", code: "FAILED_TO_ACCEPT_BATTLE" });
  }
});

battlesRouter.post("/:id/decline", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [battle] = await db.select().from(battles).where(eq(battles.id, id)).limit(1);
    if (!battle) {
      res.status(404).json({ error: "Battle not found", code: "BATTLE_NOT_FOUND" });
      return;
    }
    if (battle.opponentUserId !== req.userId) {
      res.status(403).json({ error: "Not your challenge to decline", code: "NOT_YOUR_BATTLE" });
      return;
    }

    const [declined] = await db
      .update(battles)
      .set({ status: "declined", respondedAt: new Date() })
      .where(and(eq(battles.id, id), eq(battles.status, "pending")))
      .returning();
    if (!declined) {
      res.status(400).json({ error: "This challenge is no longer pending", code: "BATTLE_NOT_PENDING" });
      return;
    }

    notifyBattleUpdate([declined.challengerUserId], id, "declined");
    res.json({ status: "declined" });
  } catch (err) {
    console.error("POST /api/battles/:id/decline failed:", err);
    res.status(500).json({ error: "Failed to decline battle", code: "FAILED_TO_DECLINE_BATTLE" });
  }
});

battlesRouter.post("/:id/cancel", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [battle] = await db.select().from(battles).where(eq(battles.id, id)).limit(1);
    if (!battle) {
      res.status(404).json({ error: "Battle not found", code: "BATTLE_NOT_FOUND" });
      return;
    }
    if (battle.challengerUserId !== req.userId) {
      res.status(403).json({ error: "Not your challenge to cancel", code: "NOT_YOUR_BATTLE" });
      return;
    }

    const [cancelled] = await db
      .update(battles)
      .set({ status: "cancelled", respondedAt: new Date() })
      .where(and(eq(battles.id, id), eq(battles.status, "pending")))
      .returning();
    if (!cancelled) {
      res.status(400).json({ error: "This challenge is no longer pending", code: "BATTLE_NOT_PENDING" });
      return;
    }

    notifyBattleUpdate([cancelled.opponentUserId], id, "cancelled");
    res.json({ status: "cancelled" });
  } catch (err) {
    console.error("POST /api/battles/:id/cancel failed:", err);
    res.status(500).json({ error: "Failed to cancel battle", code: "FAILED_TO_CANCEL_BATTLE" });
  }
});

const challengerUser = alias(users, "challenger_user");
const opponentUser = alias(users, "opponent_user");
const challengerCard = alias(collectibles, "challenger_card");
const opponentCard = alias(collectibles, "opponent_card");
const challengerTeam = alias(teams, "challenger_team");
const opponentTeam = alias(teams, "opponent_team");

// Every battle the current user is part of, most recent first — the
// challenge inbox/history list, optionally scoped to one league (the
// League Detail "Battles" tab passes ?leagueId=). Carries the challenger's
// card (2026-09-22, direct ask: this list was text-only, no photo at all)
// so the list itself previews the matchup instead of just names.
battlesRouter.get("/mine", requireAuth, async (req, res) => {
  try {
    const { leagueId } = req.query;
    const conditions = [or(eq(battles.challengerUserId, req.userId!), eq(battles.opponentUserId, req.userId!))!];
    if (typeof leagueId === "string") conditions.push(eq(battles.leagueId, leagueId));

    const rows = await db
      .select({
        battle: battles,
        challengerName: challengerUser.username,
        opponentName: opponentUser.username,
        challengerCard,
        challengerTeam,
      })
      .from(battles)
      .innerJoin(challengerUser, eq(battles.challengerUserId, challengerUser.id))
      .innerJoin(opponentUser, eq(battles.opponentUserId, opponentUser.id))
      .innerJoin(challengerCard, eq(battles.challengerCollectibleId, challengerCard.id))
      .innerJoin(challengerTeam, eq(challengerCard.teamId, challengerTeam.id))
      .where(and(...conditions))
      .orderBy(desc(battles.createdAt))
      .limit(40);

    res.json(
      rows.map(({ battle, challengerName, opponentName, challengerCard: card, challengerTeam: team }) => ({
        id: battle.id,
        leagueId: battle.leagueId,
        status: battle.status,
        direction: battle.challengerUserId === req.userId ? "outgoing" : "incoming",
        counterpartyName: battle.challengerUserId === req.userId ? opponentName : challengerName,
        winnerUserId: battle.winnerUserId,
        createdAt: battle.createdAt,
        challengerCard: { id: card.id, name: card.name, tier: card.tier, imageUrl: card.imageUrl, team: { id: team.id, code: team.code, primaryColor: team.primaryColor } },
      }))
    );
  } catch (err) {
    console.error("GET /api/battles/mine failed:", err);
    res.status(500).json({ error: "Failed to load battles", code: "FAILED_TO_LOAD_BATTLES" });
  }
});

// A lightweight power-score preview for cards you own (2026-09-22, direct
// ask: "stats should also count for the coin flip" — they already did
// (services/battles.ts's computeCardPowers factors real PIR in alongside
// tier), this just surfaces that visibly instead of it only happening
// invisibly server-side at accept time. One request covers every candidate
// card in the picker at once, not a round trip per tap.
battlesRouter.post("/card-powers", requireAuth, async (req, res) => {
  try {
    const { collectibleIds } = req.body ?? {};
    if (!Array.isArray(collectibleIds) || collectibleIds.length === 0 || !collectibleIds.every((id) => typeof id === "string")) {
      res.status(400).json({ error: "collectibleIds must be a non-empty array", code: "INVALID_REQUEST_BODY" });
      return;
    }

    const rows = await db
      .select({
        collectibleId: userCollectibles.collectibleId,
        teamId: collectibles.teamId,
        name: collectibles.name,
        tier: collectibles.tier,
      })
      .from(userCollectibles)
      .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
      .where(and(eq(userCollectibles.userId, req.userId!), inArray(userCollectibles.collectibleId, collectibleIds)));

    const nonCoach = rows.filter((r) => r.tier !== "coach");
    const powers = await computeCardPowers(nonCoach);
    res.json({ powers: nonCoach.map((r, i) => ({ collectibleId: r.collectibleId, power: powers[i] })) });
  } catch (err) {
    console.error("POST /api/battles/card-powers failed:", err);
    res.status(500).json({ error: "Failed to compute card powers", code: "FAILED_TO_COMPUTE_POWERS" });
  }
});

// Full duel state — a pure read, no side effects (resolution already
// happened synchronously at accept time). opponentCard/opponentTeam are
// null until accepted.
battlesRouter.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [row] = await db
      .select({
        battle: battles,
        challengerName: challengerUser.username,
        opponentName: opponentUser.username,
        challengerCard,
        challengerTeam,
        opponentCard,
        opponentTeam,
      })
      .from(battles)
      .innerJoin(challengerUser, eq(battles.challengerUserId, challengerUser.id))
      .innerJoin(opponentUser, eq(battles.opponentUserId, opponentUser.id))
      .innerJoin(challengerCard, eq(battles.challengerCollectibleId, challengerCard.id))
      .innerJoin(challengerTeam, eq(challengerCard.teamId, challengerTeam.id))
      .leftJoin(opponentCard, eq(battles.opponentCollectibleId, opponentCard.id))
      .leftJoin(opponentTeam, eq(opponentCard.teamId, opponentTeam.id))
      .where(eq(battles.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Battle not found", code: "BATTLE_NOT_FOUND" });
      return;
    }
    const { battle, challengerName, opponentName } = row;
    if (battle.challengerUserId !== req.userId && battle.opponentUserId !== req.userId) {
      res.status(403).json({ error: "Not your battle", code: "NOT_YOUR_BATTLE" });
      return;
    }

    // Same power score used to actually decide the duel at accept time —
    // shown here too (2026-09-22) so the opponent can see how their own
    // card choice stacks up against it, not just its name/photo.
    const [challengerPower] = await computeCardPowers([row.challengerCard]);

    res.json({
      id: battle.id,
      leagueId: battle.leagueId,
      status: battle.status,
      challengerUserId: battle.challengerUserId,
      challengerName,
      opponentUserId: battle.opponentUserId,
      opponentName,
      winnerUserId: battle.winnerUserId,
      stakePoints: battle.stakePoints,
      challengerPower,
      challengerCard: {
        id: row.challengerCard.id,
        name: row.challengerCard.name,
        tier: row.challengerCard.tier,
        imageUrl: row.challengerCard.imageUrl,
        team: { id: row.challengerTeam!.id, code: row.challengerTeam!.code, primaryColor: row.challengerTeam!.primaryColor },
      },
      opponentCard: row.opponentCard
        ? {
            id: row.opponentCard.id,
            name: row.opponentCard.name,
            tier: row.opponentCard.tier,
            imageUrl: row.opponentCard.imageUrl,
            team: { id: row.opponentTeam!.id, code: row.opponentTeam!.code, primaryColor: row.opponentTeam!.primaryColor },
          }
        : null,
    });
  } catch (err) {
    console.error("GET /api/battles/:id failed:", err);
    res.status(500).json({ error: "Failed to load battle", code: "FAILED_TO_LOAD_BATTLE" });
  }
});
