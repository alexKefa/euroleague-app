// Checks team & pinned-game push (2026-10-12) on the dev DB.
// Spec: docs/superpowers/specs/2026-10-12-team-push-design.md
// Run from backend/ (dev only): npx tsx src/scripts/check-team-push.ts
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { getPushPrefs, setPushPrefs, usersWithPref } from "../services/pushPreferences.js";

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

  console.log("all team-push checks passed");
} catch (err) {
  console.error("team-push check FAILED:", err);
  process.exitCode = 1;
} finally {
  for (const id of created) {
    await db.execute(sql`delete from push_log where user_id = ${id}`);
    await db.execute(sql`delete from push_subscriptions where user_id = ${id}`);
    await db.execute(sql`delete from watch_pins where user_id = ${id}`);
    await db.execute(sql`delete from push_preferences where user_id = ${id}`);
    await db.execute(sql`delete from users where id = ${id}`);
  }
  process.exit(process.exitCode ?? 0);
}
