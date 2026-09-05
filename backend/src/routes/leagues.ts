import { Router } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { leagues, leagueMembers, users, collectibles, teams } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { createUniqueLeagueCode } from "../services/leagues.js";
import { getLeaderboardEntries } from "../services/leaderboard.js";
import { getFantasyLeaderboardEntries } from "../services/fantasyScoring.js";
import { getAlbumLeaderboardEntries, getCollectibleCatalogTotal } from "../services/albumLeaderboard.js";
import { getCurrentSeason } from "../services/season.js";

export const leaguesRouter = Router();

const MAX_NAME_LENGTH = 40;

function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return code.length > 0 && code.length <= 10 ? code : null;
}

/** Membership check shared by every route below the league is created — 403s rather than 404s, so a code you don't belong to doesn't leak that it exists. */
async function requireMembership(leagueId: string, userId: string): Promise<boolean> {
  const [membership] = await db
    .select({ id: leagueMembers.id })
    .from(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId)))
    .limit(1);
  return !!membership;
}

leaguesRouter.post("/", requireAuth, async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > MAX_NAME_LENGTH) {
      res.status(400).json({ error: `name is required (max ${MAX_NAME_LENGTH} characters)`, code: "INVALID_NAME" });
      return;
    }

    const code = await createUniqueLeagueCode();
    const [league] = await db
      .insert(leagues)
      .values({ name, code, createdByUserId: req.userId! })
      .returning();

    await db.insert(leagueMembers).values({ leagueId: league.id, userId: req.userId! });

    res.status(201).json({ id: league.id, name: league.name, code: league.code, memberCount: 1 });
  } catch (err) {
    console.error("POST /api/leagues failed:", err);
    res.status(500).json({ error: "Failed to create league" });
  }
});

// Leagues the current user belongs to, most recently joined first — a
// user's own join row (leagueMembers), not leagues.createdAt, since being
// added to an old friend's league should surface it like anything else new.
leaguesRouter.get("/mine", requireAuth, async (req, res) => {
  try {
    const rows = await db.execute<{
      id: string;
      name: string;
      code: string;
      joined_at: string;
      member_count: number;
    }>(sql`
      select l.id, l.name, l.code, mine.joined_at, counts.member_count
      from ${leagueMembers} mine
      join ${leagues} l on l.id = mine.league_id
      join (
        select league_id, count(*)::int as member_count
        from ${leagueMembers}
        group by league_id
      ) counts on counts.league_id = l.id
      where mine.user_id = ${req.userId!}
      order by mine.joined_at desc
    `);

    res.json(
      rows.map((r) => ({ id: r.id, name: r.name, code: r.code, joinedAt: r.joined_at, memberCount: r.member_count }))
    );
  } catch (err) {
    console.error("GET /api/leagues/mine failed:", err);
    res.status(500).json({ error: "Failed to load your leagues" });
  }
});

// Idempotent — joining a league you're already in just confirms it rather
// than erroring, since the frontend can't always know in advance (e.g. a
// shared invite link opened by someone already in that league).
leaguesRouter.post("/join", requireAuth, async (req, res) => {
  try {
    const code = normalizeCode(req.body?.code);
    if (!code) {
      res.status(400).json({ error: "code is required", code: "CODE_REQUIRED" });
      return;
    }

    const [league] = await db.select().from(leagues).where(eq(leagues.code, code)).limit(1);
    if (!league) {
      res.status(404).json({ error: "No league with that code", code: "LEAGUE_NOT_FOUND" });
      return;
    }

    await db
      .insert(leagueMembers)
      .values({ leagueId: league.id, userId: req.userId! })
      .onConflictDoNothing();

    res.json({ id: league.id, name: league.name, code: league.code });
  } catch (err) {
    console.error("POST /api/leagues/join failed:", err);
    res.status(500).json({ error: "Failed to join league" });
  }
});

