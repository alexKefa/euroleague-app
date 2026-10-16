// Checks team & game-bell push (2026-10-12, bell 2026-10-16) on the dev DB.
// Spec: docs/superpowers/specs/2026-10-12-team-push-design.md
// Run from backend/ (dev only): npx tsx src/scripts/check-team-push.ts
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { getPushPrefs, setPushPrefs, usersWithPref } from "../services/pushPreferences.js";
import { claimOnce, closeAlert, handleGamePushes, message, pushKey, quarterMessage, recipientsFor, tipoffDue, type PushGame } from "../services/teamPush.js";
import { pushEnabled } from "../services/push.js";

// Dev only: the dev Neon endpoint (EuroleagueDev). Anything else is refused.
if (!(process.env.DATABASE_URL ?? "").includes("ep-sparkling-pond")) throw new Error("refusing to run outside the dev database");

const ts = Date.now();
const created: string[] = [];
async function mkUser(tag: string, extra: { favoriteTeamId?: string; deleted?: boolean } = {}): Promise<string> {
  const [u] = await db.execute<{ id: string }>(sql`
    insert into users (email, username, password_hash, favorite_team_id, deleted_at)
    values (${`check-push-${tag}-${ts}@dev.invalid`}, ${`check-push-${tag}-${ts}`}, 'x', ${extra.favoriteTeamId ?? null},
      ${extra.deleted ? sql`now()` : sql`null`})
    returning id`);
  created.push(u.id);
  return u.id;
}

