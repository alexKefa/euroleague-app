import { Router } from "express";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { battles, collectibles, userCollectibles, users, leagues, leagueMembers, pointAdjustments, teams } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { sendToUser } from "../realtime/hub.js";
import { BATTLE_STAKE_BASE, computeCardPowerDetails, computeStakeForWinProb } from "../services/battles.js";
import { DUEL_STATS, DuelStat, getCardStatLines, isDuelStat, resolveStatDuel } from "../services/statDuel.js";
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
  | { ok: true; row: { collectibleId: string; teamId: string; name: string; tier: string; finish: string } }
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
      finish: userCollectibles.finish,
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
    const { leagueId, opponentUserId, collectibleId, stat } = req.body ?? {};
    if (typeof leagueId !== "string" || typeof opponentUserId !== "string") {
      res.status(400).json({ error: "leagueId and opponentUserId are required", code: "INVALID_REQUEST_BODY" });
      return;
    }
    if (!isDuelStat(stat)) {
      res.status(400).json({ error: `stat must be one of ${DUEL_STATS.join(", ")}`, code: "INVALID_STAT" });
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

    // The exact stake isn't known until the duel resolves (it depends on
    // both cards and both hidden categories), and it's capped at whatever
    // the loser has at that point — so entry only needs the base stake.
    if ((await getUserPoints(req.userId!)) < BATTLE_STAKE_BASE) {
      res.status(400).json({ error: `You need at least ${BATTLE_STAKE_BASE} points to challenge someone`, code: "INSUFFICIENT_POINTS" });
      return;
    }

    const [battle] = await db
      .insert(battles)
      .values({ leagueId, challengerUserId: req.userId!, opponentUserId, challengerCollectibleId: card.row.collectibleId, challengerStat: stat })
      .returning();

    notifyBattleUpdate([opponentUserId], battle.id, "challenged");
    res.status(201).json({ id: battle.id, status: battle.status });
  } catch (err) {
    console.error("POST /api/battles failed:", err);
    res.status(500).json({ error: "Failed to create battle challenge", code: "FAILED_TO_CREATE_BATTLE" });
  }
});

