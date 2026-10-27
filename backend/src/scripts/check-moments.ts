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
import { checkAndGrantMomentBonuses, markMomentBonusesSeen } from "../services/moments.js";
import { computeTopScorerPlayerIdsForGames } from "../services/topScorerPoints.js";
import { getAlbumLeaderboardEntries } from "../services/albumLeaderboard.js";

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
const restoreStats = new Map<string, number | null>();

type Mvp = { collectible_id: string; round: number; game_id: string; player_id: string; points: number };
/** The generated MVP moments, each flagged with whether the MVP was their game's top scorer. */
async function mvps(): Promise<(Mvp & { topScorer: boolean })[]> {
  const rows = await db.execute<Mvp>(sql`
    select m.collectible_id, m.round, m.game_id, m.player_id, m.points from collectible_moments m where m.role = 'mvp' order by m.round`);
  const top = await computeTopScorerPlayerIdsForGames(rows.map((r) => r.game_id));
  return rows.map((r) => ({ ...r, topScorer: (top.get(r.game_id) ?? []).includes(r.player_id) }));
}
async function mvpWhere(topScorer: boolean): Promise<Mvp> {
  const all = await mvps();
  const m = all.find((x) => x.topScorer === topScorer);
  if (m) return m;
  if (topScorer || all.length === 0) throw new Error("fixture: dev data has no round whose MVP was the top scorer");
  // Dev's simulated games make every MVP the top scorer: for "wasn't",
  // outscore the MVP in their game for the duration of the check.
  const target = all[0];
  const mvpPts = await one<{ points: number }>(sql`select points from player_game_stats where game_id = ${target.game_id} and player_id = ${target.player_id}`);
  const other = await one<{ id: string; points: number | null }>(sql`
    select id, points from player_game_stats where game_id = ${target.game_id} and player_id <> ${target.player_id} order by id limit 1`);
  if (!restoreStats.has(other.id)) restoreStats.set(other.id, other.points);
  await db.execute(sql`update player_game_stats set points = ${mvpPts.points + 1} where id = ${other.id}`);
  return target;
}
/** `n` correct winner picks in `round` for the user. */
async function correctPicks(userId: string, round: number, n: number) {
  await db.execute(sql`
    insert into predictions (user_id, game_id, predicted_winner_team_id)
    select ${userId}, g.id, case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
    from games g
    where g.round = ${round} and g.season = (select season from collectible_moments limit 1)
      and g.status = 'final' and g.home_score <> g.away_score
    order by g.tipoff_at limit ${n}`);
}
async function backMvp(userId: string, m: Mvp) {
  await db.execute(sql`insert into top_scorer_predictions (user_id, game_id, predicted_player_id) values (${userId}, ${m.game_id}, ${m.player_id})`);
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
  for (const [id, points] of restoreStats) await db.execute(sql`update player_game_stats set points = ${points} where id = ${id}`);
  restoreStats.clear();
  for (const id of userIds) {
    await db.execute(sql`delete from predictions where user_id = ${id}`);
    await db.execute(sql`delete from top_scorer_predictions where user_id = ${id}`);
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

// --- Task 5: MVP-moment bonus
check("great round grants the round MVP once, and stays in the reveal until seen", async () => {
  const user = await mkUser("great");
  const m = await mvpWhere(false);
  await correctPicks(user, m.round, 8);
  const first = await checkAndGrantMomentBonuses(user);
  assert.deepEqual(first.map((b) => [b.round, b.reason]), [[m.round, "great_round"]]);
  assert.equal((await checkAndGrantMomentBonuses(user)).length, 1, "unseen bonus should still be returned");
  assert.equal(await count(sql`select count(*)::int n from moment_bonuses where user_id = ${user}`), 1);
  assert.equal(await count(sql`select count(*)::int n from user_collectibles where user_id = ${user} and collectible_id = ${m.collectible_id}`), 1);
  await markMomentBonusesSeen(user);
  assert.deepEqual(await checkAndGrantMomentBonuses(user), []);
});

check("7 correct picks is not a great round", async () => {
  const user = await mkUser("seven");
  const m = await mvpWhere(false);
  await correctPicks(user, m.round, 7);
  assert.deepEqual(await checkAndGrantMomentBonuses(user), []);
});

check("backing the MVP qualifies even when tied for top scorer", async () => {
  const user = await mkUser("tie");
  const m = await mvpWhere(true);
  const other = await one<{ id: string; points: number | null }>(sql`
    select id, points from player_game_stats where game_id = ${m.game_id} and player_id <> ${m.player_id} order by points desc nulls last limit 1`);
  const mvpNow = await one<{ points: number }>(sql`select points from player_game_stats where game_id = ${m.game_id} and player_id = ${m.player_id}`);
  restoreStats.set(other.id, other.points);
  await db.execute(sql`update player_game_stats set points = ${mvpNow.points} where id = ${other.id}`);
  await backMvp(user, m);
  assert.deepEqual((await checkAndGrantMomentBonuses(user)).map((b) => [b.round, b.reason]), [[m.round, "backed_mvp"]]);
});

check("backing an MVP who wasn't top scorer gives nothing, a great round still does", async () => {
  const user = await mkUser("nottop");
  const m = await mvpWhere(false);
  await backMvp(user, m);
  assert.deepEqual(await checkAndGrantMomentBonuses(user), []);
  await correctPicks(user, m.round, 8);
  assert.deepEqual((await checkAndGrantMomentBonuses(user)).map((b) => [b.round, b.reason]), [[m.round, "great_round"]]);
});

check("both conditions give one bonus with reason backed_mvp", async () => {
  const user = await mkUser("both");
  const m = await mvpWhere(true);
  await correctPicks(user, m.round, 8);
  await backMvp(user, m);
  const got = await checkAndGrantMomentBonuses(user);
  assert.deepEqual(got.map((b) => [b.round, b.reason]), [[m.round, "backed_mvp"]]);
});

check("already owning the MVP card records the bonus without a second copy", async () => {
  const user = await mkUser("owned");
  const m = await mvpWhere(false);
  await db.execute(sql`insert into user_collectibles (user_id, collectible_id) values (${user}, ${m.collectible_id})`);
  await correctPicks(user, m.round, 8);
  await checkAndGrantMomentBonuses(user);
  assert.equal(await count(sql`select count(*)::int n from moment_bonuses where user_id = ${user}`), 1);
  assert.equal(await count(sql`select count(*)::int n from user_collectibles where user_id = ${user} and collectible_id = ${m.collectible_id}`), 1);
  await checkAndGrantMomentBonuses(user);
  assert.equal(await count(sql`select count(*)::int n from moment_bonuses where user_id = ${user}`), 1);
});

check("a deleted user never qualifies", async () => {
  const user = await mkUser("deleted");
  const m = await mvpWhere(false);
  await correctPicks(user, m.round, 8);
  await db.execute(sql`update users set deleted_at = now() where id = ${user}`);
  assert.deepEqual(await checkAndGrantMomentBonuses(user), []);
  assert.equal(await count(sql`select count(*)::int n from moment_bonuses where user_id = ${user}`), 0);
});

// --- Task 6: catalog fields and the Series 1 flag
check("catalog serves moment details on series 2 cards only", async () => {
  const catalog = await buildCatalogPayload();
  const moment = catalog.find((c) => c.series === 2);
  assert.ok(moment, "no series 2 card in the catalog");
  assert.equal(typeof moment.moment?.round, "number");
  assert.ok(moment.moment?.role === "mvp" || moment.moment?.role === "top");
  assert.equal(typeof moment.moment?.pir, "number");
  assert.equal(moment.serialNumber, undefined, "moments are numbered by round, not serial");
  const s1 = catalog.find((c) => c.series === 1)!;
  assert.equal(s1.moment, null);
  assert.equal(typeof s1.serialNumber, "number");
  const s1Rares = catalog.filter((c) => c.series === 1 && c.tier === "rare").length;
  assert.equal(s1.tier === "rare" ? s1.serialTotal : s1Rares, s1Rares, "series 1 serial totals must not count moments");
});

check("series1Complete is true only once every Series 1 card is owned", async () => {
  const user = await mkUser("s1done");
  for (const tier of ["common", "rare", "legendary", "coach"]) await ownAllBut(user, tier, 1, null);
  const missing = await one<{ id: string }>(sql`select id from collectibles where series = 1 order by id limit 1`);
  await db.execute(sql`delete from user_collectibles where user_id = ${user} and collectible_id = ${missing.id}`);
  let [entry] = await getAlbumLeaderboardEntries({ userIds: [user] });
  assert.equal(entry.series1Complete, false);
  await db.execute(sql`insert into user_collectibles (user_id, collectible_id) values (${user}, ${missing.id})`);
  [entry] = await getAlbumLeaderboardEntries({ userIds: [user] });
  assert.equal(entry.series1Complete, true);
  assert.ok(entry.ownedCount < entry.totalCount, "total still includes series 2");
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
