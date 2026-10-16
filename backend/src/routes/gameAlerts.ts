// The bell on a game (2026-10-16): turns on tip-off, quarter, close and final
// pushes for that game (services/teamPush.ts).
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { requireAuth } from "../auth/middleware.js";

export const gameAlertsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids of the user's belled games that haven't finished yet. */
gameAlertsRouter.get("/", requireAuth, async (req, res) => {
  try {
    const rows = await db.execute<{ game_id: string }>(sql`
      select ga.game_id from game_alerts ga join games g on g.id = ga.game_id
      where ga.user_id = ${req.userId!} and g.status <> 'final'
    `);
    res.json(rows.map((r) => r.game_id));
  } catch (err) {
    console.error("GET /api/game-alerts failed:", err);
    res.status(500).json({ error: "Failed to load game alerts" });
  }
});

gameAlertsRouter.put("/:gameId", requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.gameId)) {
    res.status(400).json({ error: "Invalid game", code: "INVALID_GAME" });
    return;
  }
  try {
    // Only games that haven't finished; one statement, existing bell is a no-op.
    const rows = await db.execute<{ ok: number }>(sql`
      with g as (select id from games where id = ${req.params.gameId} and status <> 'final'),
      ins as (
        insert into game_alerts (user_id, game_id) select ${req.userId!}, id from g
        on conflict (user_id, game_id) do nothing
      )
      select count(*)::int ok from g
    `);
    if (!rows[0]?.ok) {
      res.status(404).json({ error: "Game not found or already finished", code: "GAME_UNAVAILABLE" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    console.error("PUT /api/game-alerts failed:", err);
    res.status(500).json({ error: "Failed to turn on alerts" });
  }
});

gameAlertsRouter.delete("/:gameId", requireAuth, async (req, res) => {
  if (!UUID_RE.test(req.params.gameId)) {
    res.status(400).json({ error: "Invalid game", code: "INVALID_GAME" });
    return;
  }
  try {
    await db.execute(sql`delete from game_alerts where user_id = ${req.userId!} and game_id = ${req.params.gameId}`);
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/game-alerts failed:", err);
    res.status(500).json({ error: "Failed to turn off alerts" });
  }
});
