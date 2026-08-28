import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { collectibles, userCollectibles, pointAdjustments, teams, users, players, playerSeasonStats } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { getUserPoints } from "../services/points.js";

// Collectibles were never given a real playerId (just a free-text name) —
// the feed's player names come as "LASTNAME, Firstname" (players.name),
// entirely different shape from a collectible's "Firstname Lastname", so a
// plain string comparison always misses. Reorder + lowercase + collapse
// whitespace on both sides before comparing; still a best-effort match
// (a suffix like "Jr." present on one side and not the other won't match),
// callers treat "no match" as a normal, expected outcome, not an error.
function normalizePlayerName(name: string): string {
  const commaIdx = name.indexOf(",");
  const reordered = commaIdx === -1 ? name : `${name.slice(commaIdx + 1)} ${name.slice(0, commaIdx)}`;
  return reordered.toLowerCase().replace(/\s+/g, " ").trim();
}

export const collectiblesRouter = Router();

const TIERS = ["common", "rare", "legendary"] as const;

// Direct-purchase price for a specific card, deliberately priced ABOVE the
// pack-implied cost of that tier (Starter's ~42pts/common, Pro's
// ~267pts/rare — see services/packs.ts's PACKS odds) rather than at
// collectibles.pointsCost's flat 50/250 book value (that value stays as-is,
// used only for duplicate auto-sell — see packs.ts's SELL_BACK_RATE).
// A pack pull is still the cheaper way to get *a* card of that tier; this
// is the "I want this exact one" premium for whatever's left after RNG
// hasn't cooperated. Legendary has no entry — never directly purchasable,
// wheel/packs/perfect-round only, at any price.
const DIRECT_BUY_PRICE: Partial<Record<(typeof TIERS)[number], number>> = {
  common: 75,
  rare: 450,
};

collectiblesRouter.get("/", async (_req, res) => {
  try {
    const rows = await db
      .select({ collectible: collectibles, team: teams })
      .from(collectibles)
      .innerJoin(teams, eq(collectibles.teamId, teams.id));

    // "042/208" print numbering — a fixed rank within the card's own tier,
    // not stored (nothing about a card's identity actually depends on it,
    // it's purely a display detail), so it's cheap to derive fresh every
    // request: sort each tier by (name, team code) for a deterministic
    // order, then index within that sorted group. Same order for every
    // caller/session, since it doesn't depend on request-specific state.
    const byTier = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = byTier.get(row.collectible.tier) ?? [];
      group.push(row);
      byTier.set(row.collectible.tier, group);
    }
    const serial = new Map<string, { number: number; total: number }>();
    for (const group of byTier.values()) {
      group.sort((a, b) => a.collectible.name.localeCompare(b.collectible.name) || a.team.code.localeCompare(b.team.code));
      group.forEach((row, i) => serial.set(row.collectible.id, { number: i + 1, total: group.length }));
    }

    const payload = rows.map(({ collectible, team }) => ({
      id: collectible.id,
      name: collectible.name,
      tier: collectible.tier,
      pointsCost: collectible.pointsCost,
      buyPrice: DIRECT_BUY_PRICE[collectible.tier as (typeof TIERS)[number]] ?? null,
      imageUrl: collectible.imageUrl,
      serialNumber: serial.get(collectible.id)!.number,
      serialTotal: serial.get(collectible.id)!.total,
      team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor, logoUrl: team.logoUrl },
    }));

    res.json(payload);
  } catch (err) {
    console.error("GET /api/collectibles failed:", err);
    res.status(500).json({ error: "Failed to load collectibles" });
  }
});

