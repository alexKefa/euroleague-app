// A practice partner for testing Clutch Court alone on DEV: opens (or reuses)
// a court owned by OWNER (default: the "Alexakos" dev account, so you can
// start H-O-R-S-E) and joins it as another dev user. The bot runs around,
// shoots, drives in for layups, reacts to makes, and plays its H-O-R-S-E
// turns (sets from inside the arc, walks to your spot to match).
//
//   railway run --service euroleague-app --environment dev -- npx tsx src/scripts/court-bot.ts
//   env: LOAD_BASE_URL (dev URL), OWNER (username), MINUTES (default 30)
// Refuses to run against production or a non-dev database.
import "dotenv/config";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import { Client, type Room } from "@colyseus/sdk";
import { MSG, MOVE_HZ, type ShotMessage } from "../../../shared/court/protocol.js";
import { insideThreePoint, rimCenter } from "../../../shared/court/geometry.js";
import { layupEligible } from "../../../shared/court/shot.js";

const BASE = process.env.LOAD_BASE_URL ?? "http://localhost:4000";
const OWNER = (process.env.OWNER ?? "Alexakos").toLowerCase();
const MINUTES = Number(process.env.MINUTES) || 30;
if (BASE.includes("getclutchapp.com")) {
  console.error("court-bot never runs against production.");
  process.exit(1);
}
const dbUrl = process.env.DATABASE_URL ?? "";
if (!new URL(dbUrl).hostname.includes("ep-sparkling-pond")) {
  console.error("court-bot only runs against the dev DB (EuroleagueDev).");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const gauss = () => Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
const rim = rimCenter("A");
const dt = 1 / MOVE_HZ;
const SPEED = 3.6;

async function main(): Promise<void> {
  const sql = postgres(dbUrl, { ssl: "require", max: 1 });
  const [owner] = await sql<{ id: string; username: string }[]>`select id, username from users where lower(username) = ${OWNER} limit 1`;
  if (!owner) throw new Error(`no dev user named ${OWNER}`);
  const [bot] = await sql<{ id: string; username: string }[]>`select id, username from users where id <> ${owner.id} order by created_at limit 1`;
  if (!bot) throw new Error("need a second dev user for the bot");
  const token = (id: string) => jwt.sign({ sub: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: `${MINUTES + 5}m` });

  // Open (or reuse) the owner's court.
  const res = await fetch(`${BASE}/api/courts`, { method: "POST", headers: { authorization: `Bearer ${token(owner.id)}` } });
  if (!res.ok) throw new Error(`create court: HTTP ${res.status}`);
  const { code } = (await res.json()) as { code: string };
  await sql.end();

  const room: Room = await new Client(`${BASE}/colyseus`).joinOrCreate("court", { code, accessToken: token(bot.id) });
  console.log(`\nCourt ${code} is open, owned by ${owner.username}.`);
  console.log(`Open: ${BASE}/court/${code}   (bot "${bot.username}" is on court for ${MINUTES} min)\n`);

  for (const t of [MSG.seed, MSG.correction, MSG.shotRejected]) room.onMessage(t, () => {});
  room.onMessage(MSG.toast, (m: { kind: string; name: string }) => console.log(`[court] ${m.kind}: ${m.name}`));
  room.onMessage(MSG.horseEvent, (m: { kind: string }) => console.log(`[horse] ${m.kind}`));
  room.onMessage(MSG.reacted, () => {});

  const st = () => room.state as any;
  const me = () => st()?.players?.get(room.sessionId) as { x: number; z: number } | undefined;
  // The first state patch arrives just after joining: wait for our own seat.
  for (let i = 0; i < 100 && !me(); i++) await sleep(50);
  let pos = { x: me()?.x ?? 0, z: me()?.z ?? -6 };
  let busyUntil = 0;
  let shotId = 0;
  let lastReact = 0;

  const react = (id: string) => {
    if (Date.now() - lastReact < 2500) return;
    lastReact = Date.now();
    room.send(MSG.react, { id });
  };
  room.onMessage(MSG.shot, (m: ShotMessage) => {
    const mine = m.shooterId === room.sessionId;
    busyUntil = mine ? Date.now() + m.durationMs + 300 : busyUntil;
    // React when the ball lands.
    setTimeout(() => {
      if (mine && m.made && Math.random() < 0.35) react(["cheer", "fire", "letsGo"][Math.floor(Math.random() * 3)]!);
      if (mine && !m.made && Math.random() < 0.2) react("shrug");
      if (!mine && m.made && Math.random() < 0.3) react(["nice", "clap"][Math.floor(Math.random() * 2)]!);
      if (!mine && !m.made && Math.random() < 0.15) react("unlucky");
    }, m.durationMs);
  });

  /** Run to (x, z) at SPEED with 20 Hz moves. Returns the velocity on arrival. */
  async function runTo(x: number, z: number, speed = SPEED): Promise<{ vx: number; vz: number }> {
    for (;;) {
      const dx = x - pos.x;
      const dz = z - pos.z;
      const d = Math.hypot(dx, dz);
      const step = speed * dt;
      const vx = d > 0 ? (dx / d) * speed : 0;
      const vz = d > 0 ? (dz / d) * speed : 0;
      pos = d <= step ? { x, z } : { x: pos.x + (dx / d) * step, z: pos.z + (dz / d) * step };
      room.send(MSG.move, { x: pos.x, z: pos.z, rotY: Math.atan2(dx || 1e-6, dz || 1e-6), anim: d <= step ? "idle" : "run" });
      await sleep(dt * 1000);
      if (d <= step) return { vx, vz };
    }
  }
  async function shoot(opts: { layup?: boolean; timing?: number } = {}): Promise<void> {
    while (Date.now() < busyUntil) await sleep(50);
    // Face the rim and "charge" briefly so others see the shooting pose.
    const rotY = Math.atan2(rim.x - pos.x, rim.z - pos.z);
    room.send(MSG.move, { x: pos.x, z: pos.z, rotY, anim: opts.layup ? "layup" : "shoot" });
    await sleep(opts.layup ? 450 : 750);
    const timingError = opts.timing ?? Math.max(-1, Math.min(1, gauss() * 0.28));
    room.send(MSG.shoot, { clientShotId: ++shotId, timingError, hoopId: "A", x: pos.x, z: pos.z, layup: !!opts.layup });
    busyUntil = Date.now() + 3000; // until the shot comes back
    await sleep(400);
  }
  async function driveLayup(): Promise<void> {
    const a = rand(-0.9, 0.9);
    await runTo(rim.x + Math.sin(a) * 5, rim.z + Math.cos(a) * 5);
    const end = { x: rim.x + Math.sin(a) * 2.1, z: rim.z + Math.cos(a) * 2.1 };
    const v = await runTo(end.x, end.z, 3.9);
    // Keep moving in the last step so the server sees the drive.
    room.send(MSG.move, { x: pos.x, z: pos.z, rotY: Math.atan2(v.vx, v.vz), anim: "run" });
    await shoot({ layup: layupEligible(pos.x, pos.z, "A", v.vx, v.vz) });
  }
  /** A spot inside the arc for setting. */
  function setSpot(): { x: number; z: number } {
    for (;;) {
      const a = rand(-1.2, 1.2);
      const d = rand(2.5, 6.2);
      const p = { x: rim.x + Math.sin(a) * d, z: rim.z + Math.cos(a) * d };
      if (insideThreePoint("A", p.x, p.z)) return p;
    }
  }

  const until = Date.now() + MINUTES * 60_000;
  let lastHorseKey = "";
  while (Date.now() < until) {
    const s = st();
    const inGame = s.phase === "setting" || s.phase === "matching";
    if (inGame) {
      const key = `${s.phase}:${s.turnId}:${s.spotX}:${s.spotZ}`;
      if (s.turnId === room.sessionId && key !== lastHorseKey) {
        lastHorseKey = key;
        await sleep(rand(800, 2000)); // "thinking"
        if (s.phase === "setting") {
          const p = setSpot();
          await runTo(p.x, p.z);
          await shoot();
        } else {
          await runTo(s.spotX + rand(-0.3, 0.3), s.spotZ + rand(-0.3, 0.3));
          await shoot();
        }
      } else {
        // Not our turn: drift to the side of the key and wait.
        if (Math.random() < 0.05) await runTo(rand(-6, -4), rim.z + rand(6, 8), 2);
        await sleep(300);
      }
      continue;
    }
    lastHorseKey = "";
    // Shootaround: wander, shoot, sometimes drive for a layup.
    const r = Math.random();
    if (r < 0.25) await driveLayup();
    else if (r < 0.75) {
      const a = rand(-1.3, 1.3);
      const d = rand(2.5, 7.3);
      await runTo(rim.x + Math.sin(a) * d, Math.min(1.5, rim.z + Math.cos(a) * d));
      await shoot();
    } else {
      await runTo(rand(-6, 6), rand(-10, 1), 2.5);
      await sleep(rand(800, 2000));
    }
    await sleep(rand(600, 1800));
  }

  console.log("Time's up: bot leaving the court.");
  await room.leave(true);
  process.exit(0);
}

main().catch((e) => {
  console.error("court-bot failed:", e?.stack ?? e);
  process.exit(1);
});
