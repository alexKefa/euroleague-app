// Clutch Court bot load test (CLUTCH_COURT_SPEC.md M5). Fills COURTS courts
// with PLAYERS bots each for SECONDS seconds. A bot runs around (20 Hz moves),
// stands idle, and shoots about every 6 s, roughly an eager real player.
// Reports per-player download bandwidth and shot round-trip latency; the
// server's own CPU/memory/lag comes from its "[court] stats" log lines.
//
// Local:    (terminal 1) $env:DISABLE_BACKGROUND_JOBS="1"; $env:COURT_STATS_MS="10000"; npx tsx src/index.ts
//           (terminal 2) $env:COURTS="10"; $env:PLAYERS="8"; npm run load:court
// Railway dev (uses dev's DB + JWT secret):
//           railway run --service euroleague-app --environment dev -- npm run load:court
//           with LOAD_BASE_URL=https://euroleague-app-dev.up.railway.app
// Refuses to run against production or a non-dev database.
import "dotenv/config";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import { Client, type Room } from "@colyseus/sdk";
import { MSG, MOVE_HZ } from "../../../shared/court/protocol.js";
import { PLAYER_SPEED } from "../../../shared/court/constants.js";

const BASE = process.env.LOAD_BASE_URL ?? "http://localhost:4000";
const COURTS = Number(process.env.COURTS) || 1;
const PLAYERS = Math.min(8, Number(process.env.PLAYERS) || 4);
const SECONDS = Number(process.env.SECONDS) || 60;
const SHOT_EVERY_S = 6;
/** First owner index: parallel bot processes each take their own owners (one open court per owner). */
const OFFSET = Number(process.env.COURT_OFFSET) || 0;

