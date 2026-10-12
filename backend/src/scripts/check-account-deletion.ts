// Checks account deletion end to end on the dev DB (2026-10-12).
// Spec: docs/superpowers/specs/2026-10-12-account-deletion-design.md
// Run from backend/ with the local server up on :4000 (pointed at dev):
//   npx tsx src/scripts/check-account-deletion.ts
// Never run against production: it creates and anonymizes users.
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { signRefreshToken } from "../auth/tokens.js";
import { deleteAccount } from "../services/accountDeletion.js";
import { buildAccountExport } from "../services/accountExport.js";
import { getLeaderboardEntries } from "../services/leaderboard.js";
import { getRoundStandings } from "../services/roundStandings.js";
import { getAlbumLeaderboardEntries } from "../services/albumLeaderboard.js";
import { getFantasyLeaderboardEntries } from "../services/fantasyScoring.js";

// Dev only: the dev Neon endpoint (EuroleagueDev). Anything else is refused.
if (!(process.env.DATABASE_URL ?? "").includes("ep-sparkling-pond")) throw new Error("refusing to run outside the dev database");

const ts = Date.now();
type Row = Record<string, unknown>;
const one = async <T extends Row>(q: ReturnType<typeof sql>) => (await db.execute<T>(q))[0];

// --- fixture: users A and B, A with a pick, a card, a push subscription, a
// league membership, a pending trade to B and a pending battle from B.
const mkUser = (tag: string) =>
  one<{ id: string; username: string; email: string }>(sql`
    insert into users (email, username, password_hash, referral_code)
    values (${`check-del-${tag}-${ts}@dev.invalid`}, ${`check-del-${tag}-${ts}`}, 'x', ${`${tag}${String(ts).slice(-9)}`})
    returning id, username, email`);
const A = await mkUser("a");
const B = await mkUser("b");

const game = await one<{ id: string; home_team_id: string; season: string; round: number }>(
  sql`select id, home_team_id, season, round from games where status = 'final' and round is not null order by tipoff_at desc limit 1`
);
await db.execute(sql`insert into predictions (user_id, game_id, predicted_winner_team_id) values (${A.id}, ${game.id}, ${game.home_team_id})`);
const [cardA, cardB] = await db.execute<{ id: string }>(sql`select id from collectibles where tier = 'common' order by id limit 2`);
await db.execute(sql`insert into user_collectibles (user_id, collectible_id, tradeable, wishlist)
  values (${A.id}, ${cardA.id}, true, ${JSON.stringify([cardB.id])}::jsonb), (${B.id}, ${cardB.id}, false, '[]'::jsonb)`);
