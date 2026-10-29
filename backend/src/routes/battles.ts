import { Router } from "express";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { battles, collectibles, userCollectibles, users, leagues, leagueMembers, teams } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { sendToUser } from "../realtime/hub.js";
import { computeCardPowerDetails } from "../services/battles.js";
import { getCardStatLines, powerFromLine } from "../services/statDuel.js";
import { winProbability } from "../services/battlePower.js";
import { getUserPoints, lockUserPoints } from "../services/points.js";

export const battlesRouter = Router();

// Pushed to the other side whenever a challenge changes state, same pattern
// as trades.ts's notifyTradeUpdate.
function notifyBattleUpdate(userIds: string[], battleId: string, reason: string): void {
  for (const userId of new Set(userIds)) {
    sendToUser(userId, "battle-update", { battleId, reason });
  }
}

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
    res.json({
      stats: nonCoach.map((r, i) => ({ collectibleId: r.collectibleId, finish: r.finish, ...lines[i], power: powerFromLine(r, lines[i]) })),
    });
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
    const challengerCardInput = { ...row.challengerCard, finish: challengerFinish };
    const opponentCardInput = row.opponentCard ? { ...row.opponentCard, finish: opponentFinish } : null;
    const [challengerStats, opponentStats = null] = legacy
      ? [null, null]
      : await getCardStatLines([challengerCardInput, ...(opponentCardInput ? [opponentCardInput] : [])]);

    // v5 (2026-10-09): finished battles show the power frozen at accept
    // time; pending ones show live power so the opponent can see their odds.
    const rounds = battle.duelRounds;
    const frozenPower = rounds && !Array.isArray(rounds) && rounds.v === 5 ? rounds : null;
    const statDuel = finished && Array.isArray(rounds);
    const mode = legacy ? "coinFlip" : statDuel ? "statDuel" : "power";
    const power =
      mode !== "power"
        ? null
        : frozenPower
          ? { challenger: frozenPower.challenger, opponent: frozenPower.opponent, challengerWinProb: frozenPower.challengerWinProb }
          : {
              challenger: powerFromLine(challengerCardInput, challengerStats!),
              opponent: opponentCardInput && opponentStats ? powerFromLine(opponentCardInput, opponentStats) : null,
              challengerWinProb: null,
            };

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
      mode,
      power,
      challengerUserId: battle.challengerUserId,
      challengerName,
      opponentUserId: battle.opponentUserId,
      opponentName,
      winnerUserId: battle.winnerUserId,
      stakePoints: battle.stakePoints,
      // Hidden from the opponent until the duel resolves.
      challengerStat: finished || iAmChallenger ? battle.challengerStat : null,
      opponentStat: battle.opponentStat,
      duelRounds: statDuel ? battle.duelRounds : null,
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
