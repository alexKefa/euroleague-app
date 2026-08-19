import { Router } from "express";
import { eq, and, or, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { tradeOffers, userCollectibles, collectibles, teams, users } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";

export const tradesRouter = Router();

async function ownsLegendary(userId: string, collectibleId: string): Promise<boolean> {
  const [row] = await db
    .select({ tier: collectibles.tier })
    .from(userCollectibles)
    .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
    .where(and(eq(userCollectibles.userId, userId), eq(userCollectibles.collectibleId, collectibleId)))
    .limit(1);
  return row?.tier === "legendary";
}

async function findUserByEmail(email: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

// A user's own tradeable (legendary, owned) cards, or another user's via ?email=
tradesRouter.get("/tradeable-cards", requireAuth, async (req, res) => {
  try {
    const email = typeof req.query.email === "string" ? req.query.email : null;
    let userId = req.userId!;

    if (email) {
      const target = await findUserByEmail(email);
      if (!target) {
        res.status(404).json({ error: "No user with that email" });
        return;
      }
      userId = target.id;
    }

    const rows = await db
      .select({ collectible: collectibles, team: teams })
      .from(userCollectibles)
      .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
      .innerJoin(teams, eq(collectibles.teamId, teams.id))
      .where(and(eq(userCollectibles.userId, userId), eq(collectibles.tier, "legendary")));

    res.json(
      rows.map(({ collectible, team }) => ({
        id: collectible.id,
        name: collectible.name,
        tier: collectible.tier,
        imageUrl: collectible.imageUrl,
        team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor },
      }))
    );
  } catch (err) {
    console.error("GET /api/trades/tradeable-cards failed:", err);
    res.status(500).json({ error: "Failed to load tradeable cards" });
  }
});

tradesRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { toEmail, offeredCollectibleId, requestedCollectibleId } = req.body ?? {};
    if (
      typeof toEmail !== "string" ||
      typeof offeredCollectibleId !== "string" ||
      typeof requestedCollectibleId !== "string"
    ) {
      res.status(400).json({ error: "toEmail, offeredCollectibleId and requestedCollectibleId are required" });
      return;
    }

    if (offeredCollectibleId === requestedCollectibleId) {
      res.status(400).json({ error: "You can't trade a card for itself" });
      return;
    }

    const target = await findUserByEmail(toEmail);
    if (!target) {
      res.status(404).json({ error: "No user with that email" });
      return;
    }
    if (target.id === req.userId) {
      res.status(400).json({ error: "You can't trade with yourself" });
      return;
    }

    if (!(await ownsLegendary(req.userId!, offeredCollectibleId))) {
      res.status(400).json({ error: "You don't own a tradeable copy of the card you're offering" });
      return;
    }
    if (!(await ownsLegendary(target.id, requestedCollectibleId))) {
      res.status(400).json({ error: "That user doesn't own a tradeable copy of the card you're requesting" });
      return;
    }

    const [offer] = await db
      .insert(tradeOffers)
      .values({ fromUserId: req.userId!, toUserId: target.id, offeredCollectibleId, requestedCollectibleId })
      .returning();

    res.status(201).json(offer);
  } catch (err) {
    console.error("POST /api/trades failed:", err);
    res.status(500).json({ error: "Failed to create trade offer" });
  }
});

const fromUser = alias(users, "from_user");
const toUser = alias(users, "to_user");
const offeredCollectible = alias(collectibles, "offered_collectible");
const requestedCollectible = alias(collectibles, "requested_collectible");

tradesRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select({
        offer: tradeOffers,
        fromEmail: fromUser.email,
        toEmail: toUser.email,
        offered: offeredCollectible,
        requested: requestedCollectible,
      })
      .from(tradeOffers)
      .innerJoin(fromUser, eq(tradeOffers.fromUserId, fromUser.id))
      .innerJoin(toUser, eq(tradeOffers.toUserId, toUser.id))
      .innerJoin(offeredCollectible, eq(tradeOffers.offeredCollectibleId, offeredCollectible.id))
      .innerJoin(requestedCollectible, eq(tradeOffers.requestedCollectibleId, requestedCollectible.id))
      .where(or(eq(tradeOffers.fromUserId, req.userId!), eq(tradeOffers.toUserId, req.userId!)))
      .orderBy(desc(tradeOffers.createdAt));

    res.json(
      rows.map(({ offer, fromEmail, toEmail, offered, requested }) => ({
        id: offer.id,
        status: offer.status,
        createdAt: offer.createdAt,
        direction: offer.fromUserId === req.userId ? "outgoing" : "incoming",
        counterpartyEmail: offer.fromUserId === req.userId ? toEmail : fromEmail,
        offered: { id: offered.id, name: offered.name, imageUrl: offered.imageUrl },
        requested: { id: requested.id, name: requested.name, imageUrl: requested.imageUrl },
      }))
    );
  } catch (err) {
    console.error("GET /api/trades/me failed:", err);
    res.status(500).json({ error: "Failed to load trades" });
  }
});

