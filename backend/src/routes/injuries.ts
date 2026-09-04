import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { playerInjuries, players, teams } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";

export const injuriesRouter = Router();

// Admin-entered only — see the doc comment on playerInjuries in schema.ts
// for why (EuroLeague's own feed has no injury data to sync at all).
const STATUSES = ["out", "doubtful", "questionable", "probable"] as const;
type InjuryStatus = (typeof STATUSES)[number];

function isInjuryStatus(value: unknown): value is InjuryStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

// Full current injury list, joined with player/team for display — small
// table (only currently-injured players have a row at all), so no paging.
injuriesRouter.get("/", async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: playerInjuries.id,
        playerId: playerInjuries.playerId,
        playerName: players.name,
        playerPosition: players.position,
        playerPhotoUrl: players.photoUrl,
        teamId: teams.id,
        teamCode: teams.code,
        teamName: teams.name,
        teamPrimaryColor: teams.primaryColor,
        teamLogoUrl: teams.logoUrl,
        status: playerInjuries.status,
        note: playerInjuries.note,
        updatedAt: playerInjuries.updatedAt,
      })
      .from(playerInjuries)
      .innerJoin(players, eq(playerInjuries.playerId, players.id))
      .innerJoin(teams, eq(players.teamId, teams.id))
      .orderBy(teams.name, players.name);

    res.json(rows);
  } catch (err) {
    console.error("GET /api/injuries failed:", err);
    res.status(500).json({ error: "Failed to load injury report" });
  }
});

// Upsert-by-playerId — a fresh report for an already-listed player replaces
// it outright rather than layering a second row, since there's only ever
// one "current" status per player (see schema.ts).
injuriesRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const { playerId, status, note } = req.body ?? {};
  if (typeof playerId !== "string") {
    res.status(400).json({ error: "playerId is required" });
    return;
  }
  if (!isInjuryStatus(status)) {
    res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
    return;
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    res.status(400).json({ error: "note must be a string" });
    return;
  }

  const [player] = await db.select({ id: players.id }).from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  const [row] = await db
    .insert(playerInjuries)
    .values({
      playerId,
      status,
      note: note || null,
      updatedByUserId: req.userId!,
    })
    .onConflictDoUpdate({
      target: playerInjuries.playerId,
      set: { status, note: note || null, updatedByUserId: req.userId!, updatedAt: new Date() },
    })
    .returning();

  res.status(201).json(row);
});

// Clears a player back to healthy — deleting the row, not writing an
// "available" status (see schema.ts's doc comment).
injuriesRouter.delete("/:playerId", requireAuth, requireAdmin, async (req, res) => {
  await db.delete(playerInjuries).where(eq(playerInjuries.playerId, req.params.playerId));
  res.status(204).send();
});
