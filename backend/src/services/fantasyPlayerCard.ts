import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { computeFantasyGamePoints, FANTASY_MIN_PRICE, getDefaultRound } from "./fantasyScoring.js";

/**
 * Everything the Fantasy player card shows (2026-10-01, modelled on
 * EuroLeague Fantasy's own player sheet): price, fantasy-points average,
 * season credit change, how many squads own the player, the next 5 games,
 * and a per-game log (price at the time, the move, fantasy points, box
 * score). Four statements; the per-game fantasy points use the same
 * computeFantasyGamePoints as scoring and pricing.
 */
export interface FantasyPlayerCard {
  player: { id: string; name: string; position: string | null; photoUrl: string | null };
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null } | null;
  price: number;
  seasonCreditChange: number;
  fantasyPointsAverage: number | null;
  ownedPct: number | null;
  nextGames: { tipoffAt: string; isHome: boolean; opponent: { code: string; logoUrl: string | null } }[];
  games: FantasyPlayerCardGame[];
}

export interface FantasyPlayerCardGame {
  gameId: string;
  round: number | null;
  tipoffAt: string;
  isHome: boolean;
  opponent: { code: string; logoUrl: string | null };
  teamScore: number | null;
  opponentScore: number | null;
  played: boolean;
  // Price going into the game, and the move it caused (null = not priced yet).
  priceBefore: number;
  priceChange: number | null;
  fantasyPoints: number | null;
  minutes: number | null;
  isStarter: boolean | null;
  stats: Record<string, number | null> | null;
}

type Row = Record<string, any>;

const r1 = (n: number) => Math.round(n * 10) / 10;

