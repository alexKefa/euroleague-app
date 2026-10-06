import { Router } from "express";
import { getRefereeStats, type RefereeStats } from "../services/refereeStats.js";

// Referee tracker (2026-10-06), see services/refereeStats.ts.
export const refereesRouter = Router();

// Two seasons of box scores aggregated per referee is the heaviest query
// in the app, and it only changes when a game goes final, so it is cached
// in memory for half an hour.
const CACHE_MS = 30 * 60 * 1000;
let cached: { at: number; data: RefereeStats } | null = null;

refereesRouter.get("/", async (_req, res) => {
  try {
    if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), data: await getRefereeStats() };
    res.json(cached.data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load referee stats" });
  }
});
