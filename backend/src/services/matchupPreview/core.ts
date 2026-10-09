// Matchup preview (2026-10-09) — pure computation, no database. The DB
// layer (./index.ts) loads rows and hands them here; checked by
// scripts/check-matchup-preview.ts. See
// docs/superpowers/specs/2026-10-09-matchup-preview-design.md.

export type InjuryStatus = "out" | "doubtful" | "questionable" | "probable";

export interface TeamRef {
  id: string;
  code: string;
  name: string;
  primaryColor: string | null;
  logoUrl: string | null;
}

export interface FinalGameRow {
  id: string;
  season: string;
  tipoffAt: Date;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
}

export interface FormGame {
  gameId: string;
  tipoffAt: string;
  opponent: TeamRef;
  isHome: boolean;
  teamScore: number;
  opponentScore: number;
  won: boolean;
}

export interface TeamForm {
  games: FormGame[]; // newest first
  streak: string | null; // "W3" / "L1"
}

export interface H2HGame {
  gameId: string;
  tipoffAt: string;
  homeTeamId: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId: string;
}

export interface H2H {
  games: H2HGame[]; // newest first
  homeWins: number; // from this game's home team's perspective
  awayWins: number;
}

export interface InjuredPlayer {
  playerId: string;
  name: string;
  photoUrl: string | null;
  status: InjuryStatus;
  note: string | null;
  noteEl: string | null;
}

export type EdgeKey = "offRating" | "defRating" | "threePct" | "rebPg" | "astPg" | "tovPg";

export interface EdgeRow {
  key: EdgeKey;
  home: number | null;
  away: number | null;
  better: "home" | "away" | "even" | null;
}

export interface DuelPlayer {
  playerId: string;
  name: string;
  photoUrl: string | null;
  position: string;
  games: number;
  pts: number;
  reb: number;
  ast: number;
  pir: number;
}

export interface TeamAvailability {
  injured: InjuredPlayer[];
  restDays: number | null;
  shortRest: boolean;
}

export interface MatchupPreview {
  available: true;
  statsSeason: string;
  usingPriorSeason: boolean;
  form: { home: TeamForm; away: TeamForm };
  h2h: H2H;
  availability: { home: TeamAvailability; away: TeamAvailability };
  edges: EdgeRow[];
  keyBattle: { position: string; home: DuelPlayer; away: DuelPlayer } | null;
}

export interface PreviewStrip {
  home: { form: ("W" | "L")[]; injuries: number };
  away: { form: ("W" | "L")[]; injuries: number };
  h2h: { homeWins: number; awayWins: number } | null;
}

export interface TeamStatLine {
  offRating: number | null;
  defRating: number | null;
  threePct: number | null;
  rebPg: number | null;
  astPg: number | null;
  tovPg: number | null;
}

export type PlayerAvg = DuelPlayer & { teamId: string; injuryStatus: InjuryStatus | null };

/** Not tipped off yet: status still scheduled and tipoff in the future. */
export function isUpcoming(game: { status: string; tipoffAt: Date | string }, now = Date.now()): boolean {
  return game.status === "scheduled" && new Date(game.tipoffAt).getTime() > now;
}

const involves = (g: FinalGameRow, teamId: string) => g.homeTeamId === teamId || g.awayTeamId === teamId;
const newestFirst = (a: FinalGameRow, b: FinalGameRow) => b.tipoffAt.getTime() - a.tipoffAt.getTime();
const winnerOf = (g: FinalGameRow) => (g.homeScore > g.awayScore ? g.homeTeamId : g.awayTeamId);

export function buildTeamForm(teamId: string, seasonGames: FinalGameRow[], teamsById: Map<string, TeamRef>, limit = 5): TeamForm {
  const mine = seasonGames.filter((g) => involves(g, teamId)).sort(newestFirst);
  const results = mine.map((g) => winnerOf(g) === teamId);

  let streak: string | null = null;
  if (results.length > 0) {
    let n = 0;
    while (n < results.length && results[n] === results[0]) n++;
    streak = `${results[0] ? "W" : "L"}${n}`;
  }

  const games = mine.slice(0, limit).map((g, i): FormGame => {
    const isHome = g.homeTeamId === teamId;
    const opponentId = isHome ? g.awayTeamId : g.homeTeamId;
    return {
      gameId: g.id,
      tipoffAt: g.tipoffAt.toISOString(),
      opponent: teamsById.get(opponentId) ?? { id: opponentId, code: "", name: "", primaryColor: null, logoUrl: null },
      isHome,
      teamScore: isHome ? g.homeScore : g.awayScore,
      opponentScore: isHome ? g.awayScore : g.homeScore,
      won: results[i],
    };
  });
  return { games, streak };
}

