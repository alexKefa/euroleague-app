import { Router } from "express";
import { getRefereeStats, getRefereeDetail, type RefereeStats } from "../services/refereeStats.js";

// Referee tracker (2026-10-06), see services/refereeStats.ts.
export const refereesRouter = Router();

// Two seasons of box scores aggregated per referee is the heaviest query
// in the app, and it only changes when a game goes final, so it is cached
// in memory for half an hour (also reused by the detail route below).
const CACHE_MS = 30 * 60 * 1000;
let cached: { at: number; data: RefereeStats } | null = null;

async function cachedRefereeStats(): Promise<RefereeStats> {
  if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), data: await getRefereeStats() };
  return cached.data;
}

refereesRouter.get("/", async (_req, res) => {
  try {
    res.json(await cachedRefereeStats());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load referee stats" });
  }
});

// One referee, with every team they've worked (referee x team, 2026-10-06).
refereesRouter.get("/:id", async (req, res) => {
  try {
    const detail = await getRefereeDetail(req.params.id, await cachedRefereeStats());
    if (!detail.referee) return res.status(404).json({ error: "Referee not found" });
    res.json(detail);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load referee" });
  }
});
