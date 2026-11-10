// End-to-end check for the live court scoreboard against a LOCAL server (dev DB):
// shots are counted when the ball lands (not before), match the shot results,
// only the owner can reset, and a reset zeroes everyone.
//
//   (terminal 1) $env:DISABLE_BACKGROUND_JOBS="1"; npx tsx src/index.ts
//   (terminal 2) npm run check:scores
import "dotenv/config";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import { Client, type Room } from "@colyseus/sdk";
import { MSG, type ShotMessage } from "../../../shared/court/protocol.js";

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:4000";
const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).hostname.includes("ep-sparkling-pond")) {
  console.error("check:scores only runs against the dev DB (EuroleagueDev).");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 1 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fail(msg: string): never {
  console.error(`SCORES CHECK FAILED: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const users = await sql<{ id: string }[]>`select id from users order by created_at limit 2`;
  const token = (id: string) => jwt.sign({ sub: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "10m" });
  const res = await fetch(`${BASE}/api/courts`, { method: "POST", headers: { authorization: `Bearer ${token(users[0]!.id)}` } });
  const { code } = (await res.json()) as { code: string };
  const client = new Client(`${BASE}/colyseus`);
  const shots: ShotMessage[] = [];
  const join = async (userId: string): Promise<Room> => {
    const room = await client.joinOrCreate("court", { code, accessToken: token(userId) });
    for (const t of [MSG.toast, MSG.seed, MSG.correction, MSG.horseEvent, MSG.shotRejected, MSG.reacted]) room.onMessage(t, () => {});
    // Every shot reaches every player: keep only the copies the shooter receives.
    room.onMessage(MSG.shot, (m: ShotMessage) => {
      if (m.shooterId === room.sessionId) shots.push(m);
    });
    return room;
  };
  const owner = await join(users[0]!.id);
  const guest = await join(users[1]!.id);
  await sleep(400);
  const lineOf = (sid: string) => (guest.state as any).players.get(sid) as { makes: number; attempts: number; streak: number };

  // The guest shoots twice; the owner's view is checked from the guest's state.
  const me = () => (guest.state as any).players.get(guest.sessionId) as { x: number; z: number };
  let made = 0;
  for (let i = 0; i < 2; i++) {
    const before = shots.length;
    guest.send(MSG.shoot, { clientShotId: i + 1, timingError: i === 0 ? 0 : 1, hoopId: "A", x: me().x, z: me().z });
    const until = Date.now() + 3000;
    while (shots.length === before && Date.now() < until) await sleep(20);
    if (shots.length === before) fail("no shot came back");
    const shot = shots.at(-1)!;
    // Not counted while the ball is still in the air.
    await sleep(Math.max(0, Math.min(150, shot.durationMs - 200)));
    if (lineOf(guest.sessionId).attempts !== i) fail(`counted before the ball landed (attempts ${lineOf(guest.sessionId).attempts})`);
    await sleep(shot.durationMs + 900);
    if (shot.made) made++;
    const l = lineOf(guest.sessionId);
    if (l.attempts !== i + 1 || l.makes !== made) fail(`after shot ${i + 1}: ${l.makes}/${l.attempts}, expected ${made}/${i + 1}`);
  }
  console.log(`ok  counted when the ball lands, matches the results (${made}/2)`);

  guest.send(MSG.resetScores);
  await sleep(400);
  if (lineOf(guest.sessionId).attempts !== 2) fail("a non-owner reset the scores");
  console.log("ok  non-owner reset ignored");

  owner.send(MSG.resetScores);
  await sleep(400);
  const z = lineOf(guest.sessionId);
  if (z.attempts !== 0 || z.makes !== 0 || z.streak !== 0) fail("owner reset did not zero the scores");
  console.log("ok  owner reset zeroes everyone");

  await owner.leave(true);
  await guest.leave(true);
  await sql`update courts set is_active = false where code = ${code}`;
  await sql.end();
  console.log("SCORES CHECK PASSED");
  process.exit(0);
}

main().catch((e) => fail(String(e?.stack ?? e)));
