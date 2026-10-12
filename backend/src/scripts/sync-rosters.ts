// Runs the roster sync by hand (2026-10-12, services/rosterSync.ts).
// Run from backend/: npx tsx src/scripts/sync-rosters.ts [--dry-run]
import { syncRosters } from "../services/rosterSync.js";

const dryRun = process.argv.includes("--dry-run");
const r = await syncRosters({ dryRun });
console.log(`${dryRun ? "[dry run] " : ""}${r.season}: ${r.teamsFetched} clubs, ${r.playersOnRosters} rostered players`);
if (r.teamsSkipped.length) console.log("no roster in feed:", r.teamsSkipped.join(", "));
console.log("moved:", r.moved.length ? r.moved.map((m) => `${m.name} ${m.from}->${m.to}`).join("; ") : "none");
console.log("added:", r.added.length ? r.added.map((a) => `${a.name} (${a.team})`).join("; ") : "none");
console.log("deactivated:", r.deactivated.length ? r.deactivated.map((d) => `${d.name} (${d.team})`).join("; ") : "none");
console.log("coaches:", r.coachChanges.length ? r.coachChanges.map((c) => `${c.team}: ${c.from} -> ${c.to}`).join("; ") : "none");
process.exit(0);
