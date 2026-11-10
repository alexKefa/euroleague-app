// End-to-end reconnection check against a LOCAL server on the DEV database:
//   1. a dropped socket reconnects into the same seat (same sessionId, marked
//      disconnected and then connected again for everyone else);
//   2. the same account joining from a "second tab" closes the first one
//      with CLOSE_REPLACED (so the client shows "opened elsewhere" and does
//      not auto-rejoin).
//
//   (terminal 1) $env:DISABLE_BACKGROUND_JOBS="1"; npx tsx src/index.ts
//   (terminal 2) npm run check:reconnect
import "dotenv/config";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import { Client, type Room } from "@colyseus/sdk";
import { CLOSE_REPLACED, MSG } from "../../../shared/court/protocol.js";

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:4000";
const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).hostname.includes("ep-sparkling-pond")) {
  console.error("check:reconnect only runs against the dev DB (EuroleagueDev).");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require", max: 1 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fail(msg: string): never {
  console.error(`RECONNECT CHECK FAILED: ${msg}`);
  process.exit(1);
}

async function waitFor(what: string, pred: () => boolean, timeoutMs: number): Promise<number> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) fail(`timed out waiting for ${what}`);
    await sleep(25);
  }
  return Date.now() - start;
}

async function main(): Promise<void> {
  const users = await sql<{ id: string }[]>`select id from users order by created_at limit 2`;
  if (users.length < 2) fail("need 2 users in the dev DB");
  const token = (id: string) => jwt.sign({ sub: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "10m" });

  const created = await fetch(`${BASE}/api/courts`, { method: "POST", headers: { authorization: `Bearer ${token(users[0]!.id)}` } });
  const { code } = (await created.json()) as { code: string };

  const client = new Client(`${BASE}/colyseus`);
  const join = async (userId: string): Promise<Room> => {
    const room = await client.joinOrCreate("court", { code, accessToken: token(userId) });
    for (const t of [MSG.toast, MSG.seed, MSG.shot, MSG.correction, MSG.horseEvent]) room.onMessage(t, () => {});
    // Same settings as the app (frontend court-net.ts).
    room.reconnection.maxRetries = 10;
    room.reconnection.minUptime = 1000;
    return room;
  };

  const A = await join(users[0]!.id);
  const B = await join(users[1]!.id);
  const seen = (sid: string) => (B.state as any)?.players?.get(sid);
  await waitFor("both players in state", () => !!seen(A.sessionId) && !!seen(B.sessionId), 3000);
  await sleep(1200); // past minUptime

  // 1. Drop A's socket without a goodbye.
  let dropped = 0;
  let reconnected = 0;
  let leftCode: number | null = null;
  A.onDrop(() => dropped++);
  A.onReconnect(() => reconnected++);
  A.onLeave((c: number) => (leftCode = c));
  const sid = A.sessionId;
  (A as any).connection.close();
  await waitFor("A's onDrop", () => dropped === 1, 3000);
  await waitFor("others to see A disconnected", () => seen(sid)?.connected === false, 3000);
  const ms = await waitFor("A to reconnect", () => reconnected === 1, 10000);
  await waitFor("others to see A back", () => seen(sid)?.connected === true, 3000);
  if (A.sessionId !== sid) fail("A came back with a different seat");
  if (leftCode !== null) fail(`A left with ${leftCode} instead of reconnecting`);
  console.log(`ok  dropped socket reconnected into the same seat in ${ms} ms`);

  // A sends again after reconnecting (the client's send guard is lifted).
  A.send(MSG.seedRequest);

  // 2. A "second tab" for B's account replaces B's seat.
  let bCode: number | null = null;
  B.onLeave((c: number) => (bCode = c));
  const B2 = await join(users[1]!.id);
  await waitFor("B's first tab to close", () => bCode !== null, 5000);
  if (bCode !== CLOSE_REPLACED) fail(`first tab closed with ${bCode}, expected ${CLOSE_REPLACED}`);
  console.log(`ok  second tab closed the first with CLOSE_REPLACED (${CLOSE_REPLACED})`);

  await A.leave(true);
  await B2.leave(true);
  await sql`update courts set is_active = false where code = ${code}`;
  await sql.end();
  console.log("RECONNECT CHECK PASSED");
  process.exit(0);
}

main().catch((e) => fail(String(e?.stack ?? e)));