leaguesRouter.get("/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await requireMembership(id, req.userId!))) {
      res.status(403).json({ error: "Not a member of this league", code: "NOT_A_MEMBER" });
      return;
    }

    const [league] = await db.select().from(leagues).where(eq(leagues.id, id)).limit(1);
    if (!league) {
      res.status(404).json({ error: "League not found" });
      return;
    }

    const memberRows = await db
      .select({ userId: leagueMembers.userId, username: users.username, joinedAt: leagueMembers.joinedAt })
      .from(leagueMembers)
      .innerJoin(users, eq(leagueMembers.userId, users.id))
      .where(eq(leagueMembers.leagueId, id));

    res.json({
      id: league.id,
      name: league.name,
      code: league.code,
      createdByUserId: league.createdByUserId,
      createdAt: league.createdAt,
      members: memberRows.map((r) => ({
        userId: r.userId,
        displayName: r.username,
        joinedAt: r.joinedAt,
      })),
    });
  } catch (err) {
    console.error("GET /api/leagues/:id failed:", err);
    res.status(500).json({ error: "Failed to load league" });
  }
});

leaguesRouter.post("/:id/leave", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete(leagueMembers).where(and(eq(leagueMembers.leagueId, id), eq(leagueMembers.userId, req.userId!)));
    res.status(204).send();
  } catch (err) {
    console.error("POST /api/leagues/:id/leave failed:", err);
    res.status(500).json({ error: "Failed to leave league" });
  }
});

// Scoped version of GET /predictions/leaderboard — same points/badges via
// getLeaderboardEntries, just filtered to this league's members. Unlike the
// global board, members with zero resolved predictions yet are still shown
// (ranked last, 0 points) rather than omitted entirely — a league is a
// small, known group of friends, and "everyone's here, nobody's scored yet"
// is a meaningful state to see right after creating one, not just an empty
// list. Each entry also carries its showcase cards (users.showcaseCollectibleIds,
// set via PUT /users/me/showcase) resolved to name/tier/image/team.
leaguesRouter.get("/:id/leaderboard", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await requireMembership(id, req.userId!))) {
      res.status(403).json({ error: "Not a member of this league", code: "NOT_A_MEMBER" });
      return;
    }

    const memberRows = await db
      .select({
        userId: leagueMembers.userId,
        username: users.username,
        showcaseCollectibleIds: users.showcaseCollectibleIds,
      })
      .from(leagueMembers)
      .innerJoin(users, eq(leagueMembers.userId, users.id))
      .where(eq(leagueMembers.leagueId, id));

    const memberIds = memberRows.map((r) => r.userId);
    // getLeaderboardEntries already resolves each entry's showcase cards
    // (services/leaderboard.ts) — only zero-pick members it omits need
    // that resolved separately here.
    const entries = await getLeaderboardEntries({ userIds: memberIds });

    const presentIds = new Set(entries.map((e) => e.userId));
    const zeroMembers = memberRows.filter((r) => !presentIds.has(r.userId));

    const allShowcaseIds = [...new Set(zeroMembers.flatMap((r) => r.showcaseCollectibleIds))];
    const cardRows = allShowcaseIds.length
      ? await db
          .select({ collectible: collectibles, team: teams })
          .from(collectibles)
          .innerJoin(teams, eq(collectibles.teamId, teams.id))
          .where(inArray(collectibles.id, allShowcaseIds))
      : [];
    const cardById = new Map(
      cardRows.map(({ collectible, team }) => [
        collectible.id,
        {
          id: collectible.id,
          name: collectible.name,
          tier: collectible.tier,
          imageUrl: collectible.imageUrl,
          team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor, logoUrl: team.logoUrl },
        },
      ])
    );

    const zeroEntries = zeroMembers
      .map((r) => ({
        userId: r.userId,
        displayName: r.username,
        correct: 0,
        total: 0,
        accuracy: 0,
        points: 0,
        badges: [] as { id: string; label: string; description: string }[],
        showcase: r.showcaseCollectibleIds
          .map((cid) => cardById.get(cid))
          .filter((c): c is NonNullable<typeof c> => !!c),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json([...entries, ...zeroEntries]);
  } catch (err) {
    console.error("GET /api/leagues/:id/leaderboard failed:", err);
    res.status(500).json({ error: "Failed to load league leaderboard" });
  }
});

