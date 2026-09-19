// One-off, run once (2026-09-19): seeds player_injuries from basketnews.com's
// EuroLeague injury report (https://basketnews.com/news-212393-euroleague-injury-report-updated.html),
// since that data has no feed to sync from (see schema.ts's doc comment on
// playerInjuries — "admin-entered, not synced"). Mirrors routes/injuries.ts's
// own upsert-by-playerId exactly (onConflictDoUpdate on playerId), just
// batched here instead of one admin form submission per player. Entries the
// article listed as a plain "Coach's decision absence" (not an actual
// injury) are deliberately excluded — see the filtered-out list below.
import { db } from "../db/client.js";
import { players, teams, playerInjuries } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

type Status = "out" | "doubtful" | "questionable" | "probable";

interface Entry {
  teamCode: string;
  playerName: string;
  status: Status;
  note: string;
}

// "Uncertain"/"Game-time" (no finer distinction available) -> "questionable";
// "Doubtful" -> "doubtful"; "Out" -> "out". None of today's real entries read
// as "probable" (likely to play) so that status isn't used here.
const ENTRIES: Entry[] = [
  { teamCode: "IST", playerName: "Isaia Cordinier", status: "doubtful", note: "Rehab after surgery" },
  { teamCode: "IST", playerName: "Georgios Papagiannis", status: "doubtful", note: "Left knee ACL injury" },

  { teamCode: "DUB", playerName: "Dzanan Musa", status: "questionable", note: "Undisclosed injury" },

  { teamCode: "BAR", playerName: "Dario Brizuela", status: "questionable", note: "Severe contusion in right leg" },
  { teamCode: "BAR", playerName: "Tosan Evbuomwan", status: "out", note: "Shoulder injury" },
  { teamCode: "BAR", playerName: "Yoan Makoundou", status: "out", note: "Left knee injury (out rounds 1-6)" },

  { teamCode: "ULK", playerName: "Shane Larkin", status: "questionable", note: "Undisclosed injury" },

  { teamCode: "HTA", playerName: "Tamir Blatt", status: "questionable", note: "Status unclear" },
  { teamCode: "HTA", playerName: "Tyler Ennis", status: "doubtful", note: "Torn Achilles" },

  { teamCode: "BAS", playerName: "Alex Len", status: "questionable", note: "Physical discomfort" },

  { teamCode: "TEL", playerName: "Jimmy Clark III", status: "questionable", note: "Thigh injury" },

  { teamCode: "OLY", playerName: "Nikola Milutinov", status: "questionable", note: "Left leg tendinitis" },

  { teamCode: "PAN", playerName: "Moustapha Fall", status: "questionable", note: "Hamstring injury" },
  {
    teamCode: "PAN",
    playerName: "Nigel Hayes-Davis",
    status: "out",
    note: "Fractured fourth metacarpal, left hand (out rounds 1-4)",
  },
  { teamCode: "PAN", playerName: "Kendrick Nunn", status: "out", note: "Medial right meniscus tear" },
  { teamCode: "PAN", playerName: "Nikos Rogkavopoulos", status: "questionable", note: "Hamstring strain (game-time decision)" },
  { teamCode: "PAN", playerName: "Kostas Sloukas", status: "out", note: "Rehab after leg injury" },

  { teamCode: "PAR", playerName: "Jabari Parker", status: "questionable", note: "Status unclear" },

  { teamCode: "MAD", playerName: "Usman Garuba", status: "out", note: "Torn ACL (long-term)" },

  { teamCode: "VIR", playerName: "Kevin Kokila", status: "out", note: "Status unclear" },

  {
    teamCode: "ZAL",
    playerName: "Kaodirichi Akobundu-Ehiogu",
    status: "questionable",
    note: "Not in 12-man roster in domestic league",
  },
  { teamCode: "ZAL", playerName: "Saben Lee", status: "out", note: "Hamstring strain, several weeks sidelined" },
  {
    teamCode: "ZAL",
    playerName: "Deividas Sirvydis",
    status: "questionable",
    note: "Not in 12-man roster in domestic league",
  },
  { teamCode: "ZAL", playerName: "Azuolas Tubelis", status: "questionable", note: "Left ankle injury (domestic league game)" },
];

