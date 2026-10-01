import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { requireAuth } from "../auth/middleware.js";
import { getCurrentSeason } from "../services/season.js";
import { getDefaultRound, getRoundLockTime } from "../services/fantasyScoring.js";

// In-app "before it locks" reminders (2026-10-01; email reminders were
// deliberately left out). The app shows at most one banner from this.
export const remindersRouter = Router();

// Only nag once the deadline is this close.
const FANTASY_WINDOW_MS = 24 * 60 * 60 * 1000;
const PICKS_WINDOW_MS = 12 * 60 * 60 * 1000;

remindersRouter.get("/", requireAuth, async (req, res) => {
  try {
    const season = await getCurrentSeason();
    if (!season) {
      res.json({ fantasy: null, picks: null });
      return;
    }
    const now = Date.now();
    const round = await getDefaultRound(season);
    const lockAt = round !== null ? await getRoundLockTime(season, round) : null;
    const fantasyDue = round !== null && lockAt !== null && lockAt.getTime() > now && lockAt.getTime() - now <= FANTASY_WINDOW_MS;

    const [row] = await db.execute<{ has_squad: boolean; upcoming: number; unpicked: number; first_unpicked: string | null }>(sql`
      select
        exists (select 1 from fantasy_lineups where user_id = ${req.userId!} and season = ${season} and round = ${round ?? -1}) as has_squad,
        (select count(*)::int from games g where g.status = 'scheduled'
          and g.tipoff_at > now() and g.tipoff_at <= now() + ${`${PICKS_WINDOW_MS / 1000} seconds`}::interval) as upcoming,
        (select count(*)::int from games g where g.status = 'scheduled'
          and g.tipoff_at > now() and g.tipoff_at <= now() + ${`${PICKS_WINDOW_MS / 1000} seconds`}::interval
          and not exists (select 1 from predictions p where p.game_id = g.id and p.user_id = ${req.userId!})) as unpicked,
        (select min(g.tipoff_at) from games g where g.status = 'scheduled'
          and g.tipoff_at > now() and g.tipoff_at <= now() + ${`${PICKS_WINDOW_MS / 1000} seconds`}::interval
          and not exists (select 1 from predictions p where p.game_id = g.id and p.user_id = ${req.userId!})) as first_unpicked
    `);

    res.json({
      fantasy: fantasyDue && !row.has_squad ? { round, lockAt } : null,
      picks: row.unpicked > 0 ? { unpicked: row.unpicked, upcoming: row.upcoming, firstTipoff: row.first_unpicked } : null,
    });
  } catch (err) {
    console.error("GET /api/reminders failed:", err);
    res.status(500).json({ error: "Failed to load reminders" });
  }
});
