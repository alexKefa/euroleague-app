// Per-user push preferences (2026-10-12). A missing row means every kind is
// on. usersWithPref is the one filter every sender uses: it also drops
// deleted accounts. Spec: docs/superpowers/specs/2026-10-12-team-push-design.md
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

export type PushPrefKey = "lockReminders" | "roundResults" | "teamTipoff" | "teamClose" | "teamFinal" | "pinned";
export type PushPrefs = Record<PushPrefKey, boolean>;

export const PUSH_PREF_KEYS: PushPrefKey[] = ["lockReminders", "roundResults", "teamTipoff", "teamClose", "teamFinal", "pinned"];
const COLUMN: Record<PushPrefKey, string> = {
  lockReminders: "lock_reminders",
  roundResults: "round_results",
  teamTipoff: "team_tipoff",
  teamClose: "team_close",
  teamFinal: "team_final",
  pinned: "pinned",
};
const DEFAULTS: PushPrefs = { lockReminders: true, roundResults: true, teamTipoff: true, teamClose: true, teamFinal: true, pinned: true };

export async function getPushPrefs(userId: string): Promise<PushPrefs> {
  const [row] = await db.execute<Record<string, boolean>>(sql`select * from push_preferences where user_id = ${userId}`);
  if (!row) return { ...DEFAULTS };
  return Object.fromEntries(PUSH_PREF_KEYS.map((k) => [k, row[COLUMN[k]]])) as PushPrefs;
}

/** Upserts only the given keys; returns the full set. */
export async function setPushPrefs(userId: string, patch: Partial<PushPrefs>): Promise<PushPrefs> {
  const keys = PUSH_PREF_KEYS.filter((k) => typeof patch[k] === "boolean");
  if (keys.length > 0) {
    const cols = keys.map((k) => sql.raw(COLUMN[k]));
    const vals = keys.map((k) => sql`${patch[k]!}`);
    const sets = keys.map((k) => sql`${sql.raw(COLUMN[k])} = excluded.${sql.raw(COLUMN[k])}`);
    await db.execute(sql`
      insert into push_preferences (user_id, ${sql.join(cols, sql`, `)}) values (${userId}, ${sql.join(vals, sql`, `)})
      on conflict (user_id) do update set ${sql.join(sets, sql`, `)}, updated_at = now()
    `);
  }
  return getPushPrefs(userId);
}

/** The given users who haven't turned `key` off and haven't deleted their account. */
export async function usersWithPref(userIds: string[], key: PushPrefKey): Promise<string[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const rows = await db.execute<{ id: string }>(sql`
    select u.id from users u
    left join push_preferences pp on pp.user_id = u.id
    where u.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      and u.deleted_at is null
      and coalesce(pp.${sql.raw(COLUMN[key])}, true)
  `);
  const keep = new Set(rows.map((r) => r.id));
  return ids.filter((id) => keep.has(id));
}
