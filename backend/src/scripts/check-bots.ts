// End-to-end check for admin practice bots against a LOCAL server (dev DB):
// non-admins can't add bots, admins get at most MAX_BOTS, bots shoot, play
// their H-O-R-S-E turns, don't count towards "court full", and leave on request.
//
//   (terminal 1) $env:DISABLE_BACKGROUND_JOBS="1"; npx tsx src/index.ts
//   (terminal 2) npm run check:bots
import "dotenv/config";
import jwt from "jsonwebtoken";
import postgres from "postgres";
import { Client, type Room } from "@colyseus/sdk";
import { MAX_BOTS, MSG, type ShotMessage } from "../../../shared/court/protocol.js";

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:4000";
const url = process.env.DATABASE_URL ?? "";
if (!new URL(url).hostname.includes("ep-sparkling-pond")) {
  console.error("check:bots only runs against the dev DB (EuroleagueDev).");
  process.exit(1);
}
const sql = postgres(url, { ssl: "require", max: 1 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fail(msg: string): never {
  console.error(`BOTS CHECK FAILED: ${msg}`);
  process.exit(1);
}
async function waitFor(what: string, pred: () => boolean, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) fail(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

async function main(): Promise<void> {
  const [admin] = await sql<{ id: string }[]>`select id from users where is_admin = true order by created_at limit 1`;
  const [plain] = await sql<{ id: string }[]>`select id from users where is_admin = false order by created_at limit 1`;
  if (!admin || !plain) fail("need an admin and a non-admin user in the dev DB");
  const token = (id: string) => jwt.sign({ sub: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "10m" });
  // The admin owns the court (so they can start H-O-R-S-E).
  const res = await fetch(`${BASE}/api/courts`, { method: "POST", headers: { authorization: `Bearer ${token(admin.id)}` } });
  const { code } = (await res.json()) as { code: string };

  const client = new Client(`${BASE}/colyseus`);
  const botShots: ShotMessage[] = [];
  const join = async (userId: string): Promise<Room> => {
    const room = await client.joinOrCreate("court", { code, accessToken: token(userId) });
    for (const t of [MSG.toast, MSG.seed, MSG.correction, MSG.horseEvent, MSG.shotRejected, MSG.reacted]) room.onMessage(t, () => {});
    room.onMessage(MSG.shot, (m: ShotMessage) => {
      if (m.shooterId.startsWith("bot")) botShots.push(m);
    });
    return room;
  };
  const owner = await join(admin.id);
  const guest = await join(plain.id);
  await sleep(400);
  const st = () => owner.state as any;
  const botIds = () => {
    const ids: string[] = [];
    st().players.forEach((_p: unknown, id: string) => id.startsWith("bot") && ids.push(id));
    return ids;
  };

  guest.send(MSG.addBot);
  await sleep(500);
  if (botIds().length) fail("a non-admin added a bot");
  console.log("ok  non-admin can't add bots");

  for (let i = 0; i < MAX_BOTS + 1; i++) owner.send(MSG.addBot);
  await sleep(600);
  if (botIds().length !== MAX_BOTS) fail(`expected ${MAX_BOTS} bots, got ${botIds().length}`);
  console.log(`ok  admin capped at ${MAX_BOTS} bots`);

  const info = (await (await fetch(`${BASE}/api/courts/${code}`)).json()) as { playerCount?: number };
  if (info.playerCount !== 2) fail(`"court full" count includes bots (playerCount ${info.playerCount})`);
  console.log("ok  bots don't count towards a full court");

  await waitFor("a bot shot", () => botShots.length > 0, 20_000);
  console.log(`ok  bots shoot (${botShots.length} so far, layups: ${botShots.filter((s) => s.layup).length})`);

  // H-O-R-S-E with the bots: a bot takes its turn.
  owner.send(MSG.horseStart);
  await waitFor("H-O-R-S-E to start", () => st().phase === "setting", 5000);
  const inGameBotShot = botShots.length;
  await waitFor("a bot's H-O-R-S-E turn shot", () => botShots.length > inGameBotShot, 90_000);
  console.log("ok  a bot played its H-O-R-S-E turn");
  owner.send(MSG.horseLeave);
  guest.send(MSG.horseLeave);
  await sleep(500);

  owner.send(MSG.removeBots);
  await sleep(500);
  if (botIds().length) fail("bots still on court after Remove bots");
  console.log("ok  remove bots clears them");

  await owner.leave(true);
  await guest.leave(true);
  // The H-O-R-S-E result is saved just after the game ends: let it land first.
  await sleep(2000);
  await sql`delete from horse_game_players where game_id in (select g.id from horse_games g join courts c on c.id = g.court_id where c.code = ${code})`;
  await sql`delete from horse_games where court_id in (select id from courts where code = ${code})`;
  await sql`update courts set is_active = false where code = ${code}`;
  await sql.end();
  console.log("BOTS CHECK PASSED");
  process.exit(0);
}

main().catch((e) => fail(String(e?.stack ?? e)));
