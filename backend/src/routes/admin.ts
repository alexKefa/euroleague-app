import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import { pointsSqlExpr } from "../services/points.js";
import { topScorerTotalsCte } from "../services/topScorerPoints.js";
import { syncRosterPhotos, syncCollectibleImages } from "../services/imageSync.js";

export const adminRouter = Router();

// Read-only overview for the admin "Users" panel — plain roster data
// (name/email/joined date) plus a few numbers worth knowing at a glance
// (points balance, cards owned, predictions made, referrals) so an admin
// doesn't have to open Drizzle Studio / the DB just to sanity-check who's
// using the app. One grouped query, base-joined FROM users (not from
// predictions/collectibles like getLeaderboardEntries/getUserPoints), so a
// brand-new user with zero activity still gets a row instead of being
// silently absent — same "fewer round trips" philosophy as everywhere else
// in this app's economy, just anchored the other direction since this needs
// every user, not just active ones. totalPoints mirrors getUserPoints'
// definition exactly (every point_adjustments row, not just the
// counts_toward_ranking-filtered subset the leaderboard uses) — an admin
// checking a user's balance wants their real spendable total, not their
// ranking-eligible one.
adminRouter.get("/users", requireAuth, requireAdmin, async (_req, res) => {
  const pickedFairProb = sql`case when p.predicted_winner_team_id = g.home_team_id then go.home_fair_prob else go.away_fair_prob end`;

  const rows = await db.execute<{
    id: string;
    email: string;
    username: string;
    created_at: string;
    is_admin: boolean;
    favorite_team_id: string | null;
    team_code: string | null;
    team_name: string | null;
    predictions_made: number;
    correct_points: number;
    top_scorer_points: number;
    bonus_points: number;
    cards_owned: number;
    referrals_count: number;
  }>(sql`
    with correct_totals as (
      select p.user_id,
        sum(
          case when p.predicted_winner_team_id = case when g.home_score > g.away_score then g.home_team_id else g.away_team_id end
            then ${pointsSqlExpr(pickedFairProb)}
            else 0
          end
        )::int as correct_points
      from predictions p
      join games g on p.game_id = g.id
      left join game_odds go on go.game_id = g.id
      where g.status = 'final' and g.home_score is not null and g.away_score is not null and g.home_score <> g.away_score
      group by p.user_id
    ),
    bonus_totals as (
      select user_id, coalesce(sum(points), 0)::int as bonus
      from point_adjustments
      group by user_id
    ),
    ${topScorerTotalsCte()},
    pred_counts as (
      select user_id, count(*)::int as cnt from predictions group by user_id
    ),
    card_counts as (
      select user_id, count(*)::int as cnt from user_collectibles group by user_id
    ),
    referral_counts as (
      select referred_by_user_id as user_id, count(*)::int as cnt
      from users
      where referred_by_user_id is not null
      group by referred_by_user_id
    )
    select
      u.id, u.email, u.username, u.created_at, u.is_admin, u.favorite_team_id,
      t.code as team_code, t.name as team_name,
      coalesce(pc.cnt, 0) as predictions_made,
      coalesce(ct.correct_points, 0) as correct_points,
      coalesce(tst.points, 0) as top_scorer_points,
      coalesce(bt.bonus, 0) as bonus_points,
      coalesce(cc.cnt, 0) as cards_owned,
      coalesce(rc.cnt, 0) as referrals_count
    from users u
    left join teams t on t.id = u.favorite_team_id
    left join correct_totals ct on ct.user_id = u.id
    left join bonus_totals bt on bt.user_id = u.id
    left join top_scorer_totals tst on tst.user_id = u.id
    left join pred_counts pc on pc.user_id = u.id
    left join card_counts cc on cc.user_id = u.id
    left join referral_counts rc on rc.user_id = u.id
    order by u.created_at asc
  `);

  const signupsByDay = await db.execute<{ day: string; count: number }>(sql`
    select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as count
    from users
    group by 1
    order by 1 asc
  `);

  res.json({
    users: rows.map((r) => ({
      id: r.id,
      email: r.email,
      username: r.username,
      createdAt: r.created_at,
      isAdmin: r.is_admin,
      favoriteTeam: r.favorite_team_id
        ? { id: r.favorite_team_id, code: r.team_code, name: r.team_name }
        : null,
      totalPoints: r.correct_points + r.top_scorer_points + r.bonus_points,
      cardsOwned: r.cards_owned,
      predictionsMade: r.predictions_made,
      referralsCount: r.referrals_count,
    })),
    signupsByDay: signupsByDay.map((r) => ({ date: r.day, count: r.count })),
  });
});

// "Sync images" button on the admin Users page (2026-09-18) — a UI
// shortcut for the two-step pipeline (scripts/sync-roster-photos.ts then
// scripts/sync-collectible-images.ts) that previously only ever ran when
// asked for by hand from a terminal: pull real player/coach photos from
// EuroLeague's live club-roster feed, then push any newly-changed player
// photo into its matching collectible card's own image. Same "admin
// shortcut instead of a manual script" precedent as games.ts's
// reset-game/reset-round buttons. Runs both steps in one request/one
// button press, same order this was always run by hand — roster photos
// have to land on `players` first for the collectible step to have
// anything new to pick up.
adminRouter.post("/sync-images", requireAuth, requireAdmin, async (_req, res) => {
  const roster = await syncRosterPhotos();
  const cards = await syncCollectibleImages();
  res.json({
    playersUpdated: roster.playerUpdates.length,
    coachCardsUpdated: roster.coachCardUpdates.length,
    collectiblesUpdated: cards.collectibleUpdates.length,
  });
});