export function buildH2H(homeId: string, awayId: string, games: FinalGameRow[], limit = 5): H2H {
  const meetings = games.filter((g) => involves(g, homeId) && involves(g, awayId)).sort(newestFirst).slice(0, limit);
  let homeWins = 0;
  let awayWins = 0;
  const out = meetings.map((g): H2HGame => {
    const winnerTeamId = winnerOf(g);
    if (winnerTeamId === homeId) homeWins++;
    else awayWins++;
    return { gameId: g.id, tipoffAt: g.tipoffAt.toISOString(), homeTeamId: g.homeTeamId, homeScore: g.homeScore, awayScore: g.awayScore, winnerTeamId };
  });
  return { games: out, homeWins, awayWins };
}

const athensDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" });

/** Calendar days between two instants, counted in Europe/Athens. */
export function athensDayDiff(from: Date, to: Date): number {
  const utcMidnight = (d: Date) => Date.parse(`${athensDay.format(d)}T00:00:00Z`);
  return Math.round((utcMidnight(to) - utcMidnight(from)) / 86_400_000);
}

export function restDays(teamId: string, seasonGames: FinalGameRow[], tipoff: Date): number | null {
  const prev = seasonGames
    .filter((g) => involves(g, teamId) && g.tipoffAt.getTime() < tipoff.getTime())
    .sort(newestFirst)[0];
  return prev ? athensDayDiff(prev.tipoffAt, tipoff) : null;
}

export function ratio(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

const EDGE_KEYS: EdgeKey[] = ["offRating", "defRating", "threePct", "rebPg", "astPg", "tovPg"];
const LOWER_IS_BETTER = new Set<EdgeKey>(["defRating", "tovPg"]);

export function buildEdges(home: TeamStatLine, away: TeamStatLine): EdgeRow[] {
  return EDGE_KEYS.map((key) => {
    const h = home[key];
    const a = away[key];
    let better: EdgeRow["better"] = null;
    if (h !== null && a !== null && Number.isFinite(h) && Number.isFinite(a)) {
      if (h === a) better = "even";
      else better = (h > a) !== LOWER_IS_BETTER.has(key) ? "home" : "away";
    }
    return { key, home: h, away: a, better };
  });
}

const POSITIONS = ["Guard", "Forward", "Center"] as const;
const MIN_DUEL_GAMES = 2;

export function pickKeyBattle(homeId: string, awayId: string, players: PlayerAvg[]): MatchupPreview["keyBattle"] {
  const eligible = players.filter((p) => p.injuryStatus !== "out" && p.games >= MIN_DUEL_GAMES);
  const best = (teamId: string, position: string) =>
    eligible.filter((p) => p.teamId === teamId && p.position === position).sort((a, b) => b.pir - a.pir)[0];

  let pick: MatchupPreview["keyBattle"] = null;
  let bestSum = -Infinity;
  for (const position of POSITIONS) {
    const h = best(homeId, position);
    const a = best(awayId, position);
    if (!h || !a || h.pir + a.pir <= bestSum) continue;
    bestSum = h.pir + a.pir;
    const strip = ({ teamId: _t, injuryStatus: _i, ...rest }: PlayerAvg): DuelPlayer => rest;
    pick = { position, home: strip(h), away: strip(a) };
  }
  return pick;
}

export function toStrip(
  form: { home: TeamForm; away: TeamForm },
  h2h: { homeWins: number; awayWins: number; games: unknown[] },
  injuries: { home: number; away: number }
): PreviewStrip {
  const dots = (f: TeamForm) => f.games.map((g) => (g.won ? "W" : "L") as "W" | "L").reverse();
  return {
    home: { form: dots(form.home), injuries: injuries.home },
    away: { form: dots(form.away), injuries: injuries.away },
    h2h: h2h.games.length > 0 ? { homeWins: h2h.homeWins, awayWins: h2h.awayWins } : null,
  };
}