// Excluded on purpose — listed by basketnews as a "Coach's decision absence"
// with no actual injury attached, so writing these to player_injuries would
// misrepresent a healthy scratch as an injury: Awudu Abass, Nemanja
// Dangubic, Kenan Kamenjas, Kosta Kondic, Klemen Prepelic (Dubai),
// Melih Mahmutoglu, Ignas Sarginas (Fenerbahce), Damian Jones, Sergio
// Llull, Gabriele Procida (Real Madrid).

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalize(name: string): string {
  return stripAccents(name.trim().toLowerCase()).replace(/\s+/g, " ");
}

// players.name is stored raw off the feed as "LAST, FIRST" (all-caps, see
// expand-collectibles.ts's own displayName()) — basketnews's article gives
// "First Last" instead, and sometimes a nickname ("Nikos" for "Nikolaos").
// Match on normalized last name within the team first (most reliable across
// nickname/full-name mismatches), and only fall back to a full first+last
// comparison to disambiguate if a team has more than one same-last-name hit.
const SUFFIX_RE = /\s+(jr\.?|sr\.?|ii|iii|iv)$/;

function dbNameParts(raw: string): { first: string; last: string } {
  const [last, first] = raw.split(",").map((s) => normalize(s ?? ""));
  return { first, last: last.replace(SUFFIX_RE, "") };
}

function articleNameParts(name: string): { first: string; last: string } {
  const words = normalize(name).split(" ");
  // "Jimmy Clark III" — drop a trailing roman-numeral/suffix token before
  // treating the last remaining word as the surname.
  if (words.length > 2 && /^(jr\.?|sr\.?|ii|iii|iv)$/.test(words[words.length - 1])) {
    words.pop();
  }
  return { first: words.slice(0, -1).join(" "), last: words[words.length - 1] };
}

const ADMIN_USER_ID = "07648081-a351-4b50-b138-252c804c9241"; // clutchappadmin@getclutchapp.com

async function main() {
  const allTeams = await db.select().from(teams);
  const allPlayers = await db.select().from(players);

  let matched = 0;
  const unmatched: Entry[] = [];

  for (const entry of ENTRIES) {
    const team = allTeams.find((t) => t.code === entry.teamCode);
    if (!team) {
      unmatched.push(entry);
      continue;
    }
    const target = articleNameParts(entry.playerName);
    const teamRoster = allPlayers.filter((p) => p.teamId === team.id);
    const lastNameHits = teamRoster.filter((p) => dbNameParts(p.name).last === target.last);
    const player =
      lastNameHits.length === 1
        ? lastNameHits[0]
        : lastNameHits.find((p) => dbNameParts(p.name).first === target.first);
    if (!player) {
      unmatched.push(entry);
      continue;
    }

    await db
      .insert(playerInjuries)
      .values({
        playerId: player.id,
        status: entry.status,
        note: entry.note,
        updatedByUserId: ADMIN_USER_ID,
      })
      .onConflictDoUpdate({
        target: playerInjuries.playerId,
        set: { status: entry.status, note: entry.note, updatedByUserId: ADMIN_USER_ID, updatedAt: new Date() },
      });

    matched++;
    console.log(`OK  ${team.code} ${player.name} -> ${entry.status}`);
  }

  console.log(`\n${matched}/${ENTRIES.length} matched and written.`);
  if (unmatched.length) {
    console.log("\nUNMATCHED (no player row found — check spelling/team):");
    for (const e of unmatched) console.log(` - ${e.teamCode} ${e.playerName}`);
  }
  process.exit(0);
}

main();
