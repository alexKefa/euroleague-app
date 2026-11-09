// Mounts Colyseus inside the existing Express process (M0 decision: no
// separate Railway service). Deliberately does NOT use Server.listen() or
// serverless(): those bind Colyseus' own HTTP router to the whole server
// (CORS headers on every response, a "/" route). Instead:
//   - the matchmaking POST is an Express middleware under COLYSEUS_PATH;
//   - only WebSocket upgrades under COLYSEUS_PATH reach the transport.
import type http from "node:http";
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
}