try {
  // --- api: preferences
  const u = await mkUser("u");
  const v = await mkUser("v");
  const gone = await mkUser("gone", { deleted: true });
  assert.deepEqual(await getPushPrefs(u), { lockReminders: true, roundResults: true, teamTipoff: true, teamClose: true, teamFinal: true, pinned: true });
  assert.equal((await setPushPrefs(u, { teamClose: false })).teamClose, false);
  assert.equal((await getPushPrefs(u)).teamTipoff, true, "other keys keep their default");
  assert.deepEqual(await usersWithPref([u, v, gone], "teamClose"), [v]);
  assert.deepEqual(await usersWithPref([], "teamClose"), []);

  // --- rules: when each alert fires
  const [game] = await db.execute<{ id: string; home_team_id: string; away_team_id: string; hc: string; ac: string }>(sql`
    select g.id, g.home_team_id, g.away_team_id, ht.code hc, at.code ac
    from games g join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
    order by g.tipoff_at desc limit 1`);
  const now = new Date("2026-10-12T18:00:00Z");
  const plusMin = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();
  const base: PushGame = {
    id: game.id, status: "live", quarter: 4, gameClockSeconds: 110, tipoffAt: plusMin(-100),
    homeScore: 70, awayScore: 68, homeTeamId: game.home_team_id, awayTeamId: game.away_team_id, homeCode: game.hc, awayCode: game.ac,
  };
  assert.equal(closeAlert(base), "close");
  assert.equal(closeAlert({ ...base, gameClockSeconds: 150 }), null, "more than 2:00 left");
  assert.equal(closeAlert({ ...base, awayScore: 66 }), null, "margin 4");
  assert.equal(closeAlert({ ...base, quarter: 3 }), null, "Q3");
  assert.equal(closeAlert({ ...base, status: "final" }), null, "not live");
  assert.equal(closeAlert({ ...base, quarter: 5, gameClockSeconds: 280, awayScore: 60 }), "ot", "overtime");
  assert.equal(pushKey("team_close", base), pushKey("team_close", { ...base, quarter: 5 }), "close and OT share one key");
  assert.equal(tipoffDue({ ...base, status: "scheduled", tipoffAt: plusMin(15) }, now), true);
  assert.equal(tipoffDue({ ...base, status: "scheduled", tipoffAt: plusMin(25) }, now), false);
  assert.equal(tipoffDue({ ...base, status: "scheduled", tipoffAt: plusMin(5) }, now), false);
  assert.equal(tipoffDue({ ...base, status: "live", tipoffAt: plusMin(15) }, now), false);

  // --- rules: recipients (fans + bell users, unique, minus opted-out and deleted)
  const F = await mkUser("fan", { favoriteTeamId: game.home_team_id });
  const P = await mkUser("bell");
  const FP = await mkUser("fanbell", { favoriteTeamId: game.away_team_id });
  const PIN = await mkUser("pinOnly");
  const N = await mkUser("nofinal", { favoriteTeamId: game.home_team_id });
  const D = await mkUser("deletedfan", { favoriteTeamId: game.home_team_id, deleted: true });
  const PX = await mkUser("bellOff");
  await setPushPrefs(N, { teamFinal: false });
  await setPushPrefs(PX, { pinned: false });
  for (const id of [P, FP, PX]) await db.execute(sql`insert into game_alerts (user_id, game_id) values (${id}, ${game.id})`);
  await db.execute(sql`insert into watch_pins (user_id, kind, target_id, game_id) values (${PIN}, 'game', ${game.id}, ${game.id})`);
  const finalTo = await recipientsFor("team_final", base);
  for (const id of [F, P, FP]) assert.ok(finalTo.includes(id), `final should reach ${id}`);
  for (const id of [N, D, PX, PIN]) assert.ok(!finalTo.includes(id), `final must skip ${id}`);
  assert.equal(new Set(finalTo).size, finalTo.length, "recipients must be unique");
  const tipoffTo = await recipientsFor("team_tipoff", base);
  assert.ok(tipoffTo.includes(F) && !tipoffTo.includes(P), "tip-off soon goes to fans only, not bell users");
  for (const k of ["game_start", "game_quarter"] as const) {
    const to = await recipientsFor(k, base);
    assert.deepEqual([...to].sort(), [P, FP].sort(), `${k} goes to bell users only`);
  }

  // --- rules: copy has no placeholder left
  for (const k of ["team_tipoff", "team_close", "team_final", "game_start"] as const) {
    for (const l of ["en", "el"] as const) {
      const m = message(k, base, l, { ot: true, player: { name: "NUNN, KENDRICK", points: 21 } });
      assert.ok(!/[{}]/.test(m.title + m.body), `${k}/${l}: placeholder left: ${m.title} ${m.body}`);
      assert.equal(m.url, `/games/${game.id}`);
    }
  }
  assert.ok(message("team_close", base, "en").body.includes("1:50"), "clock label");
  assert.ok(message("team_final", { ...base, status: "final" }, "en", { player: { name: "NUNN, KENDRICK", points: 21 } }).body.includes("Kendrick Nunn: 21 pts"));

  // --- review fix: an alert does its DB work once per process, not every
  // 20 s tick while the condition holds (push_log still covers restarts).
  assert.equal(claimOnce(`check-${ts}`), true);
  assert.equal(claimOnce(`check-${ts}`), false, "second tick must not redo the send");

  // --- wiring: the live-sync hook sends one close alert per recipient, even
  // when it fires on two ticks in a row (push_log dedupes). Needs VAPID keys
  // in the environment; any keys work, the fake endpoint just fails.
  assert.ok(pushEnabled, "run with VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY set (any generated pair)");
  for (const id of [F, P]) {
    await db.execute(sql`insert into push_subscriptions (user_id, endpoint, p256dh, auth)
      values (${id}, ${`https://push.example.invalid/${id}`}, 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg')`);
  }
  await db.execute(sql`delete from push_log where key = ${`close:${game.id}`}`);
  const before: PushGame = { ...base, gameClockSeconds: 150 };
  await handleGamePushes(before, base);
  await handleGamePushes(base, { ...base, gameClockSeconds: 95 });
  const logged = await db.execute<{ user_id: string; n: number }>(sql`
    select user_id, count(*)::int n from push_log where kind = 'team_close' and key = ${`close:${game.id}`} group by user_id`);
  assert.deepEqual(logged.map((r) => [r.user_id, r.n]).sort(), [[F, 1], [P, 1]].sort(), "one close alert per subscribed recipient");
  await db.execute(sql`delete from push_log where key = ${`close:${game.id}`}`);

  // --- wiring: a quarter ending sends one push to bell users only, with the
  // quarter's score and top scorers (2026-10-16).
  await db.execute(sql`delete from push_log where key = ${`q1:${game.id}`}`);
  const q1: PushGame = { ...base, quarter: 1, gameClockSeconds: 0, homeScore: 22, awayScore: 18, homeQuarters: [22], awayQuarters: [18] };
  const players = [
    { playerId: "a", teamId: game.home_team_id, playerName: "VEZENKOV, SASHA", points: 9 },
    { playerId: "b", teamId: game.away_team_id, playerName: "NUNN, KENDRICK", points: 7 },
  ];
  await handleGamePushes({ ...q1, gameClockSeconds: 20 }, q1, now, players);
  await handleGamePushes(q1, { ...q1, quarter: 2, gameClockSeconds: 600 }, now, players);
  const quarterLogged = await db.execute<{ user_id: string }>(sql`select user_id from push_log where kind = 'game_quarter' and key = ${`q1:${game.id}`}`);
  assert.deepEqual(quarterLogged.map((r) => r.user_id), [P], "end of Q1 reaches the subscribed bell user once, not the fan");
  const qm = quarterMessage(q1, 1, { home: { name: "Vezenkov", points: 9 }, away: { name: "Nunn", points: 7 } }, "en");
  assert.match(qm.title, /^🏀 End of Q1 · \S+ 22–18 \S+$/u, "the total at the end of Q1, after the basketball");
  assert.equal(qm.body, "Vezenkov 9 pts, Nunn 7 pts.");
  for (const k of ["team_tipoff", "team_close", "team_final", "game_start"] as const) {
    assert.ok(message(k, base, "el").title.startsWith("🏀 "), `${k} opens with the basketball`);
  }
  await db.execute(sql`delete from push_log where key = ${`q1:${game.id}`}`);

  console.log("all team-push checks passed");
} catch (err) {
  console.error("team-push check FAILED:", err);
  process.exitCode = 1;
} finally {
  for (const id of created) {
    await db.execute(sql`delete from push_log where user_id = ${id}`);
    await db.execute(sql`delete from push_subscriptions where user_id = ${id}`);
    await db.execute(sql`delete from watch_pins where user_id = ${id}`);
    await db.execute(sql`delete from game_alerts where user_id = ${id}`);
    await db.execute(sql`delete from push_preferences where user_id = ${id}`);
    await db.execute(sql`delete from users where id = ${id}`);
  }
  process.exit(process.exitCode ?? 0);
}