// Review fixes: a fantasy lineup (fantasy board), a favourite team and player (export).
const player = await one<{ id: string; team_id: string }>(sql`select id, team_id from players where active order by code limit 1`);
await db.execute(sql`insert into fantasy_lineups (user_id, season, round, player_id) values (${A.id}, ${game.season}, ${game.round}, ${player.id})`);
await db.execute(sql`insert into favorites (user_id, team_id) values (${A.id}, ${player.team_id})`);
await db.execute(sql`insert into favorite_players (user_id, player_id) values (${A.id}, ${player.id})`);
await db.execute(sql`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (${A.id}, ${`https://push.example.invalid/${ts}`}, 'k', 'a')`);
const league = await one<{ id: string }>(sql`insert into leagues (name, code, created_by_user_id) values ('check-del', ${`CD${ts}`.slice(0, 10)}, ${B.id}) returning id`);
await db.execute(sql`insert into league_members (league_id, user_id) values (${league.id}, ${A.id}), (${league.id}, ${B.id})`);
const trade = await one<{ id: string }>(sql`
  insert into trade_offers (from_user_id, to_user_id, requested_collectible_id) values (${A.id}, ${B.id}, ${cardB.id}) returning id`);
const battle = await one<{ id: string }>(sql`
  insert into battles (league_id, challenger_user_id, opponent_user_id, challenger_collectible_id)
  values (${league.id}, ${B.id}, ${A.id}, ${cardB.id}) returning id`);

try {
  // --- export, while A still exists
  const x = await buildAccountExport(A.id);
  const parsed = JSON.parse(JSON.stringify(x)) as typeof x;
  assert.equal(parsed.profile.email, A.email);
  assert.equal(parsed.profile.username, A.username);
  assert.equal(parsed.predictions.length, 1);
  assert.equal(parsed.cards.length, 1);
  assert.equal(parsed.trades.length, 1);
  // Review fix (export completeness): data deletion destroys must be exportable first.
  assert.equal(parsed.favoriteTeams.length, 1, "favourite teams missing from export");
  assert.equal(parsed.favoritePlayers.length, 1, "favourite players missing from export");
  assert.equal(parsed.fantasy.length, 1);
  for (const key of ["fantasyCoachPicks", "fantasyChips", "wheelSpins", "ownedPacks", "promoCodes", "milestones", "pollVotes", "savedViews", "devices"] as const) {
    assert.ok(Array.isArray(parsed[key]), `export lacks ${key}`);
  }
  assert.ok("referredBy" in parsed.profile, "export lacks referredBy");
  const tradesJson = JSON.stringify(parsed.trades) + JSON.stringify(parsed.battles);
  assert.ok(tradesJson.includes(B.username), "trade should name B by username");
  assert.ok(!tradesJson.includes(B.email), "export leaks B's email");
  assert.ok(!tradesJson.includes(B.id), "export leaks B's id");
  assert.equal(parsed.leagues.length, 1);
  assert.equal(parsed.pushSubscriptions.length, 1);
  for (const p of parsed.pushSubscriptions) assert.ok(!p.host.includes("/"), `push endpoint not reduced to host: ${p.host}`);

  // --- wrong confirmations
  assert.deepEqual(await deleteAccount(A.id, "wrong"), { ok: false, status: 400, code: "USERNAME_MISMATCH" });
  assert.deepEqual(await deleteAccount(A.id, ` ${A.username.toUpperCase()} `), { ok: false, status: 400, code: "USERNAME_MISMATCH" });

  // --- delete (typed with stray spaces)
  const r = await deleteAccount(A.id, ` ${A.username} `);
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error("unreachable");
  assert.deepEqual(r.cancelledTrades, [{ id: trade.id, otherUserId: B.id }]);
  assert.deepEqual(r.cancelledBattles, [{ id: battle.id, otherUserId: B.id }]);

  const u = await one<Row>(sql`select * from users where id = ${A.id}`);
  assert.equal(u.email, `deleted-${A.id}@deleted.invalid`);
  assert.equal(u.username, `deleted-${A.id.slice(0, 8)}`);
  assert.equal(u.password_hash, "!");
  for (const col of ["avatar_url", "favorite_team_id", "referral_code", "password_reset_token_hash", "password_reset_token_expires_at"]) {
    assert.equal(u[col], null, `${col} not cleared`);
  }
  assert.deepEqual(u.showcase_collectible_ids ?? [], []);
  assert.ok(u.deleted_at, "deleted_at not set");

  const count = async (table: string, extra = sql``) =>
    (await one<{ n: number }>(sql`select count(*)::int n from ${sql.raw(table)} where user_id = ${A.id} ${extra}`)).n;
  assert.equal(await count("push_subscriptions"), 0);
  assert.equal(await count("league_members"), 0);
  assert.equal(await count("predictions"), 1, "pick must be kept");
  assert.equal(await count("user_collectibles"), 1, "card must be kept");
  assert.equal((await one<{ status: string }>(sql`select status from trade_offers where id = ${trade.id}`)).status, "cancelled");
  assert.equal((await one<{ status: string }>(sql`select status from battles where id = ${battle.id}`)).status, "cancelled");

  // --- deleting twice
  assert.deepEqual(await deleteAccount(A.id, `deleted-${A.id.slice(0, 8)}`), { ok: false, status: 409, code: "ALREADY_DELETED" });

  // --- hidden from leaderboards
  assert.ok(!(await getLeaderboardEntries()).some((e: { userId: string }) => e.userId === A.id), "still on the leaderboard");
  assert.ok(!(await getRoundStandings(game.season, game.round, { includeAdmins: true })).some((e) => e.userId === A.id), "still in round standings");

  // --- review fixes: no ghost others can see or act on
  assert.ok(!(await getAlbumLeaderboardEntries({ userIds: [A.id] })).some((e) => e.userId === A.id), "still on the album leaderboard");
  assert.ok(
    !(await getFantasyLeaderboardEntries({ season: game.season, userIds: [A.id] })).some((e) => e.userId === A.id),
    "still on the fantasy leaderboard"
  );
  const listed = await one<{ n: number }>(sql`
    select count(*)::int n from user_collectibles where user_id = ${A.id} and (tradeable or wishlist <> '[]'::jsonb)`);
  assert.equal(listed.n, 0, "cards still listed for trade");

  // --- other devices: refresh is refused (code proves it's this branch, not "no such user")
  const refresh = await fetch("http://localhost:4000/api/auth/refresh", { method: "POST", headers: { cookie: `refreshToken=${signRefreshToken(A.id)}` } });
  assert.equal(refresh.status, 401, "refresh still works for a deleted user");
  assert.equal(((await refresh.json()) as { code?: string }).code, "ACCOUNT_DELETED");

  // --- review fix: a DB error in refresh answers instead of hanging
  const broken = await fetch("http://localhost:4000/api/auth/refresh", {
    method: "POST",
    headers: { cookie: `refreshToken=${signRefreshToken("not-a-uuid")}` },
    signal: AbortSignal.timeout(8000),
  }).catch((e: Error) => ({ status: `no response (${e.name})` }));
  assert.ok(typeof broken.status === "number" && broken.status >= 500, `refresh hung on a DB error: ${broken.status}`);

  // --- the old email can't be matched by a new Google login
  assert.equal((await one<{ n: number }>(sql`select count(*)::int n from users where lower(email) = ${A.email.toLowerCase()}`)).n, 0);

  console.log("all account-deletion checks passed");
} catch (err) {
  // Printed here: the process.exit in finally would otherwise swallow it.
  console.error("account-deletion check FAILED:", err);
  process.exitCode = 1;
} finally {
  // B, the league and the shared rows go; A stays as the tombstone it now is.
  await db.execute(sql`delete from battles where id = ${battle.id}`);
  await db.execute(sql`delete from trade_offers where id = ${trade.id}`);
  await db.execute(sql`delete from league_members where league_id = ${league.id}`);
  await db.execute(sql`delete from leagues where id = ${league.id}`);
  await db.execute(sql`delete from user_collectibles where user_id = ${B.id}`);
  await db.execute(sql`delete from users where id = ${B.id}`);
  process.exit(process.exitCode ?? 0);
}
