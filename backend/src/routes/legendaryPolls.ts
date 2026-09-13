import { Router } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  legendaryPolls,
  legendaryPollCandidates,
  legendaryPollVotes,
  players,
  teams,
  collectibles,
} from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";

export const legendaryPollsRouter = Router();

// Mirrors expand-collectibles.ts's LEGENDARY_COST — a poll-crowned legendary
// is a real catalog entry, priced the same as every other one (display-only
// "collector value", never actually purchasable — see NOT_PURCHASABLE in
// services/packs.ts).
const LEGENDARY_COST = 2500;
const TITLE_MAX_LENGTH = 120;
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 8;

// "PETERS, ALEC" -> "Alec Peters" — exact copy of expand-collectibles.ts's
// helper (duplicated rather than shared, same as expand-coach-collectibles.ts
// already does — these scripts/routes don't share a utils module today).
function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
function displayName(rawName: string): string {
  const [last, first] = rawName.split(",").map((s) => s.trim());
  if (!first) return rawName;
  const toTitle = (s: string) => s.split(/\s+/).map(titleCase).join(" ");
  return `${toTitle(first)} ${toTitle(last)}`;
}
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True if this player already has a legendary collectible (any tier-per-team pick already claimed them). */
async function hasLegendaryCollectible(playerId: string): Promise<boolean> {
  const [player] = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return false;
  const name = normalize(displayName(player.name));
  const rows = await db
    .select({ name: collectibles.name })
    .from(collectibles)
    .where(and(eq(collectibles.teamId, player.teamId), eq(collectibles.tier, "legendary")));
  return rows.some((r) => normalize(r.name) === name);
}

type PollRow = typeof legendaryPolls.$inferSelect;

/** Assembles the full poll payload (candidates + live vote counts + this caller's own vote) shared by every read route. */
async function buildPollPayloads(polls: PollRow[], userId: string | undefined) {
  if (polls.length === 0) return [];
  const pollIds = polls.map((p) => p.id);

  const candidateRows = await db
    .select({
      id: legendaryPollCandidates.id,
      pollId: legendaryPollCandidates.pollId,
      playerId: players.id,
      playerName: players.name,
      photoUrl: players.photoUrl,
      teamId: teams.id,
      teamName: teams.name,
      teamCode: teams.code,
    })
    .from(legendaryPollCandidates)
    .innerJoin(players, eq(legendaryPollCandidates.playerId, players.id))
    .innerJoin(teams, eq(players.teamId, teams.id))
    .where(inArray(legendaryPollCandidates.pollId, pollIds));

  const voteCounts = await db
    .select({ candidateId: legendaryPollVotes.candidateId, count: sql<number>`count(*)::int` })
    .from(legendaryPollVotes)
    .where(inArray(legendaryPollVotes.pollId, pollIds))
    .groupBy(legendaryPollVotes.candidateId);
  const countByCandidate = new Map(voteCounts.map((v) => [v.candidateId, v.count]));

  const myVotes = userId
    ? await db
        .select({ pollId: legendaryPollVotes.pollId, candidateId: legendaryPollVotes.candidateId })
        .from(legendaryPollVotes)
        .where(and(inArray(legendaryPollVotes.pollId, pollIds), eq(legendaryPollVotes.userId, userId)))
    : [];
  const myVoteByPoll = new Map(myVotes.map((v) => [v.pollId, v.candidateId]));

  const winnerCollectibleIds = polls.map((p) => p.winnerCollectibleId).filter((id): id is string => !!id);
  const winners =
    winnerCollectibleIds.length > 0
      ? await db.select().from(collectibles).where(inArray(collectibles.id, winnerCollectibleIds))
      : [];
  const winnerById = new Map(winners.map((w) => [w.id, w]));

  return polls.map((poll) => {
    const candidates = candidateRows
      .filter((c) => c.pollId === poll.id)
      .map((c) => ({
        id: c.id,
        playerId: c.playerId,
        name: displayName(c.playerName),
        teamId: c.teamId,
        teamName: c.teamName,
        teamCode: c.teamCode,
        photoUrl: c.photoUrl,
        voteCount: countByCandidate.get(c.id) ?? 0,
      }));
    const totalVotes = candidates.reduce((sum, c) => sum + c.voteCount, 0);
    const winner = poll.winnerCollectibleId ? winnerById.get(poll.winnerCollectibleId) : undefined;

    return {
      id: poll.id,
      title: poll.title,
      status: poll.status,
      createdAt: poll.createdAt,
      closesAt: poll.closesAt,
      closedAt: poll.closedAt,
      candidates,
      totalVotes,
      myVoteCandidateId: myVoteByPoll.get(poll.id) ?? null,
      winner: winner ? { id: winner.id, name: winner.name, teamId: winner.teamId, imageUrl: winner.imageUrl } : null,
    };
  });
}

