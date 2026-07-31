/**
 * Thin wrapper around EuroLeague's public JSON feed.
 *
 * The feed isn't officially documented for third parties — this mirrors
 * what the `euroleague_api` Python package and euroleaguebasketball.net's
 * own site call under the hood. Endpoint paths are centralized in
 * `ENDPOINTS` below: if any of these have drifted, this is the only
 * place you need to fix it.
 *
 * Verify against https://api-live.euroleague.net/swagger/index.html
 * (open in a browser — it's a JS-rendered Swagger UI) if a call 404s.
 */

const BASE_URL = process.env.EUROLEAGUE_API_BASE_URL ?? "https://live.euroleague.net/api";
const COMPETITION_CODE = process.env.EUROLEAGUE_COMPETITION_CODE ?? "E"; // "E" = EuroLeague, "U" = EuroCup

const ENDPOINTS = {
  standings: "Standings",
  schedule: "Schedule",
  boxscore: "Boxscore",
};

export interface EuroLeagueStandingRow {
  club: { code: string; name: string; city?: string };
  gamesPlayed: number;
  win: number;
  loss: number;
  pointsFavour: number;
  pointsAgainst: number;
  position: number;
}

export interface EuroLeagueGameRow {
  gameCode: number;
  round: number;
  date: string; // ISO-ish string from the feed
  homeClubCode: string;
  awayClubCode: string;
  homeScore: number | null;
  awayScore: number | null;
  played: boolean;
}

export interface EuroLeagueBoxscorePlayer {
  playerCode: string;
  name: string;
  points: number;
  totalRebounds: number;
  assistances: number;
  minutes: string; // "MM:SS" in the raw feed
  valuation: number; // PIR
}

function seasonCode(season: number): string {
  // e.g. season=2025 -> "E2025" for the 2025-26 EuroLeague season
  return `${COMPETITION_CODE}${season}`;
}

async function getJson<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`EuroLeague feed request failed: ${res.status} ${res.statusText} (${url})`);
  }

  return res.json() as Promise<T>;
}

export function getStandings(season: number) {
  return getJson<EuroLeagueStandingRow[]>(ENDPOINTS.standings, {
    seasoncode: seasonCode(season),
  });
}

export function getSchedule(season: number) {
  return getJson<EuroLeagueGameRow[]>(ENDPOINTS.schedule, {
    seasoncode: seasonCode(season),
  });
}

export function getBoxscore(season: number, gameCode: number) {
  return getJson<{ home: EuroLeagueBoxscorePlayer[]; away: EuroLeagueBoxscorePlayer[] }>(
    ENDPOINTS.boxscore,
    { seasoncode: seasonCode(season), gamecode: gameCode }
  );
}
