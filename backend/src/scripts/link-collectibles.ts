// Backfill for collectibles.player_id (2026-11-12, services/collectiblePlayers.ts).
// Run from backend/: npx tsx src/scripts/link-collectibles.ts [--dry-run] [--prod]
// --dry-run lists the links it would make, the cards still unmatched, and
// which series-1 cards the next roster sync would move to their player's
// current club (flagging any that would duplicate a card already there).
// Production: railway run --service euroleague-app --environment production -- npx tsx src/scripts/link-collectibles.ts --prod [--dry-run]
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { linkCollectiblesToPlayers } from "../services/collectiblePlayers.js";

const dryRun = process.argv.includes("--dry-run");
const host = new URL(process.env.DATABASE_URL ?? "").host;
const isProd = host.includes("pooler.supabase.com");
if (process.argv.includes("--prod") !== isProd) {
  console.error(`Refusing: DB host ${host} ${isProd ? "is" : "is not"} production; pass --prod only for production.`);
  process.exit(1);
}
console.log(`${dryRun ? "[dry run] " : ""}DB: ${isProd ? "PRODUCTION" : "dev"} (${host})`);

const r = await linkCollectiblesToPlayers({ dryRun });
const count = (m: string) => r.linked.filter((l) => l.match === m).length;
console.log(`linked ${r.linked.length}: by team+name ${count("team")}, by name only ${count("name")}, moments ${count("moment")}`);
for (const l of r.linked.filter((l) => l.match === "name")) console.log(`  name-only: ${l.name} (${l.tier})`);
console.log(`unmatched (stay unlinked): ${r.unmatched.length}`);
for (const u of r.unmatched) console.log(`  ${u.name} (${u.tier}, ${u.team})`);

// What the roster sync's card move will do once these links exist. In a dry
// run the links aren't written yet, so they're passed in as values.
const pending = r.linked.length
  ? sql.join(r.linked.map((l) => sql`(${l.id}::uuid, ${l.player_id}::uuid)`), sql`, `)
  : sql`(null::uuid, null::uuid)`;
const moves = await db.execute<{ name: string; tier: string; from_code: string; to_code: string; dup: boolean }>(sql`
  with pending(cid, pid) as (values ${pending})
  select c.name, c.tier, f.code as from_code, t.code as to_code,
    exists (select 1 from collectibles d where d.series = 1 and d.tier = c.tier and d.team_id = p.team_id
            and lower(d.name) = lower(c.name) and d.id <> c.id) as dup
  from collectibles c
  left join pending on pending.cid = c.id
  join players p on p.id = coalesce(c.player_id, pending.pid)
  join teams f on f.id = c.team_id join teams t on t.id = p.team_id
  where c.series = 1 and p.active and c.team_id <> p.team_id
  order by c.name`);
console.log(`cards the next roster sync will move to their player's club: ${moves.length}`);
for (const m of moves) console.log(`  ${m.name} (${m.tier}) ${m.from_code} -> ${m.to_code}${m.dup ? "  !! DUPLICATE: same tier+name already on the new team" : ""}`);
process.exit(0);
