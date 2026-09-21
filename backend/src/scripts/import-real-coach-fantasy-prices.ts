// One-off (run once 2026-09-20): overwrites coach_fantasy_prices.price with
// the REAL EuroLeague Fantasy quotation for every current-season team,
// straight from the same players_stats.xlsx export
// scripts/import-real-fantasy-prices.ts already used for players — that
// script explicitly skipped every "Head Coach" row (`if (cols[4] ===
// "Head Coach") continue`), so coach prices were left on
// computeCoachPrice's old, unvalidated 4-16 linear-by-standings-position
// formula the whole time. User report: "all others' CR is fine [but coach
// prices are] way out" — confirmed directly against this export (real
// range is 5-10, nothing close to 16).
//
// Matched by TEAM, not by name — unlike the player import, which has to
// fuzzy-match a player name because there's no other stable key. Every
// team has exactly one head coach, and the export's own "Team" column is
// EuroLeague's public-site 3-letter abbreviation (confirmed: "RMB", "KBA"
// etc. — see frontend/src/app/shared/team-display-code.ts's own doc
// comment on why that's a different code space from this app's
// teams.code), so TEAM_CODE_FROM_SITE below is the exact reverse of that
// file's TEAM_DISPLAY_CODES map. Matching on team is strictly more
// reliable here than name-parsing would be (no risk of a "Last, First" vs
// "First Last" mismatch), and gets a clean 20/20 match — every team in the
// export is a real current-season club, unlike the player export's
// partial (306/335) match rate.
//
// This is a snapshot, not a standing sync: the *next* `npm run
// fantasy:reprice` recomputes every coach from computeCoachPrice again and
// overwrites these back — same cadence as the player import. That
// formula's own COACH_MIN_PRICE/COACH_MAX_PRICE were recalibrated to this
// same export's real 5-10 range in the same pass (services/fantasyScoring.ts),
// so a future reprice with no fresh export lands close to reality instead
// of drifting back toward the old wrong 4-16 spread.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "fs";
import { db } from "../db/client.js";
import { teams, coachFantasyPrices } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";

const XLSX_PATH = "/Users/tsef/Downloads/players_stats.xlsx";
const CSV_PATH = "/tmp/_dunkest_real_prices_coaches.csv";

// Same zipfile+xml.etree stdlib parse as import-real-fantasy-prices.ts —
// no new npm dependency for a one-off script.
const PY = `
import zipfile, xml.etree.ElementTree as ET, csv
z = zipfile.ZipFile(${JSON.stringify(XLSX_PATH)})
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
sst_root = ET.fromstring(z.read('xl/sharedStrings.xml'))
shared = [''.join((t.text or '') for t in si.findall('.//m:t', ns)) for si in sst_root.findall('m:si', ns)]
sheet_root = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
rows = sheet_root.find('m:sheetData', ns).findall('m:row', ns)
def parse_row(row, ncols=28):
    cells = row.findall('m:c', ns)
    result = [''] * ncols
    for c in cells:
        col = ''.join(ch for ch in c.get('r') if ch.isalpha())
        idx = 0
        for ch in col: idx = idx * 26 + (ord(ch) - ord('A') + 1)
        idx -= 1
        t = c.get('t')
        v_el = c.find('m:v', ns)
        v = v_el.text if v_el is not None else ''
        if t == 's' and v != '': v = shared[int(v)]
        if idx < ncols: result[idx] = v
    return result
data = [parse_row(r) for r in rows[1:]]
with open(${JSON.stringify(CSV_PATH)}, 'w', newline='') as f:
    w = csv.writer(f)
    w.writerows(data)
print(len(data))
`;
const PY_SCRIPT_PATH = "/tmp/_dunkest_parse_coaches.py";
writeFileSync(PY_SCRIPT_PATH, PY);
execSync(`python3 ${PY_SCRIPT_PATH}`, { stdio: "inherit" });

interface CoachRow {
  first: string;
  last: string;
  siteTeamCode: string;
  quotation: number;
}

function parseCsv(path: string): CoachRow[] {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  const rows: CoachRow[] = [];
  for (const line of lines) {
    const cols = line.split(",");
    if (cols[4] !== "Head Coach") continue;
    const q = parseFloat(cols[7]);
    if (!cols[5] || isNaN(q)) continue;
    rows.push({ first: cols[1], last: cols[2], siteTeamCode: cols[5], quotation: q });
  }
  return rows;
}

// Exact reverse of frontend/src/app/shared/team-display-code.ts's
// TEAM_DISPLAY_CODES (keyed there by our teams.code, valued by the site's
// abbreviation) — kept in sync by hand since this is a one-off backend
// script with no access to that frontend file.
const TEAM_CODE_FROM_SITE: Record<string, string> = {
  EFS: "IST", // Anadolu Efes Istanbul
  MIL: "MIL", // EA7 Emporio Armani Milan
  BJK: "BES", // Besiktas Istanbul
  CZV: "RED", // Crvena Zvezda Meridianbet Belgrade
  DUB: "DUB", // Dubai Basketball
  BAR: "BAR", // FC Barcelona
  BAY: "MUN", // FC Bayern Munich
  FBT: "ULK", // Fenerbahce Beko Istanbul
  HTA: "HTA", // Hapoel IBI Tel Aviv
  KBA: "BAS", // Kosner Baskonia Vitoria-Gasteiz
  ASV: "ASV", // LDLC ASVEL Villeurbanne
  MTA: "TEL", // Maccabi Rapyd Tel Aviv
  OLY: "OLY", // Olympiacos Piraeus
  PAO: "PAN", // Panathinaikos AKTOR Athens
  PBB: "PRS", // Paris Basketball
  PAR: "PAR", // Partizan Mozzart Bet Belgrade
  RMB: "MAD", // Real Madrid
  VBC: "PAM", // Valencia Basket
  VIR: "VIR", // Virtus Bologna
  ZAL: "ZAL", // Zalgiris Kaunas
};

async function main() {
  const coachRows = parseCsv(CSV_PATH);
  console.log(`Parsed ${coachRows.length} real head-coach rows`);

  const season = (await getCurrentSeason())!;
  const allTeams = await db.select({ id: teams.id, code: teams.code, name: teams.name }).from(teams);

  let matched = 0;
  const unmatched: string[] = [];

  for (const c of coachRows) {
    const internalCode = TEAM_CODE_FROM_SITE[c.siteTeamCode];
    const team = internalCode ? allTeams.find((t) => t.code === internalCode) : undefined;
    if (!team) {
      unmatched.push(`${c.first} ${c.last} (${c.siteTeamCode})`);
      continue;
    }

    await db
      .insert(coachFantasyPrices)
      .values({ teamId: team.id, season, price: c.quotation })
      .onConflictDoUpdate({
        target: [coachFantasyPrices.teamId, coachFantasyPrices.season],
        set: { price: c.quotation, updatedAt: new Date() },
      });
    matched++;
    console.log(`${team.name.padEnd(32)} ${c.first} ${c.last}: ${c.quotation}cr`);
  }

  console.log(`\nWrote real coach prices for ${matched}/${coachRows.length}.`);
  console.log(`Unmatched (${unmatched.length}): ${unmatched.join(", ")}`);

  const stillOnFormula = allTeams.filter((t) => !coachRows.some((c) => TEAM_CODE_FROM_SITE[c.siteTeamCode] === t.code));
  if (stillOnFormula.length) {
    console.log(
      `Teams with no export row, still on computeCoachPrice's formula: ${stillOnFormula.map((t) => t.name).join(", ")}`
    );
  }
  process.exit(0);
}

main();
