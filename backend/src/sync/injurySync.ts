import * as cheerio from "cheerio";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { players, playerInjuries, teams } from "../db/schema.js";
import { BASKETNEWS_TEAM_SLUGS } from "./injuryTeamMap.js";

// The only source for EuroLeague injury data at all — see schema.ts's doc
// comment on playerInjuries for why there's no official feed. Confirmed
// live (2026-09-19) that this exact URL is a persistent page basketnews
// keeps updating in place ("EuroLeague Injury Report (updated daily)" is
// its own on-page subtitle), not a one-off dated news article — unlike
// most basketnews.com articles, so this doesn't need a "find today's
// article" discovery step, just a daily re-fetch of the same URL.
const REPORT_URL = "https://basketnews.com/news-212393-euroleague-injury-report-updated.html";

type Status = "out" | "doubtful" | "questionable" | "probable";

// basketnews' own "Player status color guide" (scraped straight off the
// page, not guessed) -> this app's 4-value vocabulary. "Expected" reads
// closest to "probable" (likely to play, unconfirmed); "Game-time" and
// "Uncertain" both collapse into "questionable" — neither has a clean 1:1
// counterpart, and both describe genuine uncertainty the same way
// "questionable" already does elsewhere in this app. "Ready" is
// deliberately absent — it means healthy and is also basketnews' own
// placeholder text for a team with no injuries at all (see parseReport's
// colspan check), so it never becomes a row here either way.
const STATUS_MAP: Record<string, Status> = {
  Expected: "probable",
  Questionable: "questionable",
  "Game-time": "questionable",
  Doubtful: "doubtful",
  Out: "out",
  Uncertain: "questionable",
};

// basketnews has no separate "healthy scratch" status — a coach's-decision
// absence just shows up with a real status (usually Uncertain) and this
// phrase in the free-text comment. Written to every report row so far
// (checked 2026-09-19), case-sensitivity aside. Excluded on purpose —
// writing these as an "injury" would misrepresent a healthy player as
// hurt (same exclusion scripts/import-basketnews-injuries.ts applied by
// hand for its one-time import; this supersedes it for ongoing updates).
const COACH_DECISION_RE = /coach'?s?\s+decision/i;

interface ParsedRow {
  teamSlug: string;
  playerName: string;
  status: Status;
  note: string;
}

const SUFFIX_RE = /\s+(jr\.?|sr\.?|ii|iii|iv)$/;

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalize(name: string): string {
  return stripAccents(name.trim().toLowerCase()).replace(/\s+/g, " ");
}

// players.name is stored raw off the feed as "LAST, FIRST" — see
// expand-collectibles.ts's own displayName(). Matches
// scripts/import-basketnews-injuries.ts's own name-matching exactly (same
// last-name-first, first-name-to-disambiguate approach), just kept local
// here since this is now permanent code, not a one-off script.
function dbNameParts(raw: string): { first: string; last: string } {
  const [last, first] = raw.split(",").map((s) => normalize(s ?? ""));
  return { first, last: last.replace(SUFFIX_RE, "") };
}

function reportNameParts(name: string): { first: string; last: string } {
  const words = normalize(name).split(" ").filter(Boolean);
  if (words.length > 2 && /^(jr\.?|sr\.?|ii|iii|iv)$/.test(words[words.length - 1])) {
    words.pop();
  }
  return { first: words.slice(0, -1).join(" "), last: words[words.length - 1] };
}

/**
 * Parses the injury-reports-table into one row per real injury — skips
 * team-header rows and the "No injured players"/colspan placeholder rows
 * structurally (a real player row always has exactly 5 plain <td>s, none
 * with a colspan), and coach's-decision entries by their comment text.
 */
export function parseReport(html: string): { rows: ParsedRow[]; unmappedStatuses: string[] } {
  const $ = cheerio.load(html);
  const rows: ParsedRow[] = [];
  const unmappedStatuses = new Set<string>();
  let currentTeamSlug: string | null = null;

  $("#injury-reports-table tbody > tr").each((_, el) => {
    const $row = $(el);
    const teamSlug = $row.attr("id");
    if (teamSlug) {
      currentTeamSlug = teamSlug;
      return;
    }
    const $cells = $row.find("> td");
    if ($cells.length !== 5 || $cells.first().attr("colspan")) return; // placeholder/empty-team row
    if (!currentTeamSlug) return;

    const playerName = $cells.eq(1).text().trim();
    const statusLabel = $cells.eq(2).text().trim();
    const note = $cells.eq(4).text().trim();
    if (!playerName || !statusLabel) return;
    if (COACH_DECISION_RE.test(note)) return;

    const status = STATUS_MAP[statusLabel];
    if (!status) {
      unmappedStatuses.add(statusLabel);
      return;
    }

    rows.push({ teamSlug: currentTeamSlug, playerName, status, note });
  });

  return { rows, unmappedStatuses: [...unmappedStatuses] };
}