export async function getFantasyPlayerCard(playerId: string, season: string): Promise<FantasyPlayerCard | null> {
  const openRound = await getDefaultRound(season);

  const [head] = (await db.execute<Row>(sql`
    select p.id, p.name, p.position, p.photo_url, p.team_id,
      t.code as team_code, t.name as team_name, t.primary_color, t.logo_url,
      f.price,
      (select coalesce(sum(l.applied_delta), 0) from fantasy_price_change_log l join games g on g.id = l.game_id
        where l.player_id = p.id and g.season = ${season}) as season_change,
      (select count(distinct fl.user_id) from fantasy_lineups fl join users u on u.id = fl.user_id
        where fl.season = ${season} and fl.round = ${openRound ?? -1} and not u.is_admin) as squads,
      (select count(distinct fl.user_id) from fantasy_lineups fl join users u on u.id = fl.user_id
        where fl.season = ${season} and fl.round = ${openRound ?? -1} and not u.is_admin and fl.player_id = p.id) as owners
    from players p
    left join teams t on t.id = p.team_id
    left join player_fantasy_prices f on f.player_id = p.id and f.season = ${season}
    where p.id = ${playerId}
  `)) as Row[];
  if (!head) return null;
  const teamId: string | null = head.team_id;

  const [logRows, nextRows] = await Promise.all([
    db.execute<Row>(sql`
      select g.id, g.round, g.tipoff_at, g.home_team_id, g.away_team_id, g.home_score, g.away_score,
        ht.code as home_code, ht.logo_url as home_logo, at.code as away_code, at.logo_url as away_logo,
        pgs.player_id is not null as has_row, pgs.is_starter, pgs.minutes, pgs.points, pgs.rebounds,
        pgs.offensive_rebounds, pgs.defensive_rebounds, pgs.assists, pgs.steals, pgs.turnovers,
        pgs.blocks_favour, pgs.blocks_against, pgs.fouls_committed, pgs.fouls_received,
        pgs.field_goals_made_2, pgs.field_goals_attempted_2, pgs.field_goals_made_3, pgs.field_goals_attempted_3,
        pgs.free_throws_made, pgs.free_throws_attempted, pgs.valuation, pgs.plus_minus,
        l.applied_delta
      from games g
      join teams ht on ht.id = g.home_team_id
      join teams at on at.id = g.away_team_id
      left join player_game_stats pgs on pgs.game_id = g.id and pgs.player_id = ${playerId}
      left join fantasy_price_change_log l on l.game_id = g.id and l.player_id = ${playerId}
      where g.season = ${season} and g.status = 'final'
        and (pgs.player_id is not null or ${teamId}::uuid in (g.home_team_id, g.away_team_id))
      order by g.tipoff_at desc
    `),
    teamId
      ? db.execute<Row>(sql`
          select g.tipoff_at, g.home_team_id, ht.code as home_code, ht.logo_url as home_logo, at.code as away_code, at.logo_url as away_logo
          from games g
          join teams ht on ht.id = g.home_team_id
          join teams at on at.id = g.away_team_id
          where g.season = ${season} and g.status <> 'final' and ${teamId}::uuid in (g.home_team_id, g.away_team_id)
          order by g.tipoff_at
          limit 5
        `)
      : Promise.resolve([] as Row[]),
  ]);

  const price = head.price === null ? FANTASY_MIN_PRICE : Number(head.price);

  // Walk newest -> oldest: each game's price going in is the price after it
  // minus the move it caused.
  let priceAfter = price;
  const games: FantasyPlayerCardGame[] = (logRows as Row[]).map((g) => {
    // The player's current team decides the side; a player who has since
    // moved clubs keeps the home side for games his current team wasn't in.
    const isHome = teamId === null ? true : g.away_team_id !== teamId;
    const teamScore = isHome ? g.home_score : g.away_score;
    const opponentScore = isHome ? g.away_score : g.home_score;
    const played = g.has_row && ((g.minutes ?? 0) > 0 || [g.points, g.rebounds, g.assists, g.turnovers, g.fouls_committed].some((v) => (v ?? 0) !== 0));
    const move = g.applied_delta === null ? null : r1(Number(g.applied_delta));
    const priceBefore = r1(priceAfter - (move ?? 0));
    priceAfter = priceBefore;
    const won = teamScore !== null && opponentScore !== null ? teamScore > opponentScore : false;
    return {
      gameId: g.id,
      round: g.round,
      tipoffAt: new Date(g.tipoff_at).toISOString(),
      isHome,
      opponent: isHome ? { code: g.away_code, logoUrl: g.away_logo } : { code: g.home_code, logoUrl: g.home_logo },
      teamScore,
      opponentScore,
      played,
      priceBefore,
      priceChange: move,
      fantasyPoints: played
        ? r1(
            computeFantasyGamePoints(
              {
                points: g.points,
                rebounds: g.rebounds,
                assists: g.assists,
                steals: g.steals,
                turnovers: g.turnovers,
                blocksFavour: g.blocks_favour,
                blocksAgainst: g.blocks_against,
                foulsCommitted: g.fouls_committed,
                foulsReceived: g.fouls_received,
                fieldGoalsMade2: g.field_goals_made_2,
                fieldGoalsAttempted2: g.field_goals_attempted_2,
                fieldGoalsMade3: g.field_goals_made_3,
                fieldGoalsAttempted3: g.field_goals_attempted_3,
                freeThrowsMade: g.free_throws_made,
                freeThrowsAttempted: g.free_throws_attempted,
              },
              won
            )
          )
        : null,
      minutes: g.minutes === null ? null : Number(g.minutes),
      isStarter: g.is_starter,
      stats: g.has_row
        ? {
            points: g.points,
            rebounds: g.rebounds,
            offensiveRebounds: g.offensive_rebounds,
            defensiveRebounds: g.defensive_rebounds,
            assists: g.assists,
            steals: g.steals,
            turnovers: g.turnovers,
            blocksFavour: g.blocks_favour,
            blocksAgainst: g.blocks_against,
            foulsCommitted: g.fouls_committed,
            foulsReceived: g.fouls_received,
            fieldGoalsMade2: g.field_goals_made_2,
            fieldGoalsAttempted2: g.field_goals_attempted_2,
            fieldGoalsMade3: g.field_goals_made_3,
            fieldGoalsAttempted3: g.field_goals_attempted_3,
            freeThrowsMade: g.free_throws_made,
            freeThrowsAttempted: g.free_throws_attempted,
            valuation: g.valuation,
            plusMinus: g.plus_minus,
          }
        : null,
    };
  });

  const playedPoints = games.filter((g) => g.fantasyPoints !== null).map((g) => g.fantasyPoints!);
  const squads = Number(head.squads ?? 0);

  return {
    player: { id: head.id, name: head.name, position: head.position, photoUrl: head.photo_url },
    team: teamId
      ? { id: teamId, code: head.team_code, name: head.team_name, primaryColor: head.primary_color, logoUrl: head.logo_url }
      : null,
    price,
    seasonCreditChange: r1(Number(head.season_change ?? 0)),
    fantasyPointsAverage: playedPoints.length > 0 ? r1(playedPoints.reduce((a, b) => a + b, 0) / playedPoints.length) : null,
    ownedPct: squads > 0 ? Math.round((Number(head.owners ?? 0) / squads) * 100) : null,
    nextGames: (nextRows as Row[]).map((g) => {
      const isHome = g.home_team_id === teamId;
      return {
        tipoffAt: new Date(g.tipoff_at).toISOString(),
        isHome,
        opponent: isHome ? { code: g.away_code, logoUrl: g.away_logo } : { code: g.home_code, logoUrl: g.home_logo },
      };
    }),
    games,
  };
}
