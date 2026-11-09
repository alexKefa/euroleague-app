// End-to-end H-O-R-S-E check against a LOCAL server on the DEV database:
// three scripted players play a full game with one turn timeout and one
// dropped connection, then the saved result is verified.
//
//   (terminal 1) $env:DISABLE_BACKGROUND_JOBS="1"; npx tsx src/index.ts
//   (terminal 2) npm run check:horse
//
// Takes ~1.5 minutes (it waits out a real 20 s timeout and 30 s disconnect).
import "dotenv/config";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import { Client, type Room } from "@colyseus/sdk";
import { rimCenter } from "../../../shared/court/geometry.js";
import { MSG } from "../../../shared/court/protocol.js";

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:4000";
const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).hostname.includes("ep-sparkling-pond")) {
  console.error("check:horse only runs against the dev DB (EuroleagueDev).");
  process.exit(1);
}

const sql = postgres(url, { ssl: "require", max: 1 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fail(msg: string): never {
  console.error(`HORSE CHECK FAILED: ${msg}`);
  process.exit(1);
}

async function waitFor(what: string, pred: () => boolean, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > until) fail(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

interface HorseEvt {
  kind: string;
  playerId: string | null;
  letters?: string;
}

const rim = rimCenter("A");
const SET_SPOT = { x: 0, z: rim.z + 4 };
const OUTSIDE = { x: 0, z: rim.z + 7.5 };

async function main(): Promise<void> {
  const users = await sql<{ id: string; username: string }[]>`select id, username from users order by created_at limit 3`;
  if (users.length < 3) fail("need 3 users in the dev DB");
  const token = (id: string) => jwt.sign({ sub: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "10m" });

  const created = await fetch(`${BASE}/api/courts`, { method: "POST", headers: { authorization: `Bearer ${token(users[0]!.id)}` } });
  const { code } = (await created.json()) as { code: string };
  const [court] = await sql<{ id: string }[]>`select id from courts where code = ${code}`;

  const client = new Client(`${BASE}/colyseus`);
  const rooms: Room[] = [];
  const events: HorseEvt[] = [];
  const rejections: { sid: string; reason?: string }[] = [];
  for (const u of users) {
    const room = await client.joinOrCreate("court", { code, accessToken: token(u.id) });
    room.onMessage(MSG.horseEvent, (m: HorseEvt) => {
      if (room === rooms[0]) events.push(m);
    });
    room.onMessage(MSG.shotRejected, (m: { reason?: string }) => rejections.push({ sid: room.sessionId, reason: m.reason }));
    for (const t of [MSG.toast, MSG.seed, MSG.shot, MSG.correction]) room.onMessage(t, () => {});
    rooms.push(room);
  }
  const [A, , C] = rooms as [Room, Room, Room];
  let B = rooms[1]!;
  const st = () => A.state as any;
  const player = (sid: string) => st().players.get(sid);
  let shotId = 0;

  async function moveTo(room: Room, target: { x: number; z: number }): Promise<void> {
    for (;;) {
      const p = player(room.sessionId);
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) return;
      const k = Math.min(1, 0.2 / d);
      room.send(MSG.move, { x: p.x + dx * k, z: p.z + dz * k, rotY: Math.PI, anim: "run" });
      await sleep(70);
    }
  }

  function shoot(room: Room, timingError: number): void {
    const p = player(room.sessionId);
    room.send(MSG.shoot, { clientShotId: ++shotId, timingError, hoopId: "A", x: p.x, z: p.z });
  }

  await sleep(300);
  A.send(MSG.horseStart);
  await waitFor("game start", () => st().phase === "setting", 3000);
  if (st().turnId !== A.sessionId) fail("first setter should be the first joiner");

  // Server gating: not your turn / outside the arc.
  shoot(B, 0);
  await moveTo(A, OUTSIDE);
  shoot(A, 0);
  await waitFor("rejections", () => rejections.length >= 2, 3000);
  if (!rejections.some((r) => r.sid === B.sessionId && r.reason === "notYourTurn")) fail("B shooting out of turn was not rejected");
  if (!rejections.some((r) => r.sid === A.sessionId && r.reason === "outsideArc")) fail("A setting from outside the arc was not rejected");

  // B "reloads the page": a fresh connection for the same account mid-game.
  const oldB = B.sessionId;
  const B2 = await client.joinOrCreate("court", { code, accessToken: token(users[1]!.id) });
  for (const t of [MSG.toast, MSG.seed, MSG.shot, MSG.correction, MSG.horseEvent]) B2.onMessage(t, () => {});
  B2.onMessage(MSG.shotRejected, (m: { reason?: string }) => rejections.push({ sid: B2.sessionId, reason: m.reason }));
  await waitFor("B's seat to move to the new session", () => {
    const order: string[] = [];
    st().turnOrder.forEach((id: string) => order.push(id));
    return order.includes(B2.sessionId) && !order.includes(oldB);
  }, 5000);
  await sleep(300);
  if (player(B2.sessionId)?.eliminated) fail("reloading the page eliminated B");
  B = B2;
  rooms[1] = B2;

  let timedOut = false;
  let dropped = false;
  const started = Date.now();
  while (st().phase !== "over" && st().phase !== "free") {
    if (Date.now() - started > 4 * 60 * 1000) fail("game did not finish in 4 minutes");
    const turn: string = st().turnId;
    const phase: string = st().phase;
    const room = rooms.find((r) => r.sessionId === turn);
    if (!room || room === C) {
      await sleep(100);
      continue;
    }
    // One deliberate timeout: B's first matching turn.
    if (!timedOut && room === B && phase === "matching") {
      timedOut = true;
      const before = player(B.sessionId).letters;
      await waitFor("timeout letter", () => player(B.sessionId).letters.length === before.length + 1, 25000);
      // Then C drops without saying goodbye (no auto-reconnect).
      (C as any).reconnection.enabled = false;
      (C as any).connection.close();
      dropped = true;
      continue;
    }
    const target = phase === "setting" ? SET_SPOT : { x: st().spotX, z: st().spotZ };
    await moveTo(room, target);
    // Setters and A shoot perfectly; B misses once C is out (or until 3 letters), so C is eliminated first.
    // C is removed from the room state once its reconnection window closes, so missing counts as out.
    const cOut = dropped && (!player(C.sessionId) || player(C.sessionId).eliminated);
    const bMisses = room === B && phase === "matching" && (cOut || player(B.sessionId).letters.length < 3);
    shoot(room, bMisses ? 1 : 0);
    await waitFor("turn to advance", () => st().turnId !== turn || st().phase !== phase || st().phase === "over", 15000);
  }

  if (!timedOut || !dropped) fail("scenario did not include the timeout and the drop");
  const winnerEvt = events.find((e) => e.kind === "winner") as (HorseEvt & { standings?: { id: string; placement: number }[] }) | undefined;
  if (!winnerEvt) fail("no winner event");
  if (winnerEvt.playerId !== A.sessionId) fail(`expected A to win, got ${winnerEvt.playerId}`);
  const ranked = (winnerEvt.standings ?? []).map((s) => s.id);
  if (JSON.stringify(ranked) !== JSON.stringify([A.sessionId, B.sessionId, C.sessionId])) fail(`winner standings ${JSON.stringify(ranked)}`);
  await waitFor("return to shootaround", () => st().phase === "free", 11000);

  await sleep(500);
  const [game] = await sql<{ id: string; winner_user_id: string | null }[]>`
    select id, winner_user_id from horse_games where court_id = ${court!.id} order by started_at desc limit 1`;
  if (!game) fail("no horse_games row");
  if (game.winner_user_id !== users[0]!.id) fail("saved winner is not A");
  const rows = await sql<{ user_id: string; placement: number; final_letters: string }[]>`
    select user_id, placement, final_letters from horse_game_players where game_id = ${game.id} order by placement`;
  const placements = rows.map((r) => [users.findIndex((u) => u.id === r.user_id), r.placement]);
  if (JSON.stringify(placements) !== JSON.stringify([[0, 1], [1, 2], [2, 3]])) fail(`unexpected placements ${JSON.stringify(placements)}`);
  if (rows[1]!.final_letters !== "HORSE") fail(`B should have HORSE, has ${rows[1]!.final_letters}`);

  console.log("HORSE CHECK OK", JSON.stringify(rows));
  for (const r of [A, B]) await r.leave();
  await sql.end();
  process.exit(0);
}

main().catch((err) => fail(String(err?.stack ?? err)));
