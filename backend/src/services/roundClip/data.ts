import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { getRoundStandings } from "../roundStandings.js";
import { imageToDataUri } from "./images.js";
import { clipAlias, clipTeamNames, clipUsername, type Alias, type AliasTitle } from "./teams.js";
import { pickBoldCall, pickHook, pickPulls, pullWindow, type GamePickStats, type PullCandidate } from "./select.js";

// Everything one round clip shows (docs/superpowers/specs/2026-10-15-round-clip-design.md).
// Admins are left out of every number. A featured person is named by
// username only when they allow it (users.feature_in_clips) and have chosen
// one; otherwise by alias. User ids never leave this file.

export interface ClipTeam {
  code: string;
  name: { en: string; el: string };
  color: string | null;
  logo: string | null;
}

export interface RoundClipData {
  season: string;
  round: number;
  results: { home: ClipTeam; away: ClipTeam; homeScore: number; awayScore: number }[];
  hook: { winner: ClipTeam; loser: ClipTeam; score: string; pickedLoserPct: number | null } | null;
  topPredictor: { person: ClipPerson; correct: number; total: number; points: number } | null;
  boldCall: { winner: ClipTeam; loser: ClipTeam; score: string; correctPct: number; person: ClipPerson } | null;
  /** Best first, up to three people (empty: the payoff shows a generic card). */
  pulls: { name: string; photo: string | null; tier: "legendary" | "rare"; foil: boolean; person: ClipPerson }[];
  next: { round: number; picksOpen: boolean } | null;
}

/** Who a scene features: a title ("The Oracle"), the username when allowed, else the alias. */
export interface ClipPerson {
  title: Alias;
  username: string | null;
  alias: Alias;
}

export class RoundNotFinalError extends Error {}

type Row = Record<string, any>;

function person(title: AliasTitle, row: Row): ClipPerson {
  return {
    title: clipAlias(title, null),
    username: clipUsername(row.username, row.feature_in_clips),
    alias: clipAlias(title, row.fav ?? null),
  };
}

/** Rounds of `season` whose games are all final, newest first. */
export async function listFinishedRounds(season: string): Promise<number[]> {
  const rows = (await db.execute(sql`
    select round from games where season = ${season} and round is not null
    group by round having bool_and(status = 'final') order by round desc
  `)) as unknown as Row[];
  return rows.map((r) => Number(r.round));
}

