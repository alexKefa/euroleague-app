// Album Series 2 "Moments" DB checks, against the dev database only.
// Generates moments for dev's completed rounds, asserts behaviour, and
// removes everything it created at the end (pass or fail).
//
//   npm run check:moments
import "dotenv/config";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { generateMomentsForReadyRounds } from "../services/moments.js";
import { cached, CACHE_KEYS } from "../services/responseCache.js";
import { buildCatalogPayload } from "../routes/collectibles.js";
import { rollPackForUser } from "../services/packs.js";
import { grantGuaranteedNewCollectible } from "../services/cards.js";

if (!(process.env.DATABASE_URL ?? "").includes("ep-sparkling-pond")) throw new Error("refusing to run outside the dev database");

type Row = Record<string, unknown>;
const one = async <T extends Row>(q: ReturnType<typeof sql>) => (await db.execute<T>(q))[0];
const count = async (q: ReturnType<typeof sql>) => (await one<{ n: number }>(q)).n;

// Throwaway users, deleted (with everything they own) in cleanup().
const ts = Date.now();
const userIds: string[] = [];
async function mkUser(tag: string): Promise<string> {
  const u = await one<{ id: string }>(sql`
    insert into users (email, username, password_hash, referral_code)
    values (${`check-mom-${tag}-${ts}@dev.invalid`}, ${`check-mom-${tag}-${ts}`}, 'x', ${`m${String(ts).slice(-7)}${userIds.length}`})
    returning id`);
  userIds.push(u.id);
  return u.id;
}
/** Gives the user every card of `tier` in `series` except `exceptId`. */
async function ownAllBut(userId: string, tier: string, series: number, exceptId: string | null) {
  await db.execute(sql`
    insert into user_collectibles (user_id, collectible_id)
    select ${userId}, id from collectibles where tier = ${tier} and series = ${series}
      and (${exceptId}::uuid is null or id <> ${exceptId}::uuid)
    on conflict do nothing`);
}

async function cleanup() {
  for (const id of userIds) {
    await db.execute(sql`delete from moment_bonuses where user_id = ${id}`);
    await db.execute(sql`delete from user_collectibles where user_id = ${id}`);
    await db.execute(sql`delete from users where id = ${id}`);
  }
  await db.execute(sql`delete from moment_bonuses where collectible_id in (select id from collectibles where series = 2)`);
  await db.execute(sql`delete from user_collectibles where collectible_id in (select id from collectibles where series = 2)`);
  await db.execute(sql`delete from collectible_moments`);
  await db.execute(sql`delete from collectibles where series = 2`);
}

const checks: [string, () => Promise<void>][] = [];
const check = (name: string, fn: () => Promise<void>) => checks.push([name, fn]);

// --- Task 3: generation
check("launch gate: nothing before 2027-01-01 without force", async () => {
  const r = await generateMomentsForReadyRounds({ now: new Date("2026-12-01T00:00:00Z") });
  assert.deepEqual(r, []);
  assert.equal(await count(sql`select count(*)::int n from collectible_moments`), 0);
});

check("catalog cache is invalidated by generation", async () => {
  const before = await cached(CACHE_KEYS.collectibles, 10 * 60_000, buildCatalogPayload);
  const created = await generateMomentsForReadyRounds({ force: true });
  assert.ok(created.length > 0, "dev should have completed rounds to generate");
  const after = await cached(CACHE_KEYS.collectibles, 10 * 60_000, buildCatalogPayload);
  assert.ok(after.length > before.length, "catalog still served from the stale cache");
});

check("generate twice is idempotent", async () => {
  const n = await count(sql`select count(*)::int n from collectible_moments`);
  assert.deepEqual(await generateMomentsForReadyRounds({ force: true }), []);
  assert.equal(await count(sql`select count(*)::int n from collectible_moments`), n);
});

check("each round has 1 mvp legendary and 5 top rares, all series 2", async () => {
  const rounds = await db.execute<{ round: number; mvp: number; top: number; bad: number }>(sql`
    select m.round,
      count(*) filter (where m.role = 'mvp' and c.tier = 'legendary')::int mvp,
      count(*) filter (where m.role = 'top' and c.tier = 'rare')::int top,
      count(*) filter (where c.series <> 2)::int bad
    from collectible_moments m join collectibles c on c.id = m.collectible_id group by m.round`);
  assert.ok(rounds.length > 0);
  for (const r of rounds) assert.deepEqual([r.mvp, r.top, r.bad], [1, 5, 0], `round ${r.round}`);
});

check("the MVP is the round's highest PIR line and names are display names", async () => {
  const r = await one<{ round: number; pir: number; best: number; name: string }>(sql`
    select m.round, m.pir, c.name,
      (select max(s.valuation) from player_game_stats s join games g on g.id = s.game_id
        where g.season = m.season and g.round = m.round)::int best
    from collectible_moments m join collectibles c on c.id = m.collectible_id
    where m.role = 'mvp' order by m.round limit 1`);
  assert.equal(r.pir, r.best);
  assert.ok(!r.name.includes(","), `raw feed name on card: ${r.name}`);
});

// --- Task 4: Series 1 first for guaranteed-new pulls
check("forced legendary pulls fill the last Series 1 gap before any Series 2", async () => {
  const user = await mkUser("s1first");
  const missing = await one<{ id: string }>(sql`select id from collectibles where tier = 'legendary' and series = 1 order by id limit 1`);
  await ownAllBut(user, "legendary", 1, missing.id);
  for (let i = 0; i < 20; i++) {
    const { slots } = await rollPackForUser(user, "wheelLegendary");
    assert.equal(slots[0].collectible.id, missing.id, `pull ${i} landed on ${slots[0].collectible.name} (series ${slots[0].collectible.series})`);
  }
  await ownAllBut(user, "legendary", 1, null);
  const { slots } = await rollPackForUser(user, "wheelLegendary");
  assert.equal(slots[0].collectible.series, 2, "with Series 1 complete the forced pull should be a new Series 2 legendary");
  assert.equal(slots[0].wasDuplicate, false);
});

check("milestone rare grants fill the last Series 1 rare first", async () => {
  const user = await mkUser("s1rare");
  const missing = await one<{ id: string }>(sql`select id from collectibles where tier = 'rare' and series = 1 order by id limit 1`);
  await ownAllBut(user, "rare", 1, missing.id);
  for (let i = 0; i < 5; i++) {
    const got = await grantGuaranteedNewCollectible(user, "rare");
    assert.equal(got, missing.id, `grant ${i} gave a different card`);
    await db.execute(sql`delete from user_collectibles where user_id = ${user} and collectible_id = ${got}`);
  }
});

let failed = 0;
try {
  await cleanup();
  for (const [name, fn] of checks) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${name}\n     ${(err as Error).message}`);
    }
  }
} finally {
  await cleanup();
  console.log(failed ? `${failed} check(s) failed` : "all moments checks passed");
  process.exit(failed ? 1 : 0);
}