if (BASE.includes("getclutchapp.com")) {
  console.error("load:court never runs against production.");
  process.exit(1);
}
const dbUrl = process.env.DATABASE_URL ?? "";
if (!new URL(dbUrl).hostname.includes("ep-sparkling-pond")) {
  console.error("load:court only runs against the dev DB (EuroleagueDev).");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

interface Bot {
  room: Room;
  x: number;
  z: number;
  target: { x: number; z: number } | null;
  until: number;
  nextShotAt: number;
  shotId: number;
  shotSentAt: Map<number, number>;
  bytes: number;
}

const latencies: number[] = [];
let shotsSent = 0;
let shotsRejected = 0;
let corrections = 0;
let drops = 0;

async function main(): Promise<void> {
  const sql = postgres(dbUrl, { ssl: "require", max: 1 });
  const users = await sql<{ id: string }[]>`select id from users order by created_at limit 60`;
  if (users.length < Math.max(OFFSET + COURTS, PLAYERS)) throw new Error(`need ${Math.max(COURTS, PLAYERS)} users, dev has ${users.length}`);
  const token = (id: string) => jwt.sign({ sub: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "30m" });

  console.log(`load: ${COURTS} court(s) x ${PLAYERS} bots for ${SECONDS}s against ${BASE}`);
  const codes: string[] = [];
  const bots: Bot[] = [];
  const client = new Client(`${BASE}/colyseus`);

  for (let c = 0; c < COURTS; c++) {
    const owner = users[OFFSET + c]!;
    const res = await fetch(`${BASE}/api/courts`, { method: "POST", headers: { authorization: `Bearer ${token(owner.id)}` } });
    if (!res.ok) throw new Error(`create court: HTTP ${res.status}`);
    const { code } = (await res.json()) as { code: string };
    codes.push(code);
    // Owner first, then the next users round-robin (distinct within a court).
    for (let p = 0; p < PLAYERS; p++) {
      const u = users[(OFFSET + c + p) % users.length]!;
      const room = await client.joinOrCreate("court", { code, accessToken: token(u.id) });
      const bot: Bot = {
        room,
        x: rand(-5, 5),
        z: rand(-11, 0),
        target: null,
        until: 0,
        nextShotAt: Date.now() + rand(1000, SHOT_EVERY_S * 1000),
        shotId: 0,
        shotSentAt: new Map(),
        bytes: 0,
      };
      const ws = (room as any).connection?.transport?.ws as WebSocket | undefined;
      if (!ws) throw new Error("no websocket on the SDK transport");
      ws.addEventListener("message", (e: MessageEvent) => {
        const d = e.data as ArrayBuffer | Blob | string;
        bot.bytes += typeof d === "string" ? d.length : "byteLength" in d ? d.byteLength : d.size;
      });
      // Start where the server spawned us (else the first move is corrected).
      const until = Date.now() + 3000;
      while (!(room.state as any)?.players?.get(room.sessionId) && Date.now() < until) await sleep(20);
      const me = (room.state as any)?.players?.get(room.sessionId);
      if (me) {
        bot.x = me.x;
        bot.z = me.z;
      }
      for (const t of [MSG.toast, MSG.seed, MSG.horseEvent]) room.onMessage(t, () => {});
      room.onMessage(MSG.correction, (m: { x: number; z: number }) => {
        corrections++;
        bot.x = m.x;
        bot.z = m.z;
      });
      room.onMessage(MSG.shotRejected, () => shotsRejected++);
      room.onMessage(MSG.shot, (m: { shooterId: string; clientShotId: number }) => {
        if (m.shooterId !== room.sessionId) return;
        const sent = bot.shotSentAt.get(m.clientShotId);
        if (sent !== undefined) {
          latencies.push(Date.now() - sent);
          bot.shotSentAt.delete(m.clientShotId);
        }
      });
      room.onDrop(() => drops++);
      bots.push(bot);
    }
  }
  console.log(`joined ${bots.length} bots; running...`);

  const startBytes = () => bots.reduce((s, b) => s + b.bytes, 0);
  const b0 = startBytes();
  const t0 = Date.now();
  const dt = 1 / MOVE_HZ;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const b of bots) {
      if (now >= b.until) {
        // New intent: run somewhere (60%) or stand still (40%).
        b.target = Math.random() < 0.6 ? { x: rand(-6, 6), z: rand(-11.5, 1.5) } : null;
        b.until = now + rand(1500, 4000);
      }
      if (b.target) {
        const dx = b.target.x - b.x;
        const dz = b.target.z - b.z;
        const d = Math.hypot(dx, dz);
        const step = PLAYER_SPEED * 0.9 * dt;
        if (d <= step) {
          b.x = b.target.x;
          b.z = b.target.z;
          b.target = null;
        } else {
          b.x += (dx / d) * step;
          b.z += (dz / d) * step;
        }
        b.room.send(MSG.move, { x: b.x, z: b.z, rotY: Math.atan2(dx, dz), anim: b.target ? "run" : "idle" });
      }
      if (now >= b.nextShotAt) {
        const id = ++b.shotId;
        b.shotSentAt.set(id, now);
        shotsSent++;
        b.room.send(MSG.shoot, { clientShotId: id, timingError: rand(-0.3, 0.3), hoopId: "A", x: b.x, z: b.z });
        b.nextShotAt = now + rand(SHOT_EVERY_S * 500, SHOT_EVERY_S * 1500);
      }
    }
  }, 1000 / MOVE_HZ);

  for (let s = 10; s <= SECONDS; s += 10) {
    await sleep(10_000);
    const secs = (Date.now() - t0) / 1000;
    const kbps = (startBytes() - b0) / 1024 / secs / bots.length;
    console.log(
      `t=${String(Math.round(secs)).padStart(3)}s  down ${kbps.toFixed(1)} KB/s per player  ` +
        `shots ${shotsSent} (rejected ${shotsRejected})  shot RTT p50 ${pct(latencies, 50)}ms p95 ${pct(latencies, 95)}ms  ` +
        `corrections ${corrections}  drops ${drops}`
    );
  }
  clearInterval(timer);

  const secs = (Date.now() - t0) / 1000;
  const perPlayerKBs = (startBytes() - b0) / 1024 / secs / bots.length;
  console.log(
    `RESULT courts=${COURTS} players=${bots.length} down=${perPlayerKBs.toFixed(1)}KB/s/player ` +
      `(~${((perPlayerKBs * 3600) / 1024).toFixed(0)} MB per player-hour) shotRTT_p95=${pct(latencies, 95)}ms drops=${drops}`
  );

  for (const b of bots) await b.room.leave(true).catch(() => {});
  await sql`update courts set is_active = false where code in ${sql(codes)}`;
  await sql`delete from courts where code in ${sql(codes)}`;
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("LOAD TEST FAILED:", e?.stack ?? e);
  process.exit(1);
});
