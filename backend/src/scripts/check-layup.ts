// End-to-end layup check against a LOCAL server (dev DB): the server only
// simulates a layup when the player is really driving at the rim.
//
//   (terminal 1) $env:DISABLE_BACKGROUND_JOBS="1"; npx tsx src/index.ts
//   (terminal 2) npm run check:layup
import "dotenv/config";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import { Client } from "@colyseus/sdk";
import { MSG, MOVE_HZ, type ShotMessage } from "../../../shared/court/protocol.js";
import { rimCenter } from "../../../shared/court/geometry.js";

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:4000";
const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).hostname.includes("ep-sparkling-pond")) {
  console.error("check:layup only runs against the dev DB (EuroleagueDev).");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 1 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fail(msg: string): never {
  console.error(`LAYUP CHECK FAILED: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [u] = await sql<{ id: string }[]>`select id from users order by created_at limit 1`;
  const token = jwt.sign({ sub: u!.id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "10m" });
  const res = await fetch(`${BASE}/api/courts`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const { code } = (await res.json()) as { code: string };
  const room = await new Client(`${BASE}/colyseus`).joinOrCreate("court", { code, accessToken: token });
  const shots: ShotMessage[] = [];
  for (const t of [MSG.toast, MSG.seed, MSG.correction, MSG.horseEvent, MSG.shotRejected]) room.onMessage(t, () => {});
  room.onMessage(MSG.shot, (m: ShotMessage) => shots.push(m));
  await sleep(300);

  const rim = rimCenter("A");
  const me = () => (room.state as any).players.get(room.sessionId) as { x: number; z: number };
  const dt = 1 / MOVE_HZ;
  /** Walk/run in a straight line at `speed` m/s to (x, z), sending 20 Hz moves. */
  async function runTo(x: number, z: number, speed: number): Promise<{ x: number; z: number }> {
    let p = { x: me().x, z: me().z };
    for (;;) {
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.hypot(dx, dz);
      const step = speed * dt;
      p = d <= step ? { x, z } : { x: p.x + (dx / d) * step, z: p.z + (dz / d) * step };
      room.send(MSG.move, { x: p.x, z: p.z, rotY: Math.atan2(dx, dz), anim: "run" });
      await sleep(dt * 1000);
      if (d <= step) return p;
    }
  }
  const shoot = async (p: { x: number; z: number }, layup: boolean): Promise<ShotMessage> => {
    const before = shots.length;
    room.send(MSG.shoot, { clientShotId: before + 1, timingError: 0, hoopId: "A", x: p.x, z: p.z, layup });
    const until = Date.now() + 3000;
    while (shots.length === before && Date.now() < until) await sleep(20);
    if (shots.length === before) fail("no shot came back");
    const s = shots.at(-1)!;
    await sleep(s.durationMs + 900); // let it land and the cooldown pass
    return s;
  };

  // 1. Drive at the rim from 5 m and lay it up at ~2 m.
  await runTo(rim.x, rim.z + 5, 3.5);
  await sleep(500);
  const p1 = await runTo(rim.x, rim.z + 2.0, 3.8);
  const s1 = await shoot(p1, true);
  if (!s1.layup) fail("a real drive was not simulated as a layup");
  console.log(`ok  drive at the rim -> layup (${s1.made ? "made" : "missed"})`);

  // 2. Standing still at the same spot, claiming a layup: jump shot.
  await sleep(600);
  const s2 = await shoot(me(), true);
  if (s2.layup) fail("a standing player got a layup");
  console.log("ok  standing still + layup claim -> jump shot");

  // 3. Driving but not claiming one: jump shot (the client decides to try).
  await runTo(rim.x + 1.5, rim.z + 4.5, 3.5);
  const p3 = await runTo(rim.x + 0.6, rim.z + 2.0, 3.8);
  const s3 = await shoot(p3, false);
  if (s3.layup) fail("a layup without a claim");
  console.log("ok  drive without a claim -> jump shot");

  await room.leave(true);
  await sql`update courts set is_active = false where code = ${code}`;
  await sql.end();
  console.log("LAYUP CHECK PASSED");
  process.exit(0);
}

main().catch((e) => fail(String(e?.stack ?? e)));