tradesRouter.post("/:id/accept", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [offer] = await db.select().from(tradeOffers).where(eq(tradeOffers.id, id)).limit(1);
    if (!offer) {
      res.status(404).json({ error: "Trade offer not found" });
      return;
    }
    if (offer.toUserId !== req.userId) {
      res.status(403).json({ error: "Not your offer to accept" });
      return;
    }
    if (offer.status !== "pending") {
      res.status(400).json({ error: "This offer is no longer pending" });
      return;
    }

    // Re-validate both sides still hold their card, and neither already
    // holds the other's (which would violate the userCollectibles unique
    // index once we re-point ownership below) — things can change between
    // when an offer was made and when it's accepted.
    const [fromStillOwns, toStillOwns, toAlreadyHasOffered, fromAlreadyHasRequested] = await Promise.all([
      ownsLegendary(offer.fromUserId, offer.offeredCollectibleId),
      ownsLegendary(offer.toUserId, offer.requestedCollectibleId),
      ownsLegendary(offer.toUserId, offer.offeredCollectibleId),
      ownsLegendary(offer.fromUserId, offer.requestedCollectibleId),
    ]);
    if (!fromStillOwns) {
      res.status(400).json({ error: "The offered card is no longer available" });
      return;
    }
    if (!toStillOwns) {
      res.status(400).json({ error: "You no longer own the requested card" });
      return;
    }
    if (toAlreadyHasOffered || fromAlreadyHasRequested) {
      res.status(409).json({ error: "Trade can't complete — one of you already owns the other's card" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(userCollectibles)
        .set({ userId: offer.toUserId })
        .where(
          and(eq(userCollectibles.userId, offer.fromUserId), eq(userCollectibles.collectibleId, offer.offeredCollectibleId))
        );
      await tx
        .update(userCollectibles)
        .set({ userId: offer.fromUserId })
        .where(
          and(eq(userCollectibles.userId, offer.toUserId), eq(userCollectibles.collectibleId, offer.requestedCollectibleId))
        );
      await tx
        .update(tradeOffers)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(eq(tradeOffers.id, id));
    });

    res.json({ status: "accepted" });
  } catch (err) {
    console.error("POST /api/trades/:id/accept failed:", err);
    res.status(500).json({ error: "Failed to accept trade" });
  }
});

tradesRouter.post("/:id/decline", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [offer] = await db.select().from(tradeOffers).where(eq(tradeOffers.id, id)).limit(1);
    if (!offer) {
      res.status(404).json({ error: "Trade offer not found" });
      return;
    }
    if (offer.toUserId !== req.userId) {
      res.status(403).json({ error: "Not your offer to decline" });
      return;
    }
    if (offer.status !== "pending") {
      res.status(400).json({ error: "This offer is no longer pending" });
      return;
    }

    await db
      .update(tradeOffers)
      .set({ status: "declined", respondedAt: new Date() })
      .where(eq(tradeOffers.id, id));

    res.json({ status: "declined" });
  } catch (err) {
    console.error("POST /api/trades/:id/decline failed:", err);
    res.status(500).json({ error: "Failed to decline trade" });
  }
});

tradesRouter.post("/:id/cancel", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [offer] = await db.select().from(tradeOffers).where(eq(tradeOffers.id, id)).limit(1);
    if (!offer) {
      res.status(404).json({ error: "Trade offer not found" });
      return;
    }
    if (offer.fromUserId !== req.userId) {
      res.status(403).json({ error: "Not your offer to cancel" });
      return;
    }
    if (offer.status !== "pending") {
      res.status(400).json({ error: "This offer is no longer pending" });
      return;
    }

    await db
      .update(tradeOffers)
      .set({ status: "cancelled", respondedAt: new Date() })
      .where(eq(tradeOffers.id, id));

    res.json({ status: "cancelled" });
  } catch (err) {
    console.error("POST /api/trades/:id/cancel failed:", err);
    res.status(500).json({ error: "Failed to cancel trade" });
  }
});
