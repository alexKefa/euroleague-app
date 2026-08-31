// Matches a team-name string from The Odds API against this app's own
// `teams` table. The odds API's exact naming (e.g. "Real Madrid" vs. our
// "Real Madrid CF") isn't knowable until oddsSync.ts is actually run
// against a real API key/response — normalization + substring matching
// covers most cases, and TEAM_NAME_OVERRIDES is the escape hatch for any
// odds-API string that doesn't normalize close enough on its own.
// oddsSync.ts logs any odds-API event team it couldn't match to any of our
// 20-ish teams, which is the signal to add an entry here.

// "<exact string from The Odds API>": "<our teams.code>" — populated
// 2026-08-31 from a real GET /v4/sports/basketball_euroleague/odds/
// response (round 1 of the real 2026-27 season, the only round the API
// had live odds for at the time). Substring matching alone missed roughly
// half of these — EuroLeague's own team names are heavy with sponsor
// names ("Fenerbahce Beko Istanbul", "Partizan Mozzart Bet Belgrade",
// "Maccabi Rapyd Tel Aviv") that the odds API drops or spells differently
// ("Fenerbahce SK", "KK Partizan NIS", "Maccabi Tel Aviv"), so neither
// string ends up a substring of the other. Re-check this list if a future
// sync run logs new unmatched names — sponsors change season to season.
const TEAM_NAME_OVERRIDES: Record<string, string> = {
  "Hapoel Tel Aviv": "HTA",
  "FC Bayern München": "MUN",
  "KK Crvena zvezda": "RED",
  "Saski Baskonia": "BAS",
  "ASVEL Lyon Villeurbanne": "ASV",
  "Maccabi Tel Aviv": "TEL",
  "Beşiktaş J.K.": "BES",
  "Fenerbahce SK": "ULK",
  "Virtus Segafredo Bologna": "VIR",
  "KK Partizan NIS": "PAR",
  "Pallacanestro Olimpia Milano": "MIL",
};

// Unicode combining diacritical marks block (U+0300-U+036F) — built from
// code points rather than a regex literal so accented characters in this
// file's own source encoding can't silently corrupt the range.
const COMBINING_MARKS_START = 0x0300;
const COMBINING_MARKS_END = 0x036f;

function stripDiacritics(value: string): string {
  return Array.from(value.normalize("NFD"))
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      return code < COMBINING_MARKS_START || code > COMBINING_MARKS_END;
    })
    .join("");
}

interface TeamRow {
  id: string;
  code: string;
  name: string;
}

function normalize(name: string): string {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function matchTeam(apiName: string, ourTeams: TeamRow[]): TeamRow | null {
  const overrideCode = TEAM_NAME_OVERRIDES[apiName];
  if (overrideCode) {
    const overridden = ourTeams.find((t) => t.code === overrideCode);
    if (overridden) return overridden;
  }

  const normalizedApi = normalize(apiName);
  if (!normalizedApi) return null;

  for (const team of ourTeams) {
    const normalizedOurs = normalize(team.name);
    if (normalizedOurs && (normalizedApi.includes(normalizedOurs) || normalizedOurs.includes(normalizedApi))) {
      return team;
    }
  }
  return null;
}
