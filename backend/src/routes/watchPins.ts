// Server copy of the pinned watch (2026-10-12): lets the server push
// close/final alerts for pinned games and players (services/teamPush.ts).
// The browser keeps its own copy in localStorage and syncs on login.
// Spec: docs/superpowers/specs/2026-10-12-team-push-design.md
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { requireAuth } from "../auth/middleware.js";

export const watchPinsRouter = Router();

export const MAX_PINS = 3; // same as the frontend's MAX_WATCHES
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isKind = (k: unknown): k is "game" | "player" => k === "game" || k === "player";

watchPinsRouter.get("/", requireAuth, async (req, res) => {
  try {
    const rows = await db.execute<{ kind: string; target_id: string; game_id: string }>(
      sql`select kind, target_id, game_id from watch_pins where user_id = ${req.userId!} order by created_at`
    );
    res.json(rows.map((r) => ({ kind: r.kind, targetId: r.target_id, gameId: r.game_id })));
  } catch (err) {
    console.error("GET /api/watch-pins failed:", err);
    res.status(500).json({ error: "Failed to load pins" });
  }
});

watchPinsRouter.put("/", requireAuth, async (req, res) => {
  const { kind, targetId, gameId } = req.body ?? {};
  if (!isKind(kind) || !UUID_RE.test(String(targetId)) || !UUID_RE.test(String(gameId))) {
    res.status(400).json({ error: "Invalid pin", code: "INVALID_PIN" });
    return;
  }
  try {
    // One statement: insert only while under the limit; an existing pin is a no-op.
    const inserted = await db.execute<{ user_id: string }>(sql`
      insert into watch_pins (user_id, kind, target_id, game_id)
      select ${req.userId!}, ${kind}, ${targetId}, ${gameId}
      where (select count(*) from watch_pins where user_id = ${req.userId!}) < ${MAX_PINS}
        or exists (select 1 from watch_pins where user_id = ${req.userId!} and kind = ${kind} and target_id = ${targetId})
      on conflict (user_id, kind, target_id) do nothing
      returning user_id
    `);
    if (inserted.length === 0) {
      const [{ n }] = await db.execute<{ n: number }>(sql`
        select count(*)::int n from watch_pins where user_id = ${req.userId!} and kind = ${kind} and target_id = ${targetId}`);
      if (n === 0) {
        res.status(409).json({ error: "Pin limit reached", code: "PIN_LIMIT" });
        return;
      }
    }
    res.status(204).send();
  } catch (err) {
    console.error("PUT /api/watch-pins failed:", err);
    res.status(500).json({ error: "Failed to pin" });
  }
});

watchPinsRouter.delete("/:kind/:targetId", requireAuth, async (req, res) => {
  if (!isKind(req.params.kind) || !UUID_RE.test(req.params.targetId)) {
    res.status(400).json({ error: "Invalid pin", code: "INVALID_PIN" });
    return;
  }
  try {
    await db.execute(sql`delete from watch_pins where user_id = ${req.userId!} and kind = ${req.params.kind} and target_id = ${req.params.targetId}`);
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/watch-pins failed:", err);
    res.status(500).json({ error: "Failed to unpin" });
  }
});