export interface InjurySyncResult {
  matched: number;
  cleared: number;
  unmatched: { teamSlug: string; playerName: string }[];
  unmatchedTeamSlugs: string[];
  unmappedStatuses: string[];
}

const EMPTY_RESULT: InjurySyncResult = {
  matched: 0,
  cleared: 0,
  unmatched: [],
  unmatchedTeamSlugs: [],
  unmappedStatuses: [],
};

// The system's own attributed writer for every sync-sourced row — same
// admin account the one-off import used (routes/injuries.ts's POST
// requires a real users.id for updatedByUserId; there's no dedicated bot
// account and creating one isn't worth the extra user-table bookkeeping
// for a FK that's otherwise unused here). `source: "sync"` (see schema.ts)
// is what actually distinguishes this from a human's own edit, not this id.
const SYNC_ATTRIBUTED_USER_ID = "07648081-a351-4b50-b138-252c804c9241"; // clutchappadmin@getclutchapp.com

export async function syncInjuries(): Promise<InjurySyncResult> {
  const res = await fetch(REPORT_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ClutchAppBot/1.0)" },
  });
  if (!res.ok) {
    console.error(`[injury sync] fetch failed: HTTP ${res.status}`);
    return EMPTY_RESULT;
  }
  const html = await res.text();
  const { rows, unmappedStatuses } = parseReport(html);
  // A structural page change (a redesign, a renamed table id) would make
  // parseReport come back empty — bail out entirely rather than treating
  // that as "zero injuries today" and wiping every existing sync row via
  // the reconcile step below.
  if (rows.length === 0) {
    console.error("[injury sync] parsed 0 rows — basketnews' page structure may have changed, skipping this run");
    return EMPTY_RESULT;
  }

  const [allTeams, allPlayers] = await Promise.all([
    db.select({ id: teams.id, code: teams.code }).from(teams),
    db.select({ id: players.id, name: players.name, teamId: players.teamId }).from(players),
  ]);
  const teamIdByCode = new Map(allTeams.map((t) => [t.code, t.id]));

  const unmatched: { teamSlug: string; playerName: string }[] = [];
  const unmatchedTeamSlugs = new Set<string>();
  const matchedIds: string[] = [];
  let matched = 0;

  for (const row of rows) {
    const teamCode = BASKETNEWS_TEAM_SLUGS[row.teamSlug];
    const teamId = teamCode ? teamIdByCode.get(teamCode) : undefined;
    if (!teamId) {
      unmatchedTeamSlugs.add(row.teamSlug);
      continue;
    }

    const target = reportNameParts(row.playerName);
    const teamRoster = allPlayers.filter((p) => p.teamId === teamId);
    const lastNameHits = teamRoster.filter((p) => dbNameParts(p.name).last === target.last);
    const player =
      lastNameHits.length === 1 ? lastNameHits[0] : lastNameHits.find((p) => dbNameParts(p.name).first === target.first);
    if (!player) {
      unmatched.push({ teamSlug: row.teamSlug, playerName: row.playerName });
      continue;
    }

    await db
      .insert(playerInjuries)
      .values({
        playerId: player.id,
        status: row.status,
        note: row.note || null,
        source: "sync",
        updatedByUserId: SYNC_ATTRIBUTED_USER_ID,
      })
      .onConflictDoUpdate({
        target: playerInjuries.playerId,
        // noteEl deliberately left out of `set` — basketnews has no Greek
        // text, and omitting the field here keeps whatever an admin may
        // have hand-translated in place rather than clobbering it with
        // null on every re-sync (see schema.ts's note on this column).
        set: { status: row.status, note: row.note || null, source: "sync", updatedByUserId: SYNC_ATTRIBUTED_USER_ID, updatedAt: new Date() },
      });

    matchedIds.push(player.id);
    matched++;
  }

  // Reconcile: a 'sync' row for a player no longer in today's report
  // (recovered, or dropped off the page) gets cleared, same "healthy = no
  // row" convention as a manual admin removal — but only ever a 'sync'
  // row, never a human's own 'admin' entry (see schema.ts's doc comment
  // on `source`).
  const cleared =
    matchedIds.length > 0
      ? await db
          .delete(playerInjuries)
          .where(and(eq(playerInjuries.source, "sync"), notInArray(playerInjuries.playerId, matchedIds)))
          .returning({ id: playerInjuries.id })
      : [];

  return { matched, cleared: cleared.length, unmatched, unmatchedTeamSlugs: [...unmatchedTeamSlugs], unmappedStatuses };
}