// Open polls first (newest first), then closed ones (most recently closed
// first) — voting is the primary action, browsing past results is
// secondary.
legendaryPollsRouter.get("/", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(legendaryPolls);
    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      const aTime = a.status === "open" ? a.createdAt : (a.closedAt ?? a.createdAt);
      const bTime = b.status === "open" ? b.createdAt : (b.closedAt ?? b.createdAt);
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });
    const payload = await buildPollPayloads(rows, req.userId);
    res.json(payload);
  } catch (err) {
    console.error("GET /api/legendary-polls failed:", err);
    res.status(500).json({ error: "Failed to load polls" });
  }
});

// Eligible candidates for a new poll: active players who don't already hold
// a legendary card. Admin-only — this backs the poll-creation picker, not a
// public browse view.
legendaryPollsRouter.get("/candidates", requireAuth, requireAdmin, async (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";

    const existingLegendaries = await db
      .select({ teamId: collectibles.teamId, name: collectibles.name })
      .from(collectibles)
      .where(eq(collectibles.tier, "legendary"));
    const legendaryKeys = new Set(existingLegendaries.map((c) => `${c.teamId}::${normalize(c.name)}`));

    const rows = await db
      .select({
        id: players.id,
        name: players.name,
        photoUrl: players.photoUrl,
        teamId: teams.id,
        teamName: teams.name,
        teamCode: teams.code,
      })
      .from(players)
      .innerJoin(teams, eq(players.teamId, teams.id))
      .where(eq(players.active, true));

    const eligible = rows
      .filter((p) => !legendaryKeys.has(`${p.teamId}::${normalize(displayName(p.name))}`))
      .map((p) => ({ ...p, name: displayName(p.name) }))
      .filter((p) => !search || p.name.toLowerCase().includes(search) || p.teamName.toLowerCase().includes(search))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50);

    res.json(eligible);
  } catch (err) {
    console.error("GET /api/legendary-polls/candidates failed:", err);
    res.status(500).json({ error: "Failed to load candidates" });
  }
});

legendaryPollsRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const playerIds = Array.isArray(req.body?.playerIds) ? [...new Set(req.body.playerIds)] : [];
    const closesAt = typeof req.body?.closesAt === "string" ? new Date(req.body.closesAt) : null;

    if (!title || title.length > TITLE_MAX_LENGTH) {
      res.status(400).json({ error: `title is required (max ${TITLE_MAX_LENGTH} characters)` });
      return;
    }
    if (playerIds.length < MIN_CANDIDATES || playerIds.length > MAX_CANDIDATES) {
      res.status(400).json({ error: `Choose between ${MIN_CANDIDATES} and ${MAX_CANDIDATES} candidates` });
      return;
    }
    if (closesAt && Number.isNaN(closesAt.getTime())) {
      res.status(400).json({ error: "closesAt must be a valid date" });
      return;
    }

    const rows = await db.select().from(players).where(inArray(players.id, playerIds as string[]));
    if (rows.length !== playerIds.length) {
      res.status(400).json({ error: "One or more candidates are not valid players" });
      return;
    }
    for (const player of rows) {
      if (await hasLegendaryCollectible(player.id)) {
        res.status(400).json({ error: `${displayName(player.name)} already has a legendary card` });
        return;
      }
    }

    const [poll] = await db
      .insert(legendaryPolls)
      .values({ title, createdByUserId: req.userId!, closesAt: closesAt ?? undefined })
      .returning();

    await db
      .insert(legendaryPollCandidates)
      .values(rows.map((player) => ({ pollId: poll.id, playerId: player.id })));

    const [payload] = await buildPollPayloads([poll], req.userId);
    res.status(201).json(payload);
  } catch (err) {
    console.error("POST /api/legendary-polls failed:", err);
    res.status(500).json({ error: "Failed to create poll" });
  }
});

legendaryPollsRouter.post("/:id/vote", requireAuth, async (req, res) => {
  try {
    const candidateId = typeof req.body?.candidateId === "string" ? req.body.candidateId : "";
    const [poll] = await db.select().from(legendaryPolls).where(eq(legendaryPolls.id, req.params.id)).limit(1);
    if (!poll) {
      res.status(404).json({ error: "Poll not found", code: "POLL_NOT_FOUND" });
      return;
    }
    if (poll.status !== "open" || (poll.closesAt && new Date(poll.closesAt) <= new Date())) {
      res.status(400).json({ error: "This poll is no longer accepting votes", code: "POLL_CLOSED" });
      return;
    }

    const [candidate] = await db
      .select()
      .from(legendaryPollCandidates)
      .where(and(eq(legendaryPollCandidates.id, candidateId), eq(legendaryPollCandidates.pollId, poll.id)))
      .limit(1);
    if (!candidate) {
      res.status(400).json({ error: "candidateId must belong to this poll", code: "INVALID_CANDIDATE" });
      return;
    }

    await db
      .insert(legendaryPollVotes)
      .values({ pollId: poll.id, candidateId, userId: req.userId! })
      .onConflictDoUpdate({
        target: [legendaryPollVotes.pollId, legendaryPollVotes.userId],
        set: { candidateId, votedAt: new Date() },
      });

    const [payload] = await buildPollPayloads([poll], req.userId);
    res.json(payload);
  } catch (err) {
    console.error("POST /api/legendary-polls/:id/vote failed:", err);
    res.status(500).json({ error: "Failed to cast vote" });
  }
});

