// Data export (2026-10-12): everything the app keeps about one user, as a
// JSON download from the profile page (GDPR access/portability). Other
// people appear by username only, never their email or id. One statement:
// each section is a json_agg subquery, since latency here is round trips.
// Spec: docs/superpowers/specs/2026-10-12-account-deletion-design.md
// Checked by scripts/check-account-deletion.ts.
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

export interface AccountExport {
  exportedAt: string;
  profile: {
    email: string;
    username: string;
    createdAt: string;
    lastSeenAt: string | null;
    favoriteTeam: string | null;
    referralCode: string | null;
    referredBy: string | null; // the inviter's username
  };
  predictions: unknown[];
  topScorerPicks: unknown[];
  pointAdjustments: unknown[];
  cards: unknown[];
  packOpenings: unknown[];
  trades: unknown[];
  battles: unknown[];
  fantasy: unknown[];
  fantasyCoachPicks: unknown[];
  fantasyChips: unknown[];
  fantasyRoundPoints: unknown[];
  favoriteTeams: unknown[];
  favoritePlayers: unknown[];
  wheelSpins: unknown[];
  ownedPacks: unknown[];
  promoCodes: unknown[];
  milestones: unknown[];
  pollVotes: unknown[];
  savedViews: unknown[];
  devices: unknown[];
  leagues: unknown[];
  achievements: unknown[];
  pushSubscriptions: { host: string; createdAt: string }[];
}

type Raw = Omit<AccountExport, "exportedAt" | "profile"> & { profile: AccountExport["profile"] | null };

