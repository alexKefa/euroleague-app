// One-off (run once 2026-09-19): overwrites player_fantasy_prices.price
// with the REAL EuroLeague Fantasy quotation for every player we can match,
// straight from a live export of the real app (its own "Download" button,
// while logged in — see services/fantasyScoring.ts's FANTASY_NO_DATA_PRICE
// comment for why this couldn't be pulled unauthenticated). Deliberately
// bypasses computeFantasyPrice for these players entirely rather than only
// using this data to calibrate the formula's constants (the earlier half
// of this pass) — real ground truth beats an approximation of it, and this
// fixes real known misses (TJ Shorts, Jonas Valančiūnas, ...) the tuned
// formula still can't reach on its own, since their most-recent on-file
// prior season doesn't reflect their real current-year role.
//
// This is a snapshot, not a standing sync: the *next* `npm run
// fantasy:reprice` run recomputes every player from computeFantasyPrice
// again and overwrites these real values right back — same
// "manual/occasional, not a cron" cadence that script already has. Players
// this export doesn't cover, or a name it can't match, are untouched,
// still governed by the formula.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "fs";
import { db } from "../db/client.js";
import { players, playerFantasyPrices } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";

const XLSX_PATH = "/Users/tsef/Downloads/players_stats.xlsx";
const CSV_PATH = "/tmp/_dunkest_real_prices.csv";

// xlsx is just a zip of XML — parsed with Python's stdlib (zipfile +
// xml.etree, both built in) rather than adding a new npm dependency for a
// one-off script. Same approach already verified working earlier this
// session.
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
const PY_SCRIPT_PATH = "/tmp/_dunkest_parse.py";
writeFileSync(PY_SCRIPT_PATH, PY);
execSync(`python3 ${PY_SCRIPT_PATH}`, { stdio: "inherit" });

interface DunkestRow {
  first: string;
  last: string;
  position: string;
  team: string;
  quotation: number;
}

function parseCsv(path: string): DunkestRow[] {
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  const rows: DunkestRow[] = [];
  for (const line of lines) {
    const cols = line.split(",");
    const q = parseFloat(cols[7]);
    if (!cols[1] || isNaN(q)) continue;
    if (cols[4] === "Head Coach") continue;
    rows.push({ first: cols[1], last: cols[2], position: cols[4], team: cols[5], quotation: q });
  }
  return rows;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function norm(s: string): string {
  return stripAccents(s.trim().toLowerCase()).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}
function dbParts(raw: string) {
  const [last, first] = raw.split(",").map((s) => norm(s ?? ""));
  return { first, last };
}

async function main() {
  const dunkest = parseCsv(CSV_PATH);
  console.log(`Parsed ${dunkest.length} real player rows`);

  const season = (await getCurrentSeason())!;
  const allPlayers = await db.select({ id: players.id, name: players.name }).from(players);

  let matched = 0;
  const unmatched: string[] = [];

  for (const d of dunkest) {
    const targetLast = norm(d.last);
    const targetFirst = norm(d.first);
    const lastHits = allPlayers.filter((p) => dbParts(p.name).last === targetLast);
    const player = lastHits.length === 1 ? lastHits[0] : lastHits.find((p) => dbParts(p.name).first === targetFirst);
    if (!player) {
      unmatched.push(`${d.first} ${d.last} (${d.team})`);
      continue;
    }

    await db
      .insert(playerFantasyPrices)
      .values({ playerId: player.id, season, price: d.quotation })
      .onConflictDoUpdate({
        target: [playerFantasyPrices.playerId, playerFantasyPrices.season],
        set: { price: d.quotation, updatedAt: new Date() },
      });
    matched++;
  }

  console.log(`Wrote real prices for ${matched}/${dunkest.length} players.`);
  console.log(`Unmatched (${unmatched.length}): ${unmatched.join(", ")}`);
  process.exit(0);
}

main();