// Accepting resolves the stat duel immediately (services/statDuel.ts), all
// inside one transaction with the battle row locked so a double-accept
// can't resolve twice or transfer the stake twice. The stake is the same
// upset-scaled formula as before (computeStakeForWinProb on the winner's
// exact pre-draw win chance), capped at what the loser actually has — the
// challenger's category is hidden, so neither side can know its exact
// exposure up front the way the coin flip's visible powers allowed.
battlesRouter.post("/:id/accept", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const stat = req.body?.stat;
    if (!isDuelStat(stat)) {
      res.status(400).json({ error: `stat must be one of ${DUEL_STATS.join(", ")}`, code: "INVALID_STAT" });
      return;
    }
    const card = await validateCard(req.userId!, req.body?.collectibleId);
    if (!card.ok) {
      res.status(card.status).json({ error: card.error, code: card.code });
      return;
    }
    if ((await getUserPoints(req.userId!)) < BATTLE_STAKE_BASE) {
      res.status(400).json({ error: `You need at least ${BATTLE_STAKE_BASE} points to battle`, code: "INSUFFICIENT_POINTS" });
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

      // The challenger's own finish, from their current ownership row —
      // null (standard) if they've since traded the card away.
      const [challengerCardRow] = await tx
        .select({ teamId: collectibles.teamId, name: collectibles.name, tier: collectibles.tier, finish: userCollectibles.finish })
        .from(collectibles)
        .leftJoin(
          userCollectibles,
          and(eq(userCollectibles.collectibleId, collectibles.id), eq(userCollectibles.userId, battle.challengerUserId))
        )
        .where(eq(collectibles.id, battle.challengerCollectibleId))
        .limit(1);

      const [challengerLine, opponentLine] = await getCardStatLines([challengerCardRow, card.row]);
      // A challenge sent under the v3 coin flip has no category; PIR is the
      // closest thing to the old overall power.
      const challengerStat: DuelStat = isDuelStat(battle.challengerStat) ? battle.challengerStat : "pir";
      const duel = resolveStatDuel(challengerStat, stat, challengerLine.boosted, opponentLine.boosted);

      const winnerUserId = duel.winner === "challenger" ? battle.challengerUserId : battle.opponentUserId;
      const loserUserId = duel.winner === "challenger" ? battle.opponentUserId : battle.challengerUserId;
      const winnerProb = duel.winner === "challenger" ? duel.challengerWinProb : 1 - duel.challengerWinProb;
      const stake = Math.min(computeStakeForWinProb(winnerProb), Math.max(0, await getUserPoints(loserUserId)));

      await tx
        .update(battles)
        .set({
          opponentCollectibleId: card.row.collectibleId,
          challengerStat,
          opponentStat: stat,
          duelRounds: duel.rounds,
          status: "finished",
          winnerUserId,
          stakePoints: stake,
          respondedAt: new Date(),
          finishedAt: new Date(),
        })
        .where(eq(battles.id, id));

      // A real stake, not a minted reward — see services/battles.ts's doc
      // comment for the farming exploit this closes.
      if (stake > 0) {
        await tx.insert(pointAdjustments).values([
          { userId: winnerUserId, points: stake, reason: "Card battle win", createdByUserId: winnerUserId },
          { userId: loserUserId, points: -stake, reason: "Card battle loss", createdByUserId: winnerUserId },
        ]);
      }

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
// Each side's own ownership row, for its finish (foil). Current ownership,
// so a card traded away after the duel reads as standard.
const challengerOwn = alias(userCollectibles, "challenger_own");
const opponentOwn = alias(userCollectibles, "opponent_own");
const challengerOwnJoin = and(
  eq(challengerOwn.userId, battles.challengerUserId),
  eq(challengerOwn.collectibleId, battles.challengerCollectibleId)
);
const opponentOwnJoin = and(eq(opponentOwn.userId, battles.opponentUserId), eq(opponentOwn.collectibleId, battles.opponentCollectibleId));

// Every battle the current user is part of, most recent first — the
// challenge inbox/history list, optionally scoped to one league (the
// League Detail "Battles" tab passes ?leagueId=). Carries the challenger's
// card (2026-09-22, direct ask: this list was text-only, no photo at all)
// so the list itself previews the matchup instead of just names.
battlesRouter.get("/mine", requireAuth, async (req, res) => {
  try {
    const { leagueId } = req.query;
    // Cancelled challenges never happened as far as the other side is
    // concerned, so they're left out of the list (2026-09-30).
    const conditions = [
      or(eq(battles.challengerUserId, req.userId!), eq(battles.opponentUserId, req.userId!))!,
      ne(battles.status, "cancelled"),
    ];
    if (typeof leagueId === "string") conditions.push(eq(battles.leagueId, leagueId));

    const rows = await db
      .select({
        battle: battles,
        challengerName: challengerUser.username,
        opponentName: opponentUser.username,
        challengerCard,
        challengerTeam,
        challengerFinish: challengerOwn.finish,
      })
      .from(battles)
      .innerJoin(challengerUser, eq(battles.challengerUserId, challengerUser.id))
      .innerJoin(opponentUser, eq(battles.opponentUserId, opponentUser.id))
      .innerJoin(challengerCard, eq(battles.challengerCollectibleId, challengerCard.id))
      .innerJoin(challengerTeam, eq(challengerCard.teamId, challengerTeam.id))
      .leftJoin(challengerOwn, challengerOwnJoin)
      .where(and(...conditions))
      .orderBy(desc(battles.createdAt))
      .limit(40);

    res.json(
      rows.map(({ battle, challengerName, opponentName, challengerCard: card, challengerTeam: team, challengerFinish }) => ({
        id: battle.id,
        leagueId: battle.leagueId,
        status: battle.status,
        direction: battle.challengerUserId === req.userId ? "outgoing" : "incoming",
        counterpartyName: battle.challengerUserId === req.userId ? opponentName : challengerName,
        counterpartyUserId: battle.challengerUserId === req.userId ? battle.opponentUserId : battle.challengerUserId,
        winnerUserId: battle.winnerUserId,
        stakePoints: battle.stakePoints,
        createdAt: battle.createdAt,
        challengerCard: {
          id: card.id,
          name: card.name,
          tier: card.tier,
          imageUrl: card.imageUrl,
          finish: challengerFinish ?? "standard",
          team: { id: team.id, code: team.code, primaryColor: team.primaryColor },
        },
      }))
    );
  } catch (err) {
    console.error("GET /api/battles/mine failed:", err);
    res.status(500).json({ error: "Failed to load battles", code: "FAILED_TO_LOAD_BATTLES" });
  }
});

// Stat lines for cards you own (v4 stat duel) — one request covers every
// candidate card in the picker. Each line carries the real per-game numbers
// and the rarity/foil-boosted ones the duel actually compares.
battlesRouter.post("/card-stats", requireAuth, async (req, res) => {
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
        finish: userCollectibles.finish,
      })
      .from(userCollectibles)
      .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
      .where(and(eq(userCollectibles.userId, req.userId!), inArray(userCollectibles.collectibleId, collectibleIds)));

    const nonCoach = rows.filter((r) => r.tier !== "coach");
    const lines = await getCardStatLines(nonCoach);
    res.json({ stats: nonCoach.map((r, i) => ({ collectibleId: r.collectibleId, finish: r.finish, ...lines[i] })) });
  } catch (err) {
    console.error("POST /api/battles/card-stats failed:", err);
    res.status(500).json({ error: "Failed to load card stats", code: "FAILED_TO_LOAD_CARD_STATS" });
  }
});