// Paginated, filtered, bundled card list for the Store page — every tier a
// given player has (common/rare/legendary share the exact same `name` +
// `teamId`, since they're generated together per player, see
// expand-collectibles.ts) comes back grouped into one bundle rather than as
// separate flat rows, so the grid can show one stacked tile per player and
// the preview modal can switch between tiers. GET / above still returns the
// full flat catalog unpaginated (inventory/profile/album need every card at
// once to compute ownership/album-completion, and touching that shape would
// ripple into all three) — this is a separate endpoint rather than an
// optional-params variant of GET / to keep those callers' response shape
// stable.
//
// The grouping/pagination unit is the PLAYER (name+team), not the card row,
// so this is hand-written SQL rather than drizzle's query builder — CTE
// pagination over a GROUP BY, joined back to the full per-tier rows, isn't
// something the typed builder expresses cleanly. Serial numbers ("042/208")
// still rank a card within its full tier catalog independent of these
// filters, same as before.
collectiblesRouter.get("/browse", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "20"), 10) || 20, 1), 40);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const team = typeof req.query.team === "string" && req.query.team ? req.query.team : undefined;
    const tierParam = typeof req.query.tier === "string" ? req.query.tier : undefined;
    // The tier chips filter which BUNDLES are shown (any bundle that has a
    // card of that tier), not which cards within a bundle — a "Legendary"
    // filter still shows a player's common/rare alongside their legendary,
    // since the bundle is the unit the user is browsing.
    const tier = tierParam && TIERS.includes(tierParam as (typeof TIERS)[number]) ? tierParam : undefined;

    const groupConditions = [];
    if (search) groupConditions.push(sql`name ilike ${"%" + search + "%"}`);
    if (team) groupConditions.push(sql`team_id = ${team}`);
    const whereClause = groupConditions.length ? sql`WHERE ${sql.join(groupConditions, sql` AND `)}` : sql``;
    const havingClause = tier ? sql`HAVING ${tier} = ANY(array_agg(DISTINCT tier))` : sql``;

    const query = sql`
      WITH ranked AS (
        SELECT
          c.id AS id, c.name AS name, c.tier AS tier, c.points_cost AS points_cost, c.image_url AS image_url,
          t.id AS team_id, t.code AS team_code, t.name AS team_name, t.primary_color AS team_primary_color, t.logo_url AS team_logo_url,
          (row_number() OVER (PARTITION BY c.tier ORDER BY c.name, t.code))::int AS serial_number,
          (count(*) OVER (PARTITION BY c.tier))::int AS serial_total
        FROM collectibles c
        JOIN teams t ON c.team_id = t.id
      ),
      filtered_groups AS (
        SELECT name, team_id, team_name
        FROM ranked
        ${whereClause}
        GROUP BY name, team_id, team_name
        ${havingClause}
        ORDER BY team_name, name
        LIMIT ${limit + 1} OFFSET ${offset}
      )
      SELECT r.*
      FROM ranked r
      JOIN filtered_groups g ON r.name = g.name AND r.team_id = g.team_id
      ORDER BY g.team_name, g.name,
        CASE r.tier WHEN 'common' THEN 0 WHEN 'rare' THEN 1 ELSE 2 END
    `;

    const rows = (await db.execute(query)) as unknown as Array<{
      id: string;
      name: string;
      tier: string;
      points_cost: number;
      image_url: string | null;
      team_id: string;
      team_code: string;
      team_name: string;
      team_primary_color: string | null;
      team_logo_url: string | null;
      serial_number: number;
      serial_total: number;
    }>;

    // Rows are already ordered player-then-tier, so a single pass groups
    // them back into bundles without re-sorting.
    const bundles: {
      name: string;
      team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
      cards: ReturnType<typeof mapCardRow>[];
    }[] = [];
    for (const row of rows) {
      const last = bundles[bundles.length - 1];
      if (last && last.name === row.name && last.team.id === row.team_id) {
        last.cards.push(mapCardRow(row));
      } else {
        bundles.push({
          name: row.name,
          team: { id: row.team_id, code: row.team_code, name: row.team_name, primaryColor: row.team_primary_color, logoUrl: row.team_logo_url },
          cards: [mapCardRow(row)],
        });
      }
    }

    const hasMore = bundles.length > limit;
    const page = hasMore ? bundles.slice(0, limit) : bundles;

    res.json({ items: page, hasMore });
  } catch (err) {
    console.error("GET /api/collectibles/browse failed:", err);
    res.status(500).json({ error: "Failed to load collectibles" });
  }
});

function mapCardRow(row: {
  id: string;
  name: string;
  tier: string;
  points_cost: number;
  image_url: string | null;
  serial_number: number;
  serial_total: number;
}) {
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    pointsCost: row.points_cost,
    buyPrice: DIRECT_BUY_PRICE[row.tier as (typeof TIERS)[number]] ?? null,
    imageUrl: row.image_url,
    serialNumber: row.serial_number,
    serialTotal: row.serial_total,
  };
}

