// Server-side memory-leak check for Clutch Court (CLUTCH_COURT_SPEC.md M5).
// Runs the room server IN THIS PROCESS on a random port, against the DEV DB:
//   A. 6,000 shot simulations on the shared Rapier world: WASM memory must plateau.
//   B. 20 full court lifecycles (create, 3 players join, move, shoot, start and
//      abandon H-O-R-S-E, everyone leaves, room disposes): after a forced GC the
//      heap must not keep growing, and no room may outlive its players.
// Cleans up the courts and H-O-R-S-E rows it created.
//
//   npm run check:leaks      (takes ~1 minute)
import "dotenv/config";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import type { Room } from "@colyseus/sdk";

const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).hostname.includes("ep-sparkling-pond")) {
  console.error("check:leaks only runs against the dev DB (EuroleagueDev).");
  process.exit(1);
}
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) {
  console.error("Run with --expose-gc (npm run check:leaks does this).");
  process.exit(1);
}
// Rooms dispose 300 ms after the last player leaves (5 min in production).
process.env.COURT_EMPTY_DISPOSE_MS = "300";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
function fail(msg: string): never {
  console.error(`LEAK CHECK FAILED: ${msg}`);
  process.exit(1);
}
async function settle(): Promise<NodeJS.MemoryUsage> {
  for (let i = 0; i < 3; i++) {
    gc!();
    await sleep(50);
  }
  return process.memoryUsage();
}

async function main(): Promise<void> {
  const { courtMatchmakingMiddleware, startCourtServer } = await import("../court/server.js");
  const { courtPhysics } = await import("../court/physics.js");
  const { courtsRouter } = await import("../routes/courts.js");
  const { matchMaker } = await import("@colyseus/core");
  const { Client } = await import("@colyseus/sdk");
  const { COLYSEUS_PATH, MSG } = await import("../../../shared/court/protocol.js");
  const { computeShotLaunch } = await import("../../../shared/court/shot.js");

  const app = express();
  app.use(COLYSEUS_PATH, courtMatchmakingMiddleware());
  app.use(express.json());
  app.use("/api/courts", courtsRouter);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  await startCourtServer(server);
  const BASE = `http://localhost:${port}`;

  // ---------- A. physics ----------
  const physics = courtPhysics();
  const runShots = (n: number) => {
    for (let i = 0; i < n; i++) {
      const x = ((i % 13) - 6) * 0.6;
      const z = -9 + (i % 7) * 0.9;
      physics.simulate(computeShotLaunch(x, z, "A", ((i % 21) - 10) / 20, i * 2654435761));
    }
  };
  runShots(500); // warm-up: lets Rapier's arenas reach their working size
  const a0 = await settle();
  runShots(3000);
  const a1 = await settle();
  runShots(3000);
  const a2 = await settle();
  console.log(`A  physics rss: ${mb(a0.rss)} -> ${mb(a1.rss)} -> ${mb(a2.rss)} MB after 3k + 3k shots`);
  const physGrowth = a2.rss - a1.rss;
  if (physGrowth > 8 * 1024 * 1024) fail(`physics memory still growing (+${mb(physGrowth)} MB over the second 3k shots)`);

  // ---------- B. room lifecycles ----------
  const sql = postgres(url, { ssl: "require", max: 1 });
  const users = await sql<{ id: string }[]>`select id from users order by created_at limit 3`;
  if (users.length < 3) fail("need 3 users in the dev DB");
  const token = (id: string) => jwt.sign({ sub: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "10m" });
  const codes: string[] = [];

  const ROUNDS = Math.max(20, Number(process.env.LEAK_ROUNDS) || 20);
  const heap: number[] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const res = await fetch(`${BASE}/api/courts`, { method: "POST", headers: { authorization: `Bearer ${token(users[0]!.id)}` } });
    const { code } = (await res.json()) as { code: string };
    if (codes.includes(code)) fail(`round ${round}: got the previous court ${code} back (its room did not dispose)`);
    codes.push(code);

    const client = new Client(`${BASE}${COLYSEUS_PATH}`);
    const rooms: Room[] = [];
    let shots = 0;
    for (const u of users) {
      const room = await client.joinOrCreate("court", { code, accessToken: token(u.id) });
      for (const t of [MSG.toast, MSG.seed, MSG.correction, MSG.horseEvent, MSG.shotRejected]) room.onMessage(t, () => {});
      room.onMessage(MSG.shot, () => shots++);
      rooms.push(room);
    }
    // Move a little, shoot once each, start H-O-R-S-E, then everyone leaves mid-game.
    for (let step = 1; step <= 5; step++) {
      for (const [i, room] of rooms.entries()) room.send(MSG.move, { x: (i - 1) * 2, z: -6 + step * 0.05, rotY: 0, anim: "run" });
      await sleep(60);
    }
    rooms.forEach((room, i) => room.send(MSG.shoot, { clientShotId: 1, timingError: 0, hoopId: "A", x: (i - 1) * 2, z: -5.75 }));
    const until = Date.now() + 3000;
    while (shots < rooms.length * rooms.length && Date.now() < until) await sleep(25);
    if (shots < rooms.length * rooms.length) fail(`round ${round}: only ${shots} shot messages arrived`);
    rooms[0]!.send(MSG.horseStart);
    await sleep(150);
    for (const room of rooms) await room.leave(true);
    await sleep(600);

    const alive = await matchMaker.query({ name: "court" });
    if (alive.length) fail(`round ${round}: ${alive.length} room(s) still alive after everyone left`);
    const m = await settle();
    heap.push(m.heapUsed);
    if (process.env.LEAK_SNAPSHOT && (round === 20 || round === ROUNDS)) {
      const { writeHeapSnapshot } = await import("node:v8");
      console.log(`snapshot ${writeHeapSnapshot(`${process.env.LEAK_SNAPSHOT}-r${round}.heapsnapshot`)}`);
    }
    if (round % 10 === 0) console.log(`B  round ${String(round).padStart(2)}: heap ${mb(m.heapUsed)} MB, rss ${mb(m.rss)} MB, rooms alive 0`);
  }

  // Compare the last 5 rounds to rounds 6-10 (the first few warm up caches and JIT).
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const early = avg(heap.slice(5, 10));
  const late = avg(heap.slice(ROUNDS - 5, ROUNDS));
  const perRound = (late - early) / (ROUNDS - 10);
  console.log(`B  heap rounds 6-10 avg ${mb(early)} MB, rounds ${ROUNDS - 4}-${ROUNDS} avg ${mb(late)} MB (${(perRound / 1024).toFixed(0)} KB/round)`);

  await sql`delete from horse_game_players where game_id in (select g.id from horse_games g join courts c on c.id = g.court_id where c.code in ${sql(codes)})`;
  await sql`delete from horse_games where court_id in (select id from courts where code in ${sql(codes)})`;
  await sql`delete from courts where code in ${sql(codes)}`;
  await sql.end();

  // 100 KB/round would be 100 MB after 1,000 courts: a real leak. Noise is well under that.
  if (perRound > 100 * 1024) fail(`heap grows ~${(perRound / 1024).toFixed(0)} KB per court lifecycle`);
  console.log("LEAK CHECK PASSED");
  process.exit(0);
}

main().catch((e) => fail(String(e?.stack ?? e)));
