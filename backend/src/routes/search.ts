// Global search index (2026-10-12): every player, team, referee and this
// season's games in one small payload; the browser does the matching
// (frontend shared/search-match.ts), so typing costs no round trips.
// Cached 10 min; the roster and schedule syncs drop the cache when they
// change something. Spec: docs/superpowers/specs/2026-10-12-global-search-design.md
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { cached } from "../services/responseCache.js";
import { getCurrentSeason } from "../services/season.js";

export const searchRouter = Router();

export const SEARCH_INDEX_CACHE_KEY = "search:index";

searchRouter.get("/index", async (_req, res) => {
  try {
    const index = await cached(SEARCH_INDEX_CACHE_KEY, 10 * 60_000, async () => {
      const season = await getCurrentSeason();
      const [row] = await db.execute<{ players: unknown[]; teams: unknown[]; referees: unknown[]; games: unknown[] }>(sql`
        select
          coalesce((select json_agg(json_build_object(
              'id', p.id, 'name', p.name, 'teamCode', t.code, 'photoUrl', p.photo_url, 'active', p.active))
            from players p left join teams t on t.id = p.team_id), '[]'::json) as players,
          coalesce((select json_agg(json_build_object('id', t.id, 'code', t.code, 'name', t.name, 'logoUrl', t.logo_url))
            from teams t), '[]'::json) as teams,
          coalesce((select json_agg(json_build_object('id', r.id, 'name', r.name)) from referees r), '[]'::json) as referees,
          coalesce((select json_agg(json_build_object(
              'id', g.id, 'season', g.season, 'round', g.round, 'tipoffAt', g.tipoff_at, 'status', g.status,
              'home', json_build_object('code', ht.code, 'name', ht.name),
              'away', json_build_object('code', at.code, 'name', at.name),
              'homeScore', g.home_score, 'awayScore', g.away_score) order by g.tipoff_at)
            from games g join teams ht on ht.id = g.home_team_id join teams at on at.id = g.away_team_id
            where g.season = ${season}), '[]'::json) as games
      `);
      return row;
    });
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(index);
  } catch (err) {
    console.error("GET /api/search/index failed:", err);
    res.status(500).json({ error: "Failed to load search" });
  }
});