// Distinct teams that actually have at least one collectible, for the
// Store page's team filter dropdown — kept independent of whatever page(s)
// /browse has loaded so far, since deriving it from loaded cards would only
// show teams the user happened to scroll to.
collectiblesRouter.get("/teams", async (_req, res) => {
  try {
    const rows = await db
      .selectDistinct({
        id: teams.id,
        code: teams.code,
        name: teams.name,
        primaryColor: teams.primaryColor,
        logoUrl: teams.logoUrl,
      })
      .from(collectibles)
      .innerJoin(teams, eq(collectibles.teamId, teams.id))
      .orderBy(teams.name);

    res.json(rows);
  } catch (err) {
    console.error("GET /api/collectibles/teams failed:", err);
    res.status(500).json({ error: "Failed to load teams" });
  }
});

// Real season stats for the card back (card-preview's tap-to-flip) — best-
// effort name match against the real players table (see
// normalizePlayerName's doc comment above for why a plain match doesn't
// work). `matched: false` is a normal, expected response, not an error —
// the frontend shows a plain "stats not available" state for it, same
// spirit as the app's other known data gaps (player game logs, some
// teams' rosters not synced yet).
collectiblesRouter.get("/:id/stats", async (req, res) => {
  try {
    const { id } = req.params;

    const [collectible] = await db.select().from(collectibles).where(eq(collectibles.id, id)).limit(1);
    if (!collectible) {
      res.status(404).json({ error: "Collectible not found" });
      return;
    }

    const teamPlayers = await db.select().from(players).where(eq(players.teamId, collectible.teamId));
    const target = normalizePlayerName(collectible.name);
    const player = teamPlayers.find((p) => normalizePlayerName(p.name) === target);
    if (!player) {
      res.json({ matched: false });
      return;
    }

    // Same "pick the season with the most actual games played" rule as
    // GET /api/teams/:id/roster, so this agrees with what the roster page
    // itself shows for the same player.
    const [mostActive] = await db
      .select({ season: playerSeasonStats.season, totalGames: sql<number>`sum(${playerSeasonStats.gamesPlayed})` })
      .from(playerSeasonStats)
      .where(eq(playerSeasonStats.playerId, player.id))
      .groupBy(playerSeasonStats.season)
      .orderBy(sql`sum(${playerSeasonStats.gamesPlayed}) desc`)
      .limit(1);

    if (!mostActive) {
      res.json({ matched: true, player: { id: player.id, name: player.name, position: player.position, jerseyNumber: player.jerseyNumber }, stats: null });
      return;
    }

    const [stats] = await db
      .select()
      .from(playerSeasonStats)
      .where(and(eq(playerSeasonStats.playerId, player.id), eq(playerSeasonStats.season, mostActive.season)))
      .limit(1);

    res.json({
      matched: true,
      player: { id: player.id, name: player.name, position: player.position, jerseyNumber: player.jerseyNumber },
      stats: stats ?? null,
    });
  } catch (err) {
    console.error("GET /api/collectibles/:id/stats failed:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

collectiblesRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select({
        collectibleId: userCollectibles.collectibleId,
        unlockedAt: userCollectibles.unlockedAt,
        finish: userCollectibles.finish,
      })
      .from(userCollectibles)
      .where(eq(userCollectibles.userId, req.userId!));

    res.json(rows);
  } catch (err) {
    console.error("GET /api/collectibles/me failed:", err);
    res.status(500).json({ error: "Failed to load your collection" });
  }
});

collectiblesRouter.post("/:id/purchase", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Collectible/team lookup and the ownership check used to be two
    // sequential round trips against Neon; a left join scoped to this user
    // (same pattern as rollPackForUser in services/packs.ts) does both in
    // one. Each round trip here costs a roughly fixed ~280ms+ in local dev
    // (measured for this same DB elsewhere in the codebase) — fewer
    // statements is the only real lever, Promise.all doesn't help since
    // this driver/pool gives no genuine cross-query concurrency.
    const [row] = await db
      .select({ collectible: collectibles, team: teams, ownedId: userCollectibles.id })
      .from(collectibles)
      .innerJoin(teams, eq(collectibles.teamId, teams.id))
      .leftJoin(
        userCollectibles,
        and(eq(userCollectibles.collectibleId, collectibles.id), eq(userCollectibles.userId, req.userId!))
      )
      .where(eq(collectibles.id, id))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Collectible not found", code: "COLLECTIBLE_NOT_FOUND" });
      return;
    }
    if (row.ownedId) {
      res.status(409).json({ error: "You already own this card", code: "ALREADY_OWNED" });
      return;
    }

    const price = DIRECT_BUY_PRICE[row.collectible.tier as (typeof TIERS)[number]];
    if (price === undefined) {
      res.status(400).json({ error: "This card can't be bought directly", code: "NOT_PURCHASABLE" });
      return;
    }

    const points = await getUserPoints(req.userId!);
    if (points < price) {
      res.status(400).json({ error: "Not enough points", code: "NOT_ENOUGH_POINTS" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.insert(pointAdjustments).values({
        userId: req.userId!,
        points: -price,
        reason: `Bought: ${row.collectible.name}`,
        createdByUserId: req.userId!,
        // See the column's comment in schema.ts — spending shouldn't lower
        // a predictor's leaderboard rank.
        countsTowardRanking: false,
      });
      await tx.insert(userCollectibles).values({ userId: req.userId!, collectibleId: id });
    });

    res.status(201).json({
      collectible: {
        id: row.collectible.id,
        name: row.collectible.name,
        tier: row.collectible.tier,
        pointsCost: row.collectible.pointsCost,
        imageUrl: row.collectible.imageUrl,
        team: { id: row.team.id, code: row.team.code, name: row.team.name, primaryColor: row.team.primaryColor, logoUrl: row.team.logoUrl },
      },
      pointsSpent: price,
    });
  } catch (err) {
    console.error("POST /api/collectibles/:id/purchase failed:", err);
    res.status(500).json({ error: "Failed to buy that card" });
  }
});

collectiblesRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { name, teamId, tier, pointsCost, imageUrl } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "name is required", code: "INVALID_REQUEST_BODY" });
    return;
  }
  if (typeof teamId !== "string") {
    res.status(400).json({ error: "teamId is required", code: "INVALID_REQUEST_BODY" });
    return;
  }
  if (typeof tier !== "string" || !TIERS.includes(tier as (typeof TIERS)[number])) {
    res.status(400).json({ error: `tier must be one of: ${TIERS.join(", ")}`, code: "INVALID_REQUEST_BODY" });
    return;
  }
  if (typeof pointsCost !== "number" || !Number.isInteger(pointsCost) || pointsCost <= 0) {
    res.status(400).json({ error: "pointsCost must be a positive integer", code: "INVALID_REQUEST_BODY" });
    return;
  }
  if (imageUrl !== undefined && typeof imageUrl !== "string") {
    res.status(400).json({ error: "imageUrl must be a string", code: "INVALID_REQUEST_BODY" });
    return;
  }

  const [team] = await db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) {
    res.status(404).json({ error: "Team not found", code: "TEAM_NOT_FOUND" });
    return;
  }

  const [collectible] = await db
    .insert(collectibles)
    .values({ name: name.trim(), teamId, tier, pointsCost, imageUrl: imageUrl?.trim() || null })
    .returning();

  res.status(201).json(collectible);
});

// Directly grant an existing collectible to a user — an admin tool for
// handing out a specific card (e.g. as a one-off reward or to fix a
// support issue), independent of the normal unlock paths (wheel/packs/
// round rewards).
collectiblesRouter.post("/grant", requireAuth, requireAdmin, async (req, res) => {
  const { email, collectibleId } = req.body ?? {};
  if (typeof email !== "string" || typeof collectibleId !== "string") {
    res.status(400).json({ error: "email and collectibleId are required", code: "INVALID_REQUEST_BODY" });
    return;
  }

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!target) {
    res.status(404).json({ error: "No user with that email", code: "USER_NOT_FOUND" });
    return;
  }

  const [collectible] = await db.select().from(collectibles).where(eq(collectibles.id, collectibleId)).limit(1);
  if (!collectible) {
    res.status(404).json({ error: "Collectible not found", code: "COLLECTIBLE_NOT_FOUND" });
    return;
  }

  const [existing] = await db
    .select({ id: userCollectibles.id })
    .from(userCollectibles)
    .where(and(eq(userCollectibles.userId, target.id), eq(userCollectibles.collectibleId, collectibleId)))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "That user already owns this card", code: "ALREADY_OWNED" });
    return;
  }

  await db.insert(userCollectibles).values({ userId: target.id, collectibleId });

  res.status(201).json({ email, collectible: { id: collectible.id, name: collectible.name } });
});

collectiblesRouter.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { imageUrl } = req.body ?? {};
  if (imageUrl !== undefined && typeof imageUrl !== "string") {
    res.status(400).json({ error: "imageUrl must be a string" });
    return;
  }

  const [collectible] = await db
    .update(collectibles)
    .set({ imageUrl: imageUrl?.trim() || null })
    .where(eq(collectibles.id, id))
    .returning();

  if (!collectible) {
    res.status(404).json({ error: "Collectible not found" });
    return;
  }

  res.json(collectible);
});
