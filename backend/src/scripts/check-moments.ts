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

if (!(process.env.DATABASE_URL ?? "").includes("ep-sparkling-pond")) throw new Error("refusing to run outside the dev database");

type Row = Record<string, unknown>;
const one = async <T extends Row>(q: ReturnType<typeof sql>) => (await db.execute<T>(q))[0];
const count = async (q: ReturnType<typeof sql>) => (await one<{ n: number }>(q)).n;

async function cleanup() {
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
