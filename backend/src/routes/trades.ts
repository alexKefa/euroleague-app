import { Router } from "express";
import { eq, and, or, ne, desc, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../db/client.js";
import { tradeOffers, tradeOfferItems, userCollectibles, collectibles, teams, users } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";

export const tradesRouter = Router();

// Placeholder display name — no dedicated username field exists yet, so the
// leaderboard already shows just the email's local part rather than a full
// address; trades reuses that same convention for the marketplace.
function displayName(email: string): string {
  return email.split("@")[0];
}

// Your own legendary collection, each flagged with whether it's currently
// listed in the marketplace for others to request.
tradesRouter.get("/my-cards", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select({ collectible: collectibles, team: teams, tradeable: userCollectibles.tradeable })
      .from(userCollectibles)
      .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
      .innerJoin(teams, eq(collectibles.teamId, teams.id))
      .where(and(eq(userCollectibles.userId, req.userId!), eq(collectibles.tier, "legendary")));

    res.json(
      rows.map(({ collectible, team, tradeable }) => ({
        id: collectible.id,
        name: collectible.name,
        tier: collectible.tier,
        imageUrl: collectible.imageUrl,
        team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor },
        tradeable,
      }))
    );
  } catch (err) {
    console.error("GET /api/trades/my-cards failed:", err);
    res.status(500).json({ error: "Failed to load your cards", code: "FAILED_TO_LOAD_CARDS" });
  }
});

// Flip whether one of your cards is listed in the marketplace.
tradesRouter.post("/my-cards/:collectibleId/tradeable", requireAuth, async (req, res) => {
  try {
    const { collectibleId } = req.params;
    const { tradeable } = req.body ?? {};
    if (typeof tradeable !== "boolean") {
      res.status(400).json({ error: "tradeable must be a boolean", code: "INVALID_TRADEABLE_VALUE" });
      return;
    }

    const [row] = await db
      .update(userCollectibles)
      .set({ tradeable })
      .where(and(eq(userCollectibles.userId, req.userId!), eq(userCollectibles.collectibleId, collectibleId)))
      .returning();

    if (!row) {
      res.status(404).json({ error: "You don't own that card", code: "CARD_NOT_OWNED" });
      return;
    }

    res.json({ tradeable: row.tradeable });
  } catch (err) {
    console.error("POST /api/trades/my-cards/:collectibleId/tradeable failed:", err);
    res.status(500).json({ error: "Failed to update card", code: "FAILED_TO_UPDATE_CARD" });
  }
});

// Every legendary someone *else* has opted into the marketplace — the
// browse view that replaces having to already know who to trade with.
tradesRouter.get("/marketplace", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select({ listingId: userCollectibles.id, collectible: collectibles, team: teams, ownerEmail: users.email })
      .from(userCollectibles)
      .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
      .innerJoin(teams, eq(collectibles.teamId, teams.id))
      .innerJoin(users, eq(userCollectibles.userId, users.id))
      .where(
        and(
          eq(userCollectibles.tradeable, true),
          eq(collectibles.tier, "legendary"),
          ne(userCollectibles.userId, req.userId!)
        )
      );

    // `id` here is the listing (userCollectibles.id), not the catalog card
    // (collectible.id) — the same legendary can be listed by more than one
    // owner at once, and the catalog id isn't unique across those rows.
    // Using it as `id` produced duplicate keys client-side (Angular's
    // @for track) and, worse, an ambiguous "which listing did they mean"
    // on the backend once two owners listed the same card (see the
    // requestedListingId lookup in POST / below).
    // collectibleId is separate from the listing `id` above — the frontend
    // uses it to gray out a listing for a legendary the viewer already owns
    // (they can never complete that trade; POST /:id/accept already blocks
    // it server-side as OWNERSHIP_CONFLICT, this is just surfacing that
    // up front instead of letting them propose an offer that can never
    // be accepted).
    res.json(
      rows.map(({ listingId, collectible, team, ownerEmail }) => ({
        id: listingId,
        collectibleId: collectible.id,
        name: collectible.name,
        tier: collectible.tier,
        imageUrl: collectible.imageUrl,
        team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor },
        ownerName: displayName(ownerEmail),
      }))
    );
  } catch (err) {
    console.error("GET /api/trades/marketplace failed:", err);
    res.status(500).json({ error: "Failed to load the marketplace", code: "FAILED_TO_LOAD_MARKETPLACE" });
  }
});

tradesRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { offeredCollectibleIds, requestedListingId } = req.body ?? {};
    if (
      !Array.isArray(offeredCollectibleIds) ||
      offeredCollectibleIds.length === 0 ||
      !offeredCollectibleIds.every((id) => typeof id === "string") ||
      typeof requestedListingId !== "string"
    ) {
      res.status(400).json({
        error: "offeredCollectibleIds (a non-empty array) and requestedListingId are required",
        code: "INVALID_REQUEST_BODY",
      });
      return;
    }

    // Looked up by the specific listing row (userCollectibles.id), not by
    // collectibleId — the same legendary can be listed by more than one
    // owner at once, so a collectibleId-only lookup (the old shape of this
    // query, `.limit(1)` with no owner in the WHERE) could resolve to
    // whichever owner's row Postgres happened to return first rather than
    // the specific listing the user actually picked in the marketplace.
    const [listing] = await db
      .select({ ownerId: userCollectibles.userId, collectibleId: userCollectibles.collectibleId })
      .from(userCollectibles)
      .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
      .where(
        and(
          eq(userCollectibles.id, requestedListingId),
          eq(userCollectibles.tradeable, true),
          eq(collectibles.tier, "legendary")
        )
      )
      .limit(1);

    if (!listing) {
      res.status(404).json({ error: "That card isn't listed in the marketplace anymore", code: "LISTING_NOT_FOUND" });
      return;
    }
    if (listing.ownerId === req.userId) {
      res.status(400).json({ error: "You can't trade with yourself", code: "SELF_TRADE" });
      return;
    }

    const requestedCollectibleId = listing.collectibleId;
    if (new Set(offeredCollectibleIds).size !== offeredCollectibleIds.length) {
      res.status(400).json({ error: "You can't offer the same card twice", code: "DUPLICATE_OFFERED_CARD" });
      return;
    }
    if (offeredCollectibleIds.includes(requestedCollectibleId)) {
      res.status(400).json({ error: "You can't trade a card for itself", code: "SAME_CARD" });
      return;
    }

    // The requester already owning the requested legendary is the same
    // OWNERSHIP_CONFLICT the accept step guards against — checked here too
    // so the offer is refused up front rather than sitting pending until
    // the other side tries (and fails) to accept it. The frontend already
    // disables a marketplace listing the viewer already owns
    // (trades.ts's alreadyOwned()); this is the same rule enforced
    // server-side for anyone hitting the API directly.
    const [alreadyOwned] = await db
      .select({ id: userCollectibles.id })
      .from(userCollectibles)
      .where(and(eq(userCollectibles.userId, req.userId!), eq(userCollectibles.collectibleId, requestedCollectibleId)))
      .limit(1);
    if (alreadyOwned) {
      res.status(400).json({ error: "You already own that card", code: "ALREADY_OWNED" });
      return;
    }

    const ownedRows = await db
      .select({ collectibleId: userCollectibles.collectibleId })
      .from(userCollectibles)
      .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
      .where(
        and(
          eq(userCollectibles.userId, req.userId!),
          inArray(userCollectibles.collectibleId, offeredCollectibleIds),
          eq(collectibles.tier, "legendary")
        )
      );
    if (ownedRows.length !== offeredCollectibleIds.length) {
      res.status(400).json({ error: "You don't own all of the cards you're offering", code: "CARDS_NOT_OWNED" });
      return;
    }

    const offer = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(tradeOffers)
        .values({
          fromUserId: req.userId!,
          toUserId: listing.ownerId,
          requestedCollectibleId,
        })
        .returning();

      await tx
        .insert(tradeOfferItems)
        .values(offeredCollectibleIds.map((collectibleId: string) => ({ tradeOfferId: row.id, collectibleId })));

      return row;
    });

    res.status(201).json({ ...offer, offeredCollectibleIds });
  } catch (err) {
    console.error("POST /api/trades failed:", err);
    res.status(500).json({ error: "Failed to create trade offer", code: "FAILED_TO_CREATE_OFFER" });
  }
});

const fromUser = alias(users, "from_user");
const toUser = alias(users, "to_user");
const requestedCollectible = alias(collectibles, "requested_collectible");

tradesRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select({
        offer: tradeOffers,
        fromEmail: fromUser.email,
        toEmail: toUser.email,
        requested: requestedCollectible,
      })
      .from(tradeOffers)
      .innerJoin(fromUser, eq(tradeOffers.fromUserId, fromUser.id))
      .innerJoin(toUser, eq(tradeOffers.toUserId, toUser.id))
      .innerJoin(requestedCollectible, eq(tradeOffers.requestedCollectibleId, requestedCollectible.id))
      .where(or(eq(tradeOffers.fromUserId, req.userId!), eq(tradeOffers.toUserId, req.userId!)))
      .orderBy(desc(tradeOffers.createdAt));

    const offerIds = rows.map((r) => r.offer.id);
    const itemRows =
      offerIds.length > 0
        ? await db
            .select({ tradeOfferId: tradeOfferItems.tradeOfferId, collectible: collectibles })
            .from(tradeOfferItems)
            .innerJoin(collectibles, eq(tradeOfferItems.collectibleId, collectibles.id))
            .where(inArray(tradeOfferItems.tradeOfferId, offerIds))
        : [];

    const offeredByOfferId = new Map<string, { id: string; name: string; imageUrl: string | null }[]>();
    for (const { tradeOfferId, collectible } of itemRows) {
      const list = offeredByOfferId.get(tradeOfferId) ?? [];
      list.push({ id: collectible.id, name: collectible.name, imageUrl: collectible.imageUrl });
      offeredByOfferId.set(tradeOfferId, list);
    }

    res.json(
      rows.map(({ offer, fromEmail, toEmail, requested }) => ({
        id: offer.id,
        status: offer.status,
        createdAt: offer.createdAt,
        direction: offer.fromUserId === req.userId ? "outgoing" : "incoming",
        counterpartyName: displayName(offer.fromUserId === req.userId ? toEmail : fromEmail),
        offered: offeredByOfferId.get(offer.id) ?? [],
        requested: { id: requested.id, name: requested.name, imageUrl: requested.imageUrl },
      }))
    );
  } catch (err) {
    console.error("GET /api/trades/me failed:", err);
    res.status(500).json({ error: "Failed to load trades", code: "FAILED_TO_LOAD_TRADES" });
  }
});

// Two people can end up racing over the same card — e.g. both of a user's
// pending incoming offers target the same listing, and they accept both at
// once, or a client double-submits. Everything that reads-then-writes
// ownership happens inside one transaction with row locks (`for("update")`)
// on the offer and on both userCollectibles rows, so a second accept that
// reaches the same card blocks until the first one commits, then re-checks
// ownership against the post-commit state instead of stale data.
tradesRouter.post("/:id/accept", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const outcome = await db.transaction(async (tx) => {
      const [offer] = await tx.select().from(tradeOffers).where(eq(tradeOffers.id, id)).for("update");
      if (!offer) {
        return { status: 404, error: "Trade offer not found", code: "OFFER_NOT_FOUND" } as const;
      }
      if (offer.toUserId !== req.userId) {
        return { status: 403, error: "Not your offer to accept", code: "NOT_YOUR_OFFER" } as const;
      }
      if (offer.status !== "pending") {
        return { status: 400, error: "This offer is no longer pending", code: "OFFER_NOT_PENDING" } as const;
      }

      const items = await tx
        .select({ collectibleId: tradeOfferItems.collectibleId })
        .from(tradeOfferItems)
        .where(eq(tradeOfferItems.tradeOfferId, id));
      const offeredIds = items.map((i) => i.collectibleId);

      // Lock every ownership row this trade touches before re-validating —
      // this is what actually serializes concurrent accepts that reach the
      // same card, whether it's the single requested card or one of
      // potentially several offered cards.
      const fromRows = await tx
        .select({ collectibleId: userCollectibles.collectibleId, tier: collectibles.tier })
        .from(userCollectibles)
        .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
        .where(and(eq(userCollectibles.userId, offer.fromUserId), inArray(userCollectibles.collectibleId, offeredIds)))
        .for("update");
      const [toRow] = await tx
        .select({ tier: collectibles.tier })
        .from(userCollectibles)
        .innerJoin(collectibles, eq(userCollectibles.collectibleId, collectibles.id))
        .where(
          and(eq(userCollectibles.userId, offer.toUserId), eq(userCollectibles.collectibleId, offer.requestedCollectibleId))
        )
        .for("update");

      if (fromRows.length !== offeredIds.length || fromRows.some((r) => r.tier !== "legendary")) {
        return {
          status: 400,
          error: "One or more of the offered cards are no longer available",
          code: "OFFERED_CARDS_UNAVAILABLE",
        } as const;
      }
      if (!toRow || toRow.tier !== "legendary") {
        return { status: 400, error: "You no longer own the requested card", code: "REQUESTED_CARD_UNAVAILABLE" } as const;
      }

      const [toAlreadyHasOffered] = await tx
        .select({ id: userCollectibles.id })
        .from(userCollectibles)
        .where(and(eq(userCollectibles.userId, offer.toUserId), inArray(userCollectibles.collectibleId, offeredIds)))
        .limit(1);
      const [fromAlreadyHasRequested] = await tx
        .select({ id: userCollectibles.id })
        .from(userCollectibles)
        .where(
          and(eq(userCollectibles.userId, offer.fromUserId), eq(userCollectibles.collectibleId, offer.requestedCollectibleId))
        )
        .limit(1);
      if (toAlreadyHasOffered || fromAlreadyHasRequested) {
        return {
          status: 409,
          error: "Trade can't complete — one of you already owns the other's card",
          code: "OWNERSHIP_CONFLICT",
        } as const;
      }

      // Re-pointed cards drop out of the marketplace on both sides — the
      // new owner of either card hasn't opted their copy in.
      await tx
        .update(userCollectibles)
        .set({ userId: offer.toUserId, tradeable: false })
        .where(and(eq(userCollectibles.userId, offer.fromUserId), inArray(userCollectibles.collectibleId, offeredIds)));
      await tx
        .update(userCollectibles)
        .set({ userId: offer.fromUserId, tradeable: false })
        .where(
          and(eq(userCollectibles.userId, offer.toUserId), eq(userCollectibles.collectibleId, offer.requestedCollectibleId))
        );
      await tx
        .update(tradeOffers)
        .set({ status: "accepted", respondedAt: new Date() })
        .where(eq(tradeOffers.id, id));

      // The card just moved, so any other pending offer still asking this
      // user for it can never be accepted — close it out now instead of
      // leaving it stuck as a zombie "pending" offer for its sender.
      await tx
        .update(tradeOffers)
        .set({ status: "declined", respondedAt: new Date() })
        .where(
          and(
            eq(tradeOffers.status, "pending"),
            eq(tradeOffers.toUserId, offer.toUserId),
            eq(tradeOffers.requestedCollectibleId, offer.requestedCollectibleId),
            ne(tradeOffers.id, id)
          )
        );

      return { status: 200 } as const;
    });

    if (outcome.status !== 200) {
      res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
      return;
    }
    res.json({ status: "accepted" });
  } catch (err) {
    console.error("POST /api/trades/:id/accept failed:", err);
    res.status(500).json({ error: "Failed to accept trade", code: "FAILED_TO_ACCEPT" });
  }
});