export async function buildRoundClip(season: string, round: number): Promise<RoundClipData> {
  // Games, per-game pick counts (non-admins), odds, both teams, and the
  // round's neighbours (pull window start, next round) in one statement.
  const games = (await db.execute(sql`
    select g.id, g.status, g.home_score, g.away_score, g.tipoff_at, g.home_team_id, g.away_team_id,
      ht.code as h_code, ht.name as h_name, ht.primary_color as h_color, ht.logo_url as h_logo,
      at.code as a_code, at.name as a_name, at.primary_color as a_color, at.logo_url as a_logo,
      go.home_fair_prob,
      (select count(*) from predictions p join users u on u.id = p.user_id
        where p.game_id = g.id and not u.is_admin)::int as picks,
      (select count(*) from predictions p join users u on u.id = p.user_id
        where p.game_id = g.id and not u.is_admin and p.predicted_winner_team_id = g.home_team_id)::int as picked_home,
      (select max(tipoff_at) from games where season = ${season} and round = ${round - 1}) as prev_last,
      (select min(round) from games where season = ${season} and round > ${round}) as next_round,
      (select bool_or(status = 'scheduled' and tipoff_at > now()) from games
        where season = ${season} and round = (select min(round) from games where season = ${season} and round > ${round})) as next_open
    from games g
    join teams ht on ht.id = g.home_team_id
    join teams at on at.id = g.away_team_id
    left join game_odds go on go.game_id = g.id
    where g.season = ${season} and g.round = ${round}
    order by g.tipoff_at
  `)) as unknown as Row[];
  if (games.length === 0 || games.some((g) => g.status !== "final" || g.home_score === null || g.away_score === null)) {
    throw new RoundNotFinalError(`Round ${round} still has games to play`);
  }

  const teamOf = async (g: Row, side: "h" | "a"): Promise<ClipTeam> => ({
    code: g[`${side}_code`],
    name: clipTeamNames(g[`${side}_code`], g[`${side}_name`]),
    color: g[`${side}_color`] ?? null,
    logo: await imageToDataUri(g[`${side}_logo`] ?? null),
  });
  const teams = await Promise.all(games.map(async (g) => ({ home: await teamOf(g, "h"), away: await teamOf(g, "a") })));
  const byId = new Map(games.map((g, i) => [g.id as string, { row: g, ...teams[i] }]));
  const sides = (gameId: string) => {
    const { row, home, away } = byId.get(gameId)!;
    const homeWon = row.home_score > row.away_score;
    const [w, l] = homeWon ? [row.home_score, row.away_score] : [row.away_score, row.home_score];
    return { winner: homeWon ? home : away, loser: homeWon ? away : home, winnerTeamId: homeWon ? row.home_team_id : row.away_team_id, score: `${w}–${l}` };
  };

  const stats: GamePickStats[] = games.map((g) => ({
    gameId: g.id,
    homeTeamId: g.home_team_id,
    awayTeamId: g.away_team_id,
    homeScore: g.home_score,
    awayScore: g.away_score,
    tipoffAt: new Date(g.tipoff_at),
    picks: g.picks,
    pickedHome: g.picked_home,
    homeFairProb: g.home_fair_prob ?? null,
  }));
  const hookPick = pickHook(stats);
  const boldPick = pickBoldCall(stats, hookPick?.gameId ?? null);

  const { start: windowStart, end: windowEnd } = pullWindow(
    games[0].prev_last ? new Date(games[0].prev_last) : null,
    new Date(games[0].tipoff_at),
    new Date(games[games.length - 1].tipoff_at)
  );
  const boldWinnerId = boldPick ? sides(boldPick.gameId).winnerTeamId : null;

  const [standings, pullRows, boldRows] = await Promise.all([
    getRoundStandings(season, round),
    db.execute(sql`
      select uc.user_id, c.name, c.image_url, c.tier, uc.finish, uc.unlocked_at, ft.code as fav, u.username, u.feature_in_clips
      from user_collectibles uc
      join collectibles c on c.id = uc.collectible_id
      join users u on u.id = uc.user_id and not u.is_admin
      left join teams ft on ft.id = u.favorite_team_id
      where c.tier in ('legendary', 'rare')
        and uc.unlocked_at > ${windowStart.toISOString()}::timestamptz and uc.unlocked_at <= ${windowEnd.toISOString()}::timestamptz
    `) as unknown as Promise<Row[]>,
    boldPick
      ? (db.execute(sql`
          select p.user_id, ft.code as fav, u.username, u.feature_in_clips
          from predictions p
          join users u on u.id = p.user_id and not u.is_admin
          left join teams ft on ft.id = u.favorite_team_id
          where p.game_id = ${boldPick.gameId} and p.predicted_winner_team_id = ${boldWinnerId}
        `) as unknown as Promise<Row[]>)
      : Promise.resolve([] as Row[]),
  ]);

  const top = standings[0] && standings[0].total > 0 ? standings[0] : null;
  const topUser = top
    ? (((await db.execute(sql`
        select ft.code as fav, u.username, u.feature_in_clips
        from users u left join teams ft on ft.id = u.favorite_team_id where u.id = ${top.userId}
      `)) as unknown as Row[])[0] ?? null)
    : null;

  // The bold call's featured picker: the one ranked highest this round.
  const rank = new Map(standings.map((s, i) => [s.userId, i]));
  const boldPicker = [...boldRows].sort((a, b) => (rank.get(a.user_id) ?? Infinity) - (rank.get(b.user_id) ?? Infinity))[0];

  type Candidate = PullCandidate & { fav: string | null; username: string; feature_in_clips: boolean };
  const candidates: Candidate[] = pullRows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    imageUrl: r.image_url ?? null,
    tier: r.tier,
    finish: r.finish,
    unlockedAt: new Date(r.unlocked_at),
    fav: r.fav ?? null,
    username: r.username,
    feature_in_clips: r.feature_in_clips,
  }));
  const pulls = pickPulls(candidates) as Candidate[];
  const pullPhotos = await Promise.all(pulls.map((p) => imageToDataUri(p.imageUrl)));

  const nextRound = games[0].next_round === null ? null : Number(games[0].next_round);
  return {
    season,
    round,
    results: games.map((g, i) => ({ home: teams[i].home, away: teams[i].away, homeScore: g.home_score, awayScore: g.away_score })),
    hook: hookPick ? (({ winner, loser, score }) => ({ winner, loser, score, pickedLoserPct: hookPick.pickedLoserPct }))(sides(hookPick.gameId)) : null,
    topPredictor: top && topUser ? { person: person("oracle", topUser), correct: top.correct, total: top.total, points: top.points } : null,
    boldCall:
      boldPick && boldPicker
        ? (({ winner, loser, score }) => ({ winner, loser, score, correctPct: boldPick.correctPct, person: person("loneWolf", boldPicker) }))(
            sides(boldPick.gameId)
          )
        : null,
    pulls: pulls.map((p, i) => ({
      name: p.name,
      photo: pullPhotos[i],
      tier: p.tier === "legendary" ? "legendary" : "rare",
      foil: p.tier === "legendary" && p.finish === "foil",
      person: person("goldenHands", p),
    })),
    next: nextRound === null ? null : { round: nextRound, picksOpen: games[0].next_open === true },
  };
}
