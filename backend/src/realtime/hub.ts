import { Response } from "express";

// One real basket, produced by whichever tick source is currently driving a
// live game (the simulator, or the real liveGamesSync.ts poll) and folded
// into that tick's "game-update" broadcast. Both producers build this
// independently (the simulator knows the exact scorer; liveGamesSync.ts
// derives it by diffing consecutive box-score polls — see that file's own
// comment), but the shape is shared so the frontend's scoring feed /
// momentum bar don't care which source it came from.
export interface ScoringEvent {
  playerId: string;
  playerName: string;
  teamSide: "home" | "away";
  points: number;
  /** The scorer's own running point total after this basket. */
  totalPoints: number;
}

interface Client {
  res: Response;
  userId: string | null;
}

// One process, in-memory — fine for the single Railway instance this runs
// on. Would need a pub/sub layer (e.g. Redis) if this ever ran on more
// than one instance, since clients connected to instance A would never see
// broadcasts triggered on instance B.
const clients = new Set<Client>();

export function registerClient(res: Response, userId: string | null): () => void {
  const client: Client = { res, userId };
  clients.add(client);
  return () => clients.delete(client);
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Push to every connected client, e.g. live game score updates. */
export function broadcast(event: string, data: unknown): void {
  const payload = frame(event, data);
  for (const client of clients) client.res.write(payload);
}

/** Push to only the connections belonging to one user, e.g. a trade update. */
export function sendToUser(userId: string, event: string, data: unknown): void {
  const payload = frame(event, data);
  for (const client of clients) {
    if (client.userId === userId) client.res.write(payload);
  }
}
