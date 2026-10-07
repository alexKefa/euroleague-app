/**
 * One-off (2026-10-07): creates the `team_budgets` table (schema.ts) and
 * loads the 2026-27 figures from BasketNews' budget round-up. Only the 10
 * clubs that reported a figure get a row. It's idempotent: rows upsert on
 * (team_id, season), so re-running after a correction is safe. Run it on
 * both dev and production.
 *
 * Usage: npx tsx src/scripts/import-team-budgets.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

const SEASON = "2026-27";
const SOURCE_URL = "https://basketnews.com/news-256534-euroleague-teams-budgets-2026-27-payrolls.html";
const m = (millions: number) => Math.round(millions * 1_000_000);

type Row = {
  code: string; // teams.code (the feed's club code)
  netMin?: number;
  netMax?: number;
  gross?: number;
  budgetMin?: number;
  budgetMax?: number;
  via: string; // where BasketNews got the number
};

const ROWS: Row[] = [
  { code: "PAN", netMin: m(34), budgetMin: m(55), budgetMax: m(60), via: "Greek media" },
  { code: "OLY", netMin: m(22), via: "Greek media" },
  { code: "ULK", netMin: m(17), via: "BasketNews sources" },
  { code: "TEL", netMin: m(15.5), via: "Israeli media" },
  { code: "ZAL", netMin: m(12), gross: m(19.7), budgetMin: m(28.8), via: "official announcement" },
  { code: "BES", netMin: m(9), netMax: m(10), budgetMin: m(20), via: "official announcement" },
  { code: "PRS", netMin: m(8.2), budgetMin: m(30.9), via: "LNB report" },
  { code: "ASV", netMin: m(7.88), budgetMin: m(24.8), via: "LNB report" },
  { code: "MIL", budgetMin: m(40), via: "Italian media" },
  { code: "VIR", budgetMin: m(25), via: "Italian media" },
];

async function main() {
  await db.execute(sql`
    create table if not exists team_budgets (
      id uuid primary key default gen_random_uuid(),
      team_id uuid not null references teams(id),
      season varchar(9) not null,
      net_payroll_min integer,
      net_payroll_max integer,
      gross_payroll integer,
      total_budget_min integer,
      total_budget_max integer,
      source text not null,
      source_url text,
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`
    create unique index if not exists team_budgets_team_season_unique on team_budgets (team_id, season)
  `);

  // One multi-row statement: the VALUES list joins to teams by code, so a
  // code that doesn't exist drops out instead of failing.
  const values = sql.join(
    ROWS.map(
      (r) => sql`(${r.code}, ${r.netMin ?? null}::integer, ${r.netMax ?? null}::integer, ${r.gross ?? null}::integer,
        ${r.budgetMin ?? null}::integer, ${r.budgetMax ?? null}::integer, ${"BasketNews (" + r.via + ")"})`
    ),
    sql`, `
  );
  const result = await db.execute(sql`
    insert into team_budgets (team_id, season, net_payroll_min, net_payroll_max, gross_payroll,
      total_budget_min, total_budget_max, source, source_url)
    select t.id, ${SEASON}, v.net_min, v.net_max, v.gross, v.budget_min, v.budget_max, v.source, ${SOURCE_URL}
    from (values ${values}) as v(code, net_min, net_max, gross, budget_min, budget_max, source)
    join teams t on t.code = v.code
    on conflict (team_id, season) do update set
      net_payroll_min = excluded.net_payroll_min,
      net_payroll_max = excluded.net_payroll_max,
      gross_payroll = excluded.gross_payroll,
      total_budget_min = excluded.total_budget_min,
      total_budget_max = excluded.total_budget_max,
      source = excluded.source,
      source_url = excluded.source_url,
      updated_at = now()
    returning team_id
  `);
  console.log(`team_budgets: upserted ${result.length} of ${ROWS.length} row(s) for ${SEASON}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
