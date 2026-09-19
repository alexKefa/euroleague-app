// basketnews.com's own kebab-case team slugs (the EuroLeague injury
// report's <tr id="..."> team-header rows and its team <select>'s <option
// value="...">) -> this app's teams.code. Confirmed directly against a
// live fetch of https://basketnews.com/news-212393-euroleague-injury-report-updated.html
// (2026-09-19) — all 20 teams currently in the competition (this app's own
// `teams` table also has AS Monaco, out for 2026-27, which basketnews'
// list doesn't carry either). Manual, same "no algorithmic match, this is
// the ground truth from a real response" reasoning as oddsTeamMap.ts —
// re-check if injurySync.ts ever logs a slug not in this map (e.g. a team
// re-entering the competition in a future season).
export const BASKETNEWS_TEAM_SLUGS: Record<string, string> = {
  "anadolu-efes-istanbul": "IST",
  "armani-olimpia-milan": "MIL",
  "besiktas-istanbul": "BES",
  "crvena-zvezda-meridianbet-belgrade": "RED",
  "dubai-basketball": "DUB",
  "fc-bayern-munich": "MUN",
  "fc-barcelona": "BAR",
  "fenerbahce-beko-istanbul": "ULK",
  "hapoel-ibi-tel-aviv": "HTA",
  "kosner-baskonia-vitoria-gasteiz": "BAS",
  "ldlc-asvel-villeurbanne": "ASV",
  "maccabi-rapyd-tel-aviv": "TEL",
  "olympiacos-piraeus": "OLY",
  "panathinaikos-aktor-athens": "PAN",
  "paris-basketball": "PRS",
  "partizan-mozzart-bet-belgrade": "PAR",
  "real-madrid": "MAD",
  "valencia-basket": "PAM",
  "virtus-bologna": "VIR",
  "zalgiris-kaunas": "ZAL",
};
