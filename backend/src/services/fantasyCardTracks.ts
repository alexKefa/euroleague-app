import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { computeFantasyGamePoints } from "./fantasyScoring.js";
import { displayName, normalize } from "./imageSync.js";

/**
 * Fantasy card tracks (2026-10-01, replacing the "legendary pack every 3
 * completed rounds" fantasy milestone — achievements should hand out coaches,
 * not legendaries). Counted over completed rounds (a fantasy_round_points
 * row), career-wide:
 *
 * - Coach: a round counts when the user's coach won his game. Every
 *   FANTASY_COACH_TRACK_INTERVAL such rounds grants the card of the coach
 *   picked most in that streak (latest on a tie), or a coach the user is
 *   missing if he already owns that one.
 * - Captain: a round counts when the captain scored positive fantasy points.
 *   Every FANTASY_CAPTAIN_TRACK_INTERVAL such rounds grants a rare card of
 *   one of that streak's captains the user is missing (most-picked first),
 *   else any rare he's missing.
 *
 * Intervals were tuned with economy:simulate (see season-simulation.ts):
 * an engaged free player finishes the album near the season's end and
 * collects most of the 20 coaches. Claim-first like every other milestone:
 * the unique (user, milestone) insert happens before the card is granted.
 */
export const FANTASY_COACH_TRACK_INTERVAL = 4;
export const FANTASY_CAPTAIN_TRACK_INTERVAL = 3;

type Row = Record<string, any>;

export interface FantasyCardReward {
  id: string;
  kind: "coachCard" | "captainCard";
  collectibleId: string;
  name: string;
  tier: string;
  imageUrl: string | null;
  teamCode: string;
}

export interface FantasyCardTrackProgress {
  coach: { positiveRounds: number; every: number };
  captain: { positiveRounds: number; every: number };
}

/** The user's counting rounds for both tracks, oldest first. */
async function positiveRounds(userId: string): Promise<{ coach: string[]; captain: { playerId: string; teamId: string; name: string }[] }> {
  const [coachRows, captainRows] = await Promise.all([
    db.execute<Row>(sql`
      select c.team_id
      from fantasy_coach_picks c
      join fantasy_round_points frp on frp.user_id = c.user_id and frp.season = c.season and frp.round = c.round
      join games g on g.season = c.season and g.round = c.round and g.status = 'final'
        and c.team_id in (g.home_team_id, g.away_team_id)
      where c.user_id = ${userId}
        and case when g.home_team_id = c.team_id then g.home_score > g.away_score else g.away_score > g.home_score end
      order by c.season, c.round
    `),
    db.execute<Row>(sql`
      select fl.player_id, p.team_id, p.name, g.home_team_id, g.home_score, g.away_score,
        pgs.points, pgs.rebounds, pgs.assists, pgs.steals, pgs.turnovers, pgs.blocks_favour, pgs.blocks_against,
        pgs.fouls_committed, pgs.fouls_received, pgs.field_goals_made_2, pgs.field_goals_attempted_2,
        pgs.field_goals_made_3, pgs.field_goals_attempted_3, pgs.free_throws_made, pgs.free_throws_attempted
      from fantasy_lineups fl
      join fantasy_round_points frp on frp.user_id = fl.user_id and frp.season = fl.season and frp.round = fl.round
      join players p on p.id = fl.player_id
      join games g on g.season = fl.season and g.round = fl.round and g.status = 'final'
        and p.team_id in (g.home_team_id, g.away_team_id)
      join player_game_stats pgs on pgs.game_id = g.id and pgs.player_id = fl.player_id
      where fl.user_id = ${userId} and fl.is_captain
      order by fl.season, fl.round
    `),
  ]);
  const captain = (captainRows as Row[])
    .filter((r) => {
      const isHome = r.home_team_id === r.team_id;
      const won = isHome ? r.home_score > r.away_score : r.away_score > r.home_score;
      const fp = computeFantasyGamePoints(
        {
          points: r.points,
          rebounds: r.rebounds,
          assists: r.assists,
          steals: r.steals,
          turnovers: r.turnovers,
          blocksFavour: r.blocks_favour,
          blocksAgainst: r.blocks_against,
          foulsCommitted: r.fouls_committed,
          foulsReceived: r.fouls_received,
          fieldGoalsMade2: r.field_goals_made_2,
          fieldGoalsAttempted2: r.field_goals_attempted_2,
          fieldGoalsMade3: r.field_goals_made_3,
          fieldGoalsAttempted3: r.field_goals_attempted_3,
          freeThrowsMade: r.free_throws_made,
          freeThrowsAttempted: r.free_throws_attempted,
        },
        won
      );
      return fp > 0;
    })
    .map((r) => ({ playerId: r.player_id, teamId: r.team_id, name: r.name }));
  return { coach: (coachRows as Row[]).map((r) => r.team_id), captain };
}

/** Most frequent value, latest occurrence winning a tie. */
function mostPicked<T>(items: T[], key: (t: T) => string): T[] {
  const count = new Map<string, number>();
  const last = new Map<string, number>();
  items.forEach((t, i) => {
    count.set(key(t), (count.get(key(t)) ?? 0) + 1);
    last.set(key(t), i);
  });
  const unique = [...new Map(items.map((t) => [key(t), t])).values()];
  return unique.sort((a, b) => count.get(key(b))! - count.get(key(a))! || last.get(key(b))! - last.get(key(a))!);
}

async function grantCard(userId: string, collectibleId: string | null): Promise<string | null> {
  if (!collectibleId) return null;
  const inserted = (await db.execute<Row>(sql`
    insert into user_collectibles (user_id, collectible_id) values (${userId}, ${collectibleId})
    on conflict do nothing returning collectible_id
  `)) as Row[];
  return inserted.length > 0 ? collectibleId : null;
}

