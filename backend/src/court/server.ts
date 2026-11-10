// Mounts Colyseus inside the existing Express process (M0 decision: no
// separate Railway service). Deliberately does NOT use Server.listen() or
// serverless(): those bind Colyseus' own HTTP router to the whole server
// (CORS headers on every response, a "/" route). Instead:
//   - the matchmaking POST is an Express middleware under COLYSEUS_PATH;
//   - only WebSocket upgrades under COLYSEUS_PATH reach the transport.
import type http from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import type { RequestHandler } from "express";
import { Server, createNodeMatchmakingMiddleware, matchMaker } from "@colyseus/core";
import { setTransport } from "@colyseus/core/Transport";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { COLYSEUS_PATH, ROOM_NAME } from "../../../shared/court/protocol.js";
import { CourtRoom } from "./courtRoom.js";
import { initCourtPhysics } from "./physics.js";

let transport: WebSocketTransport | null = null;

/** Express middleware for POST {COLYSEUS_PATH}/matchmake/... (mount before body parsers). */
export function courtMatchmakingMiddleware(): RequestHandler {
  const handle = createNodeMatchmakingMiddleware();
  return (req, res, next) => {
    // Matchmaking is only meaningful once the room server is up.
    if (!transport) {
      res.status(503).json({ error: "court server starting" });
      return;
    }
    void handle(req, res, next);
  };
}

/** Attach the room server to the app's HTTP server. Call once, after listen(). */
export async function startCourtServer(httpServer: http.Server): Promise<void> {
  // Shots are simulated server-side (M3): Rapier must be ready before any room.
  await initCourtPhysics();
  const t = new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 });
  t.attachToServer(httpServer, {
    filter: (req) => (req.url ?? "").startsWith(`${COLYSEUS_PATH}/`),
  });
  const server = new Server({ transport: t, greet: false, gracefullyShutdown: false });
  server.define(ROOM_NAME, CourtRoom).filterBy(["code"]);
  // listen() would do these two; we skip listen() (see header).
  setTransport(t);
  await matchMaker.accept();
  transport = t;
  console.log(`[court] room server ready at ${COLYSEUS_PATH}`);
  startStatsLog();
}

/**
 * One log line per interval (default 60 s) while any court is open: rooms,
 * players, process CPU, memory and event-loop lag. Silent when no court is
 * open. CPU is the whole process (API included). COURT_STATS_MS overrides
 * the interval (the load test uses 10 s).
 */
function startStatsLog(): void {
  const every = Number(process.env.COURT_STATS_MS) || 60_000;
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  let lastCpu = process.cpuUsage();
  let lastAt = performance.now();
  setInterval(() => {
    void (async () => {
      const now = performance.now();
      const cpu = process.cpuUsage(lastCpu);
      const cpuPct = ((cpu.user + cpu.system) / 1000 / (now - lastAt)) * 100;
      lastCpu = process.cpuUsage();
      lastAt = now;
      const rooms = await matchMaker.query({ name: ROOM_NAME });
      if (rooms.length) {
        const players = rooms.reduce((n, r) => n + (r.clients ?? 0), 0);
        const mem = process.memoryUsage();
        const ms = (ns: number) => (ns / 1e6).toFixed(1);
        console.log(
          `[court] stats rooms=${rooms.length} players=${players} cpu=${cpuPct.toFixed(1)}% ` +
            `rss=${Math.round(mem.rss / 1048576)}MB heap=${Math.round(mem.heapUsed / 1048576)}MB ` +
            `lag_p50=${ms(lag.percentile(50))}ms lag_p99=${ms(lag.percentile(99))}ms lag_max=${ms(lag.max)}ms`
        );
      }
      lag.reset();
    })().catch(() => {});
  }, every).unref();
}
