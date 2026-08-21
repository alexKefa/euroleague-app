import { Router } from "express";
import { registerClient } from "../realtime/hub.js";
import { startSimulation, stopSimulation, isSimulationRunning } from "../realtime/liveScoreSimulator.js";
import { verifyAccessToken } from "../auth/tokens.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";

export const eventsRouter = Router();

// The live-score stream is public (same data a logged-out visitor sees on
// /schedule), so this endpoint doesn't require auth. It still resolves a
// userId when a token is present — via query param, since EventSource can't
// set an Authorization header — so a future per-user channel (trade
// updates, see project memory) can reuse this same connection instead of
// opening a second one.
eventsRouter.get("/", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  let userId: string | null = null;
  if (token) {
    try {
      userId = verifyAccessToken(token).sub;
    } catch {
      // Invalid/expired token: fall back to an anonymous connection rather
      // than rejecting it — the caller still gets live scores.
    }
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const unregister = registerClient(res, userId);
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unregister();
  });
});

// Testing tool, not a real feed — see realtime/liveScoreSimulator.ts.
eventsRouter.post("/simulate", requireAuth, requireAdmin, async (req, res) => {
  try {
    const gameId = typeof req.body?.gameId === "string" ? req.body.gameId : undefined;
    const result = await startSimulation(gameId);
    if ("error" in result) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    console.error("POST /api/events/simulate failed:", err);
    res.status(500).json({ error: "Failed to start live-game simulation" });
  }
});

eventsRouter.post("/simulate/stop", requireAuth, requireAdmin, async (_req, res) => {
  try {
    await stopSimulation();
    res.json({ running: isSimulationRunning() });
  } catch (err) {
    console.error("POST /api/events/simulate/stop failed:", err);
    res.status(500).json({ error: "Failed to stop live-game simulation" });
  }
});