tradesRouter.post("/:id/decline", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [offer] = await db.select().from(tradeOffers).where(eq(tradeOffers.id, id)).limit(1);
    if (!offer) {
      res.status(404).json({ error: "Trade offer not found", code: "OFFER_NOT_FOUND" });
      return;
    }
    if (offer.toUserId !== req.userId) {
      res.status(403).json({ error: "Not your offer to decline", code: "NOT_YOUR_OFFER" });
      return;
    }

    // Condition the write itself on still being pending, rather than
    // trusting the read above — closes the race against a concurrent
    // accept that flips status after this handler's initial SELECT.
    const [declined] = await db
      .update(tradeOffers)
      .set({ status: "declined", respondedAt: new Date() })
      .where(and(eq(tradeOffers.id, id), eq(tradeOffers.status, "pending")))
      .returning();

    if (!declined) {
      res.status(400).json({ error: "This offer is no longer pending", code: "OFFER_NOT_PENDING" });
      return;
    }

    res.json({ status: "declined" });
  } catch (err) {
    console.error("POST /api/trades/:id/decline failed:", err);
    res.status(500).json({ error: "Failed to decline trade", code: "FAILED_TO_DECLINE" });
  }
});

tradesRouter.post("/:id/cancel", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const [offer] = await db.select().from(tradeOffers).where(eq(tradeOffers.id, id)).limit(1);
    if (!offer) {
      res.status(404).json({ error: "Trade offer not found", code: "OFFER_NOT_FOUND" });
      return;
    }
    if (offer.fromUserId !== req.userId) {
      res.status(403).json({ error: "Not your offer to cancel", code: "NOT_YOUR_OFFER" });
      return;
    }

    // Same race guard as decline: condition the write on still being
    // pending instead of trusting the earlier read.
    const [cancelled] = await db
      .update(tradeOffers)
      .set({ status: "cancelled", respondedAt: new Date() })
      .where(and(eq(tradeOffers.id, id), eq(tradeOffers.status, "pending")))
      .returning();

    if (!cancelled) {
      res.status(400).json({ error: "This offer is no longer pending", code: "OFFER_NOT_PENDING" });
      return;
    }

    res.json({ status: "cancelled" });
  } catch (err) {
    console.error("POST /api/trades/:id/cancel failed:", err);
    res.status(500).json({ error: "Failed to cancel trade", code: "FAILED_TO_CANCEL" });
  }
});
