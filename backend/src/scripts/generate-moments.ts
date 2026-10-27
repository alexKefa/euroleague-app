// Album Series 2 "Moments": create moment cards for ready rounds by hand.
// Production does this hourly from 2027-01-01 (src/index.ts).
//
//   npm run moments:generate -- --dry-run              # print the picks, write nothing (ignores the launch gate)
//   npm run moments:generate -- --force-before-launch  # really write before launch; dev DB only
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { generateMomentsForReadyRounds } from "../services/moments.js";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force-before-launch");
const host = new URL(process.env.DATABASE_URL ?? "postgres://unknown").hostname;
console.log(`DB: ${host}${dryRun ? " (dry run)" : ""}`);
if (force && !dryRun && !host.includes("ep-sparkling-pond")) {
  console.error("--force-before-launch only runs against the dev database");
  process.exit(1);
}

const results = await generateMomentsForReadyRounds({ dryRun, force });
const teams = new Map(
  (await db.execute<{ id: string; code: string }>(sql`select id, code from teams`)).map((t) => [t.id, t.code])
);
for (const { round, created, picks } of results) {
  console.log(`\nR${round}${dryRun ? "" : `  (${created} cards created)`}`);
  for (const p of picks) {
    const opp = p.opponentTeamId ? teams.get(p.opponentTeamId) : "?";
    console.log(
      `  ${p.role === "mvp" ? "MVP" : "   "}  ${p.playerName} (${teams.get(p.line.teamId)} vs ${opp})  PIR ${p.line.pir ?? "-"} · PTS ${p.line.points ?? "-"} · REB ${p.line.rebounds ?? "-"} · AST ${p.line.assists ?? "-"}`
    );
  }
}
if (results.length === 0) console.log("No ready rounds (or before launch without --dry-run / --force-before-launch).");
process.exit(0);
