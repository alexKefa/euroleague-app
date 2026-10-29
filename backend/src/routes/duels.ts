import { Router, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { requireAuth } from "../auth/middleware.js";
import {
  DuelError,
  acceptDuel,
  buildSnapshots,
  cancelDuel,
  commitMove,
  createDuel,
  declineDuel,
  getDuelView,
  getLadder,
  getMyRating,
  listMyDuels,
  listOpenDuels,
} from "../services/duels.js";

import { CATEGORY_SCALES } from "../services/duelEngine.js";

export const duelsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A malformed id can never match a row; answer 404 instead of letting Postgres 500.
duelsRouter.param("id", (_req, res, next, id) => {
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "NOT_FOUND", code: "NOT_FOUND" });
    return;
  }
  next();
});

function fail(res: Response, label: string, err: unknown): void {
  if (err instanceof DuelError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  console.error(`${label} failed:`, err);
  res.status(500).json({ error: "Duel request failed", code: "DUEL_FAILED" });
}

const isLineup = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const badBody = (res: Response, error: string) => res.status(400).json({ error, code: "INVALID_REQUEST_BODY" });

duelsRouter.post("/", requireAuth, async (req, res) => {
  try {
    const { lineup, opponentUserId, leagueId } = req.body ?? {};
    if (!isLineup(lineup)) return void badBody(res, "lineup must be an array of card ids");
    if (opponentUserId !== undefined && typeof opponentUserId !== "string") return void badBody(res, "opponentUserId must be a string");
    if (leagueId !== undefined && typeof leagueId !== "string") return void badBody(res, "leagueId must be a string");
    const view = await createDuel(req.userId!, { lineup, opponentUserId, leagueId });
    res.status(201).json(view);
  } catch (err) {
    fail(res, "POST /api/duels", err);
  }
});

duelsRouter.get("/open", requireAuth, async (req, res) => {
  try {
    res.json(await listOpenDuels(req.userId!));
  } catch (err) {
    fail(res, "GET /api/duels/open", err);
  }
});

duelsRouter.get("/mine", requireAuth, async (req, res) => {
  try {
    res.json(await listMyDuels(req.userId!));
  } catch (err) {
    fail(res, "GET /api/duels/mine", err);
  }
});

duelsRouter.get("/ladder", requireAuth, async (req, res) => {
  try {
    const { leagueId } = req.query;
    const league = typeof leagueId === "string" && leagueId ? leagueId : null;
    if (league) {
      if (!UUID_RE.test(league)) return void res.status(404).json({ error: "NOT_FOUND", code: "NOT_FOUND" });
      const [m] = await db.execute<{ ok: number }>(
        sql`select 1 as ok from league_members where league_id = ${league} and user_id = ${req.userId!} limit 1`
      );
      if (!m) return void res.status(403).json({ error: "NOT_A_MEMBER", code: "NOT_A_MEMBER" });
    }
    res.json(await getLadder(league));
  } catch (err) {
    fail(res, "GET /api/duels/ladder", err);
  }
});

duelsRouter.get("/me/rating", requireAuth, async (req, res) => {
  try {
    res.json(await getMyRating(req.userId!));
  } catch (err) {
    fail(res, "GET /api/duels/me/rating", err);
  }
});

// Per-card base lines and multipliers for the lineup builder. Ownership is
// checked, lineup validity is not (the user is still choosing).
duelsRouter.post("/preview", requireAuth, async (req, res) => {
  try {
    const raw = req.body?.ids;
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) return void badBody(res, "ids must be an array of card ids");
    const ids = [...new Set(raw as string[])];
    if (ids.length > 1000 || ids.some((id) => !UUID_RE.test(id))) return void badBody(res, "ids must be up to 1000 card ids");
    const cards = ids.length ? await buildSnapshots(req.userId!, ids, { validate: false }) : [];
    res.json({ scales: CATEGORY_SCALES, cards });
  } catch (err) {
    fail(res, "POST /api/duels/preview", err);
  }
});

duelsRouter.get("/:id", requireAuth, async (req, res) => {
  try {
    res.json(await getDuelView(req.params.id, req.userId!));
  } catch (err) {
    fail(res, "GET /api/duels/:id", err);
  }
});

duelsRouter.post("/:id/accept", requireAuth, async (req, res) => {
  try {
    const { lineup } = req.body ?? {};
    if (!isLineup(lineup)) return void badBody(res, "lineup must be an array of card ids");
    res.json(await acceptDuel(req.userId!, req.params.id, lineup));
  } catch (err) {
    fail(res, "POST /api/duels/:id/accept", err);
  }
});

duelsRouter.post("/:id/decline", requireAuth, async (req, res) => {
  try {
    await declineDuel(req.userId!, req.params.id);
    res.json({ status: "declined" });
  } catch (err) {
    fail(res, "POST /api/duels/:id/decline", err);
  }
});

duelsRouter.post("/:id/cancel", requireAuth, async (req, res) => {
  try {
    await cancelDuel(req.userId!, req.params.id);
    res.json({ status: "cancelled" });
  } catch (err) {
    fail(res, "POST /api/duels/:id/cancel", err);
  }
});

duelsRouter.post("/:id/commit", requireAuth, async (req, res) => {
  try {
    const { quarter, slot } = req.body ?? {};
    if (!Number.isInteger(quarter) || !Number.isInteger(slot)) return void badBody(res, "quarter and slot must be integers");
    res.json(await commitMove(req.userId!, req.params.id, quarter, slot));
  } catch (err) {
    fail(res, "POST /api/duels/:id/commit", err);
  }
});