// Everyone you can challenge (2026-09-30, "easy to access battle buttons"):
// each distinct member of any league you're in, with the league to battle
// them in (their most recently joined shared league), so the Battles page
// can offer a one-tap challenge list instead of going through a league.
battlesRouter.get("/opponents", requireAuth, async (req, res) => {
  try {
    const rows = await db.execute<{ user_id: string; username: string; league_id: string; league_name: string }>(sql`
      select distinct on (other.user_id) other.user_id, u.username, l.id as league_id, l.name as league_name
      from ${leagueMembers} mine
      join ${leagueMembers} other on other.league_id = mine.league_id and other.user_id <> mine.user_id
      join ${users} u on u.id = other.user_id
      join ${leagues} l on l.id = mine.league_id
      where mine.user_id = ${req.userId!}
      order by other.user_id, other.joined_at desc
    `);
    res.json(
      rows
        .map((r) => ({ userId: r.user_id, displayName: r.username, leagueId: r.league_id, leagueName: r.league_name }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
    );
  } catch (err) {
    console.error("GET /api/battles/opponents failed:", err);
    res.status(500).json({ error: "Failed to load opponents", code: "FAILED_TO_LOAD_OPPONENTS" });
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
        challengerFinish: challengerOwn.finish,
        opponentFinish: opponentOwn.finish,
      })
      .from(battles)
      .innerJoin(challengerUser, eq(battles.challengerUserId, challengerUser.id))
      .innerJoin(opponentUser, eq(battles.opponentUserId, opponentUser.id))
      .innerJoin(challengerCard, eq(battles.challengerCollectibleId, challengerCard.id))
      .innerJoin(challengerTeam, eq(challengerCard.teamId, challengerTeam.id))
      .leftJoin(opponentCard, eq(battles.opponentCollectibleId, opponentCard.id))
      .leftJoin(opponentTeam, eq(opponentCard.teamId, opponentTeam.id))
      .leftJoin(challengerOwn, challengerOwnJoin)
      .leftJoin(opponentOwn, opponentOwnJoin)
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

    const challengerFinish = row.challengerFinish ?? "standard";
    const opponentFinish = row.opponentFinish ?? "standard";
    const finished = battle.status === "finished";
    const iAmChallenger = battle.challengerUserId === req.userId;

    // v3 coin-flip battles resolved before the stat duel existed carry no
    // rounds; they still show their old power breakdown.
    const legacy = finished && !battle.duelRounds;
    const legacyPower = legacy
      ? await computeCardPowerDetails([
          { ...row.challengerCard, finish: challengerFinish },
          ...(row.opponentCard ? [{ ...row.opponentCard, finish: opponentFinish }] : []),
        ])
      : null;

    // Stat lines are public card info, so the opponent sees the
    // challenger's card stats while picking — only the chosen category is
    // hidden. Live rather than frozen: the rounds below are the frozen
    // ground truth for a finished duel.
    const [challengerStats, opponentStats = null] = legacy
      ? [null, null]
      : await getCardStatLines([
          { ...row.challengerCard, finish: challengerFinish },
          ...(row.opponentCard ? [{ ...row.opponentCard, finish: opponentFinish }] : []),
        ]);

    const cardRef = (card: NonNullable<typeof row.opponentCard>, team: NonNullable<typeof row.opponentTeam>, finish: string) => ({
      id: card.id,
      name: card.name,
      tier: card.tier,
      imageUrl: card.imageUrl,
      finish,
      team: { id: team.id, code: team.code, primaryColor: team.primaryColor },
    });

    res.json({
      id: battle.id,
      leagueId: battle.leagueId,
      status: battle.status,
      mode: legacy ? "coinFlip" : "statDuel",
      challengerUserId: battle.challengerUserId,
      challengerName,
      opponentUserId: battle.opponentUserId,
      opponentName,
      winnerUserId: battle.winnerUserId,
      stakePoints: battle.stakePoints,
      // Hidden from the opponent until the duel resolves.
      challengerStat: finished || iAmChallenger ? battle.challengerStat : null,
      opponentStat: battle.opponentStat,
      duelRounds: battle.duelRounds,
      challengerStats,
      opponentStats,
      legacyPower: legacyPower
        ? { challenger: legacyPower[0].power, opponent: legacyPower[1]?.power ?? null }
        : null,
      challengerCard: cardRef(row.challengerCard, row.challengerTeam!, challengerFinish),
      opponentCard: row.opponentCard && row.opponentTeam ? cardRef(row.opponentCard, row.opponentTeam, opponentFinish) : null,
    });
  } catch (err) {
    console.error("GET /api/battles/:id failed:", err);
    res.status(500).json({ error: "Failed to load battle", code: "FAILED_TO_LOAD_BATTLE" });
  }
});
