import { Response } from "express";

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