/**
 * Grants every newly-reached coach/captain card, then returns all of the
 * user's still-unseen ones (for the app-wide reward toast).
 */
export async function checkAndGrantFantasyCardTracks(userId: string): Promise<FantasyCardReward[]> {
  const [rounds, [claimed]] = await Promise.all([
    positiveRounds(userId),
    db.execute<Row>(sql`
      select (select count(*)::int from fantasy_coach_cards where user_id = ${userId}) as coach,
        (select count(*)::int from fantasy_captain_cards where user_id = ${userId}) as captain
    `),
  ]);

  const coachDue = Math.floor(rounds.coach.length / FANTASY_COACH_TRACK_INTERVAL);
  const captainDue = Math.floor(rounds.captain.length / FANTASY_CAPTAIN_TRACK_INTERVAL);
  if (coachDue > claimed.coach || captainDue > claimed.captain) {
    // The user's coach and rare ownership, to pick missing cards.
    const cards = (await db.execute<Row>(sql`
      select c.id, c.tier, c.team_id, c.name, uc.collectible_id is not null as owned
      from collectibles c
      left join user_collectibles uc on uc.collectible_id = c.id and uc.user_id = ${userId}
      where c.tier in ('coach', 'rare')
    `)) as Row[];
    const owned = new Set(cards.filter((c) => c.owned).map((c) => c.id));
    const randomMissing = (tier: string) => {
      const missing = cards.filter((c) => c.tier === tier && !owned.has(c.id));
      return missing.length > 0 ? missing[Math.floor(Math.random() * missing.length)].id : null;
    };

    for (let n = claimed.coach + 1; n <= coachDue; n++) {
      const streak = rounds.coach.slice((n - 1) * FANTASY_COACH_TRACK_INTERVAL, n * FANTASY_COACH_TRACK_INTERVAL);
      const teamId = mostPicked(streak, (t) => t)[0];
      const [claim] = (await db.execute<Row>(sql`
        insert into fantasy_coach_cards (user_id, milestone_number, team_id) values (${userId}, ${n}, ${teamId})
        on conflict do nothing returning id
      `)) as Row[];
      if (!claim) continue;
      const own = cards.find((c) => c.tier === "coach" && c.team_id === teamId);
      const pick = own && !owned.has(own.id) ? own.id : randomMissing("coach");
      const granted = await grantCard(userId, pick);
      if (granted) {
        owned.add(granted);
        await db.execute(sql`update fantasy_coach_cards set collectible_id = ${granted} where id = ${claim.id}`);
      }
    }

    for (let n = claimed.captain + 1; n <= captainDue; n++) {
      const streak = rounds.captain.slice((n - 1) * FANTASY_CAPTAIN_TRACK_INTERVAL, n * FANTASY_CAPTAIN_TRACK_INTERVAL);
      const candidates = mostPicked(streak, (c) => c.playerId);
      const [claim] = (await db.execute<Row>(sql`
        insert into fantasy_captain_cards (user_id, milestone_number, player_id) values (${userId}, ${n}, ${candidates[0]?.playerId ?? null})
        on conflict do nothing returning id
      `)) as Row[];
      if (!claim) continue;
      // Cards carry no player id: matched on team + display name, the same
      // way expand-collectibles/imageSync tie a card to its player.
      const cardFor = (c: { teamId: string; name: string }) =>
        cards.find((card) => card.tier === "rare" && card.team_id === c.teamId && normalize(card.name) === normalize(displayName(c.name)));
      const missingCaptain = candidates.map(cardFor).find((card) => card && !owned.has(card.id));
      const granted = await grantCard(userId, missingCaptain?.id ?? randomMissing("rare"));
      if (granted) {
        owned.add(granted);
        await db.execute(sql`update fantasy_captain_cards set collectible_id = ${granted} where id = ${claim.id}`);
      }
    }
  }

  const unseen = (await db.execute<Row>(sql`
    select m.id, 'coachCard' as kind, c.id as collectible_id, c.name, c.tier, c.image_url, t.code as team_code
    from fantasy_coach_cards m join collectibles c on c.id = m.collectible_id join teams t on t.id = c.team_id
    where m.user_id = ${userId} and m.seen_at is null
    union all
    select m.id, 'captainCard', c.id, c.name, c.tier, c.image_url, t.code
    from fantasy_captain_cards m join collectibles c on c.id = m.collectible_id join teams t on t.id = c.team_id
    where m.user_id = ${userId} and m.seen_at is null
  `)) as Row[];
  return unseen.map((r) => ({
    id: r.id,
    kind: r.kind,
    collectibleId: r.collectible_id,
    name: r.name,
    tier: r.tier,
    imageUrl: r.image_url,
    teamCode: r.team_code,
  }));
}

export async function markFantasyCardTracksSeen(userId: string): Promise<void> {
  await db.execute(sql`
    update fantasy_coach_cards set seen_at = now() where user_id = ${userId} and seen_at is null;
  `);
  await db.execute(sql`
    update fantasy_captain_cards set seen_at = now() where user_id = ${userId} and seen_at is null;
  `);
}

/** Progress toward the next card on each track (Achievements page). */
export async function getFantasyCardTrackProgress(userId: string): Promise<FantasyCardTrackProgress> {
  const rounds = await positiveRounds(userId);
  return {
    coach: { positiveRounds: rounds.coach.length, every: FANTASY_COACH_TRACK_INTERVAL },
    captain: { positiveRounds: rounds.captain.length, every: FANTASY_CAPTAIN_TRACK_INTERVAL },
  };
}
