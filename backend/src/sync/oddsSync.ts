import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { games, gameOdds, teams } from "../db/schema.js";
import { matchTeam } from "./oddsTeamMap.js";

// Plain REST/JSON API — no SDK, unlike euroleague-api (see CLAUDE.md's
// two-sync-paths note) — https://the-odds-api.com. Skipped entirely
// (returns a zeroed result rather than throwing) when ODDS_API_KEY isn't
// set, so odds-weighted scoring degrades to the flat rate everywhere it's
// used (services/points.ts's pointsForCorrectPick) rather than this job
// ever blocking anything.
const ODDS_API_BASE_URL = "https://api.the-odds-api.com/v4";
// Confirmed against a live GET /v4/sports/?apiKey=KEY call (2026-08-31).
const SPORT_KEY = process.env.ODDS_API_SPORT_KEY ?? "basketball_euroleague";

// Only games tipping off soon get a snapshot request — odds firm up closer
// to tipoff anyway, and this job only ever needs ONE successful capture per
// game (see game_odds' "inserted once, never updated" schema comment), so
// there's no benefit to fetching a game a week out just to capture it
// again later; scoped tightly to keep free-tier request usage low.
const SYNC_WINDOW_HOURS = 72;
// Two games claiming the same odds-API event only get matched together if
// their real tipoffAt and the odds API's own commence_time land within
// this many hours of each other — a same-day+ guard against a rare same-
// matchup rematch elsewhere in the schedule being mismatched.
const MAX_TIPOFF_DRIFT_HOURS = 24;

interface OddsApiOutcome {
  name: string;
  price: number; // decimal odds
}

interface OddsApiMarket {
  key: string; // "h2h" = moneyline/head-to-head
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key: string;
  markets: OddsApiMarket[];
}

interface OddsApiEvent {
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

export interface OddsSyncResult {
  gamesMatched: number;
  gamesSkipped: number;
  unmatchedTeamNames: string[];
}

const NO_OP_RESULT: OddsSyncResult = { gamesMatched: 0, gamesSkipped: 0, unmatchedTeamNames: [] };

/**
 * Decimal odds -> a de-vigged (bookmaker-margin-removed) implied home-win
 * probability, averaged across every bookmaker that carries an h2h market
 * for this event. Returns null if no bookmaker has usable odds for both
 * sides — that game is skipped this run, not scored at 50/50.
 */
function fairHomeProbability(event: OddsApiEvent): { homeFairProb: number; bookmakerCount: number } | null {
  const fairProbs: number[] = [];
  for (const bookmaker of event.bookmakers) {
    const h2h = bookmaker.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;
    const home = h2h.outcomes.find((o) => o.name === event.home_team);
    const away = h2h.outcomes.find((o) => o.name === event.away_team);
    if (!home || !away || home.price <= 1 || away.price <= 1) continue;

    const impliedHome = 1 / home.price;
    const impliedAway = 1 / away.price;
    fairProbs.push(impliedHome / (impliedHome + impliedAway));
  }

  if (fairProbs.length === 0) return null;
  return {
    homeFairProb: fairProbs.reduce((sum, p) => sum + p, 0) / fairProbs.length,
    bookmakerCount: fairProbs.length,
  };
}

export async function syncOdds(): Promise<OddsSyncResult> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return NO_OP_RESULT;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + SYNC_WINDOW_HOURS * 60 * 60 * 1000);

  const pending = await db
    .select({ id: games.id, tipoffAt: games.tipoffAt, homeTeamId: games.homeTeamId, awayTeamId: games.awayTeamId })
    .from(games)
    .leftJoin(gameOdds, eq(gameOdds.gameId, games.id))
    .where(
      and(eq(games.status, "scheduled"), gte(games.tipoffAt, now), lte(games.tipoffAt, windowEnd), isNull(gameOdds.id))
    );

  if (pending.length === 0) return NO_OP_RESULT;

  const ourTeams = await db.select({ id: teams.id, code: teams.code, name: teams.name }).from(teams);
  const teamById = new Map(ourTeams.map((t) => [t.id, t]));

  const url = `${ODDS_API_BASE_URL}/sports/${SPORT_KEY}/odds/?apiKey=${apiKey}&regions=eu&markets=h2h&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`The Odds API request failed: ${res.status} ${await res.text()}`);
  }
  const events = (await res.json()) as OddsApiEvent[];

  let gamesMatched = 0;
  let gamesSkipped = 0;
  const toInsert: { gameId: string; homeFairProb: number; awayFairProb: number; bookmakerCount: number }[] = [];

  for (const game of pending) {
    const home = teamById.get(game.homeTeamId);
    const away = teamById.get(game.awayTeamId);
    if (!home || !away) {
      gamesSkipped++;
      continue;
    }

    const event = events.find((e) => {
      const eventHome = matchTeam(e.home_team, ourTeams);
      const eventAway = matchTeam(e.away_team, ourTeams);
      if (eventHome?.id !== home.id || eventAway?.id !== away.id) return false;
      const driftHours = Math.abs(new Date(e.commence_time).getTime() - new Date(game.tipoffAt).getTime()) / 3_600_000;
      return driftHours < MAX_TIPOFF_DRIFT_HOURS;
    });

    if (!event) {
      gamesSkipped++;
      continue;
    }

    const fair = fairHomeProbability(event);
    if (!fair) {
      gamesSkipped++;
      continue;
    }

    toInsert.push({
      gameId: game.id,
      homeFairProb: fair.homeFairProb,
      awayFairProb: 1 - fair.homeFairProb,
      bookmakerCount: fair.bookmakerCount,
    });
    gamesMatched++;
  }

  // Any odds-API event team that doesn't match ANY of our teams at all —
  // not just for a pending game — surfaced so oddsTeamMap.ts's override
  // map can be extended. Logged by the caller, not thrown: a bad match
  // just means fewer games get a snapshot this run, never a broken sync.
  const unmatchedTeamNames = new Set<string>();
  for (const event of events) {
    if (!matchTeam(event.home_team, ourTeams)) unmatchedTeamNames.add(event.home_team);
    if (!matchTeam(event.away_team, ourTeams)) unmatchedTeamNames.add(event.away_team);
  }

  if (toInsert.length > 0) {
    // onConflictDoNothing as a safety net against two overlapping sync
    // runs both matching the same game — the isNull(gameOdds.id) filter
    // above already avoids this in the common case, but doesn't fully
    // close the race.
    await db.insert(gameOdds).values(toInsert).onConflictDoNothing({ target: gameOdds.gameId });
  }

  return { gamesMatched, gamesSkipped, unmatchedTeamNames: [...unmatchedTeamNames] };
}