export async function buildAccountExport(userId: string): Promise<AccountExport> {
  const list = (q: ReturnType<typeof sql>) => sql`coalesce((select json_agg(x) from (${q}) x), '[]'::json)`;
  // Tables holding only this user's own rows: each row as stored, minus its
  // internal ids (review fix 2026-10-12: the export has to cover everything,
  // including what deletion then destroys).
  const own = (table: string, drop: string[] = []) =>
    sql`coalesce((select json_agg(to_jsonb(t) - 'id' - 'user_id'${sql.raw(drop.map((c) => ` - '${c}'`).join(""))})
      from ${sql.raw(table)} t where t.user_id = ${userId}), '[]'::json)`;
  const [row] = await db.execute<Raw>(sql`
    select
      (select json_build_object(
          'email', u.email, 'username', u.username, 'createdAt', u.created_at, 'lastSeenAt', u.last_seen_at,
          'favoriteTeam', t.name, 'referralCode', u.referral_code, 'referredBy', ru.username)
        from users u left join teams t on t.id = u.favorite_team_id left join users ru on ru.id = u.referred_by_user_id
        where u.id = ${userId}) as profile,
      ${list(sql`
        select g.season, g.round, ht.name as home, at.name as away, pt.name as picked, p.created_at as "pickedAt"
        from predictions p join games g on g.id = p.game_id
        join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
        join teams pt on pt.id = p.predicted_winner_team_id
        where p.user_id = ${userId} order by p.created_at`)} as predictions,
      ${list(sql`
        select g.season, g.round, ht.name as home, at.name as away, pl.name as player, tsp.points_at_pick as "pointsAtPick", tsp.created_at as "pickedAt"
        from top_scorer_predictions tsp join games g on g.id = tsp.game_id
        join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
        join players pl on pl.id = tsp.predicted_player_id
        where tsp.user_id = ${userId} order by tsp.created_at`)} as "topScorerPicks",
      ${list(sql`
        select pa.points, pa.reason, pa.created_at as "createdAt"
        from point_adjustments pa where pa.user_id = ${userId} order by pa.created_at`)} as "pointAdjustments",
      ${list(sql`
        select c.name, c.tier, uc.finish, uc.unlocked_at as "unlockedAt"
        from user_collectibles uc join collectibles c on c.id = uc.collectible_id
        where uc.user_id = ${userId} order by uc.unlocked_at`)} as cards,
      ${list(sql`
        select po.pack_type as "packType", po.points_cost as "pointsCost", po.opened_at as "openedAt"
        from pack_openings po where po.user_id = ${userId} order by po.opened_at`)} as "packOpenings",
      ${list(sql`
        select case when o.from_user_id = ${userId} then 'sent' else 'received' end as direction,
          case when o.from_user_id = ${userId} then tu.username else fu.username end as "otherUser",
          o.status, rc.name as requested,
          (select coalesce(json_agg(c.name), '[]'::json) from trade_offer_items i join collectibles c on c.id = i.collectible_id
            where i.trade_offer_id = o.id) as offered,
          o.created_at as "createdAt", o.responded_at as "respondedAt"
        from trade_offers o join users fu on fu.id = o.from_user_id join users tu on tu.id = o.to_user_id
        left join collectibles rc on rc.id = o.requested_collectible_id
        where ${userId} in (o.from_user_id, o.to_user_id) order by o.created_at`)} as trades,
      ${list(sql`
        select case when b.challenger_user_id = ${userId} then cu2.username else cu1.username end as "otherUser",
          case when b.challenger_user_id = ${userId} then 'challenger' else 'opponent' end as role,
          b.status, case when b.winner_user_id is null then null when b.winner_user_id = ${userId} then 'won' else 'lost' end as result,
          b.stake_points as "stakePoints", b.created_at as "createdAt"
        from battles b join users cu1 on cu1.id = b.challenger_user_id join users cu2 on cu2.id = b.opponent_user_id
        where ${userId} in (b.challenger_user_id, b.opponent_user_id) order by b.created_at`)} as battles,
      ${list(sql`
        select fl.season, fl.round, pl.name as player, fl.slot_role as "slotRole", fl.is_captain as "isCaptain", fl.price_at_pick as "priceAtPick"
        from fantasy_lineups fl join players pl on pl.id = fl.player_id
        where fl.user_id = ${userId} order by fl.season, fl.round`)} as fantasy,
      ${list(sql`
        select l.name, lm.joined_at as "joinedAt"
        from league_members lm join leagues l on l.id = lm.league_id where lm.user_id = ${userId}`)} as leagues,
      ${list(sql`
        select rr.season, rr.round, c.name as card, rr.granted_at as "grantedAt"
        from round_rewards rr left join collectibles c on c.id = rr.collectible_id
        where rr.user_id = ${userId} order by rr.granted_at`)} as achievements,
      ${own("fantasy_coach_picks")} as "fantasyCoachPicks",
      ${own("fantasy_chips")} as "fantasyChips",
      ${own("fantasy_round_points")} as "fantasyRoundPoints",
      ${list(sql`select t.name as team, f.created_at as "createdAt" from favorites f join teams t on t.id = f.team_id where f.user_id = ${userId}`)} as "favoriteTeams",
      ${list(sql`select p.name as player, f.created_at as "createdAt" from favorite_players f join players p on p.id = f.player_id where f.user_id = ${userId}`)} as "favoritePlayers",
      ${own("wheel_spins")} as "wheelSpins",
      ${own("owned_packs")} as "ownedPacks",
      ${own("promo_code_redemptions")} as "promoCodes",
      ${list(sql`
        select 'legendary' as kind, to_jsonb(m) - 'id' - 'user_id' as row from legendary_milestones m where m.user_id = ${userId}
        union all select 'coach', to_jsonb(m) - 'id' - 'user_id' from coach_milestones m where m.user_id = ${userId}
        union all select 'rare', to_jsonb(m) - 'id' - 'user_id' from rare_milestones m where m.user_id = ${userId}
        union all select 'fantasy', to_jsonb(m) - 'id' - 'user_id' from fantasy_milestones m where m.user_id = ${userId}`)} as milestones,
      ${own("legendary_poll_votes")} as "pollVotes",
      ${own("analytics_views")} as "savedViews",
      ${own("device_tokens", ["token"])} as devices,
      ${list(sql`
        select substring(ps.endpoint from '^https?://([^/]+)') as host, ps.created_at as "createdAt"
        from push_subscriptions ps where ps.user_id = ${userId}`)} as "pushSubscriptions"
  `);
  if (!row?.profile) throw new Error("user not found");
  return { exportedAt: new Date().toISOString(), ...row, profile: row.profile };
}
