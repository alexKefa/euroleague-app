// End-to-end check for emotes / quick phrases against a LOCAL server (dev DB):
// a known reaction reaches the other player (not the sender), unknown ids are
// dropped, and a second reaction within REACTION_GAP_MS is dropped.
//
//   (terminal 1) $env:DISABLE_BACKGROUND_JOBS="1"; npx tsx src/index.ts
//   (terminal 2) npm run check:reactions
import "dotenv/config";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import { Client, type Room } from "@colyseus/sdk";
import { MSG, REACTION_GAP_MS, type ReactionShownMessage } from "../../../shared/court/protocol.js";

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:4000";
const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).hostname.includes("ep-sparkling-pond")) {
  console.error("check:reactions only runs against the dev DB (EuroleagueDev).");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 1 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fail(msg: string): never {
  console.error(`REACTIONS CHECK FAILED: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const users = await sql<{ id: string }[]>`select id from users order by created_at limit 2`;
  const token = (id: string) => jwt.sign({ sub: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "10m" });
  const res = await fetch(`${BASE}/api/courts`, { method: "POST", headers: { authorization: `Bearer ${token(users[0]!.id)}` } });
  const { code } = (await res.json()) as { code: string };

  const client = new Client(`${BASE}/colyseus`);
  const got = new Map<Room, ReactionShownMessage[]>();
  const join = async (userId: string) => {
    const room = await client.joinOrCreate("court", { code, accessToken: token(userId) });
    for (const t of [MSG.toast, MSG.seed, MSG.shot, MSG.correction, MSG.horseEvent]) room.onMessage(t, () => {});
    got.set(room, []);
    room.onMessage(MSG.reacted, (m: ReactionShownMessage) => got.get(room)!.push(m));
    return room;
  };
  const A = await join(users[0]!.id);
  const B = await join(users[1]!.id);
  await sleep(300);

  A.send(MSG.react, { id: "wave" });
  A.send(MSG.react, { id: "nice" }); // within the gap: dropped
  A.send(MSG.react, { id: "<script>" }); // unknown: dropped
  await sleep(400);
  const b1 = got.get(B)!;
  if (b1.length !== 1 || b1[0]!.id !== "wave" || b1[0]!.playerId !== A.sessionId) fail(`B got ${JSON.stringify(b1)}`);
  if (got.get(A)!.length) fail("the sender got its own reaction back");
  console.log("ok  wave relayed to the other player only; unknown id and too-soon phrase dropped");

  await sleep(REACTION_GAP_MS);
  A.send(MSG.react, { id: "gg" });
  await sleep(400);
  if (got.get(B)!.at(-1)?.id !== "gg") fail("a phrase after the gap was not relayed");
  console.log("ok  phrase after the gap relayed");

  await A.leave(true);
  await B.leave(true);
  await sql`update courts set is_active = false where code = ${code}`;
  await sql.end();
  console.log("REACTIONS CHECK PASSED");
  process.exit(0);
}

main().catch((e) => fail(String(e?.stack ?? e)));