// Fantasy Five's league-scoped board — same getFantasyLeaderboardEntries
// shared with the global GET /api/fantasy/leaderboard, just scoped to this
// league's members, mirroring the points leaderboard's global/league split
// above. Kept as its own endpoint/response shape rather than folded into
// GET /:id/leaderboard's payload, so the two economies' numbers stay
// visibly separate rather than implying they're the same score.
leaguesRouter.get("/:id/fantasy-leaderboard", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await requireMembership(id, req.userId!))) {
      res.status(403).json({ error: "Not a member of this league", code: "NOT_A_MEMBER" });
      return;
    }

    const season = typeof req.query.season === "string" ? req.query.season : await getCurrentSeason();
    if (!season) {
      res.json([]);
      return;
    }

    const memberRows = await db
      .select({ userId: leagueMembers.userId, username: users.username })
      .from(leagueMembers)
      .innerJoin(users, eq(leagueMembers.userId, users.id))
      .where(eq(leagueMembers.leagueId, id));
    const memberIds = memberRows.map((r) => r.userId);

    const entries = await getFantasyLeaderboardEntries({ userIds: memberIds, season });

    // Same "everyone's here, nobody's scored yet" inclusion as the points
    // leaderboard above — a member with no lineup drafted this season still
    // shows, ranked last at 0.
    const presentIds = new Set(entries.map((e) => e.userId));
    const zeroEntries = memberRows
      .filter((r) => !presentIds.has(r.userId))
      .map((r) => ({ userId: r.userId, displayName: r.username, fantasyPoints: 0, showcase: [] as never[] }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json([...entries, ...zeroEntries]);
  } catch (err) {
    console.error("GET /api/leagues/:id/fantasy-leaderboard failed:", err);
    res.status(500).json({ error: "Failed to load fantasy leaderboard" });
  }
});

// Album-completion's league-scoped board — same getAlbumLeaderboardEntries
// shared with the global GET /api/collectibles/leaderboard, mirroring the
// points/fantasy leaderboards' global/league split above. A member who
// owns zero collectibles at all is still shown (ranked last, same
// "everyone's here" inclusion the points/fantasy league boards already
// use), since a fresh member with nothing yet is a meaningful state to
// see in a small friend group, not something to hide.
leaguesRouter.get("/:id/album-leaderboard", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await requireMembership(id, req.userId!))) {
      res.status(403).json({ error: "Not a member of this league", code: "NOT_A_MEMBER" });
      return;
    }

    const memberRows = await db
      .select({
        userId: leagueMembers.userId,
        username: users.username,
        showcaseCollectibleIds: users.showcaseCollectibleIds,
      })
      .from(leagueMembers)
      .innerJoin(users, eq(leagueMembers.userId, users.id))
      .where(eq(leagueMembers.leagueId, id));

    const memberIds = memberRows.map((r) => r.userId);
    // Sequential, not Promise.all — this driver gives no real cross-query
    // concurrency against Neon (see CLAUDE.md's round-trip-cost note).
    const entries = await getAlbumLeaderboardEntries({ userIds: memberIds });
    const totalCount = await getCollectibleCatalogTotal();

    const presentIds = new Set(entries.map((e) => e.userId));
    const zeroMembers = memberRows.filter((r) => !presentIds.has(r.userId));

    const allShowcaseIds = [...new Set(zeroMembers.flatMap((r) => r.showcaseCollectibleIds))];
    const cardRows = allShowcaseIds.length
      ? await db
          .select({ collectible: collectibles, team: teams })
          .from(collectibles)
          .innerJoin(teams, eq(collectibles.teamId, teams.id))
          .where(inArray(collectibles.id, allShowcaseIds))
      : [];
    const cardById = new Map(
      cardRows.map(({ collectible, team }) => [
        collectible.id,
        {
          id: collectible.id,
          name: collectible.name,
          tier: collectible.tier,
          imageUrl: collectible.imageUrl,
          team: { id: team.id, code: team.code, name: team.name, primaryColor: team.primaryColor, logoUrl: team.logoUrl },
        },
      ])
    );

    const zeroEntries = zeroMembers
      .map((r) => ({
        userId: r.userId,
        displayName: r.username,
        ownedCount: 0,
        totalCount,
        completion: 0,
        showcase: r.showcaseCollectibleIds
          .map((cid) => cardById.get(cid))
          .filter((c): c is NonNullable<typeof c> => !!c),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json([...entries, ...zeroEntries]);
  } catch (err) {
    console.error("GET /api/leagues/:id/album-leaderboard failed:", err);
    res.status(500).json({ error: "Failed to load album leaderboard" });
  }
});