legendaryPollsRouter.delete("/:id/vote", requireAuth, async (req, res) => {
  try {
    const [poll] = await db.select().from(legendaryPolls).where(eq(legendaryPolls.id, req.params.id)).limit(1);
    if (!poll) {
      res.status(404).json({ error: "Poll not found", code: "POLL_NOT_FOUND" });
      return;
    }
    if (poll.status !== "open") {
      res.status(400).json({ error: "This poll is no longer open", code: "POLL_CLOSED" });
      return;
    }

    await db
      .delete(legendaryPollVotes)
      .where(and(eq(legendaryPollVotes.pollId, poll.id), eq(legendaryPollVotes.userId, req.userId!)));

    const [payload] = await buildPollPayloads([poll], req.userId);
    res.json(payload);
  } catch (err) {
    console.error("DELETE /api/legendary-polls/:id/vote failed:", err);
    res.status(500).json({ error: "Failed to remove vote" });
  }
});

// Closes voting and, if at least one vote was cast, mints the winner as a
// real new legendary collectible. Ties break on whichever candidate row was
// inserted first (candidates are inserted in the order POST / received
// them) — arbitrary but deterministic, and a genuine tie is rare enough
// that it isn't worth a runoff mechanism.
legendaryPollsRouter.post("/:id/close", requireAuth, requireAdmin, async (req, res) => {
  try {
    const [poll] = await db.select().from(legendaryPolls).where(eq(legendaryPolls.id, req.params.id)).limit(1);
    if (!poll) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }
    if (poll.status !== "open") {
      res.status(400).json({ error: "Poll is already closed" });
      return;
    }

    const candidates = await db
      .select()
      .from(legendaryPollCandidates)
      .where(eq(legendaryPollCandidates.pollId, poll.id));
    const voteCounts = await db
      .select({ candidateId: legendaryPollVotes.candidateId, count: sql<number>`count(*)::int` })
      .from(legendaryPollVotes)
      .where(eq(legendaryPollVotes.pollId, poll.id))
      .groupBy(legendaryPollVotes.candidateId);
    const countByCandidate = new Map(voteCounts.map((v) => [v.candidateId, v.count]));

    let winnerCollectibleId: string | null = null;
    const topCandidate = candidates
      .filter((c) => (countByCandidate.get(c.id) ?? 0) > 0)
      .sort((a, b) => (countByCandidate.get(b.id) ?? 0) - (countByCandidate.get(a.id) ?? 0))[0];

    if (topCandidate) {
      const [player] = await db.select().from(players).where(eq(players.id, topCandidate.playerId)).limit(1);
      if (player) {
        const name = normalize(displayName(player.name));
        // Re-check at close time, not just at poll creation — a re-run of
        // collectibles:expand in between could have already claimed this
        // player as their team's top-PIR legendary.
        const teamLegendaries = await db
          .select()
          .from(collectibles)
          .where(and(eq(collectibles.teamId, player.teamId), eq(collectibles.tier, "legendary")));
        const alreadyExists = teamLegendaries.find((c) => normalize(c.name) === name);

        if (alreadyExists) {
          winnerCollectibleId = alreadyExists.id;
        } else {
          const [created] = await db
            .insert(collectibles)
            .values({
              name: displayName(player.name),
              teamId: player.teamId,
              tier: "legendary",
              pointsCost: LEGENDARY_COST,
              imageUrl: player.photoUrl,
            })
            .returning();
          winnerCollectibleId = created.id;
        }
      }
    }

    const [updated] = await db
      .update(legendaryPolls)
      .set({ status: "closed", closedAt: new Date(), winnerCollectibleId })
      .where(eq(legendaryPolls.id, poll.id))
      .returning();

    const [payload] = await buildPollPayloads([updated], req.userId);
    res.json(payload);
  } catch (err) {
    console.error("POST /api/legendary-polls/:id/close failed:", err);
    res.status(500).json({ error: "Failed to close poll" });
  }
});
