import { Router } from "express";
import { eq, asc, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { teams, teamSeasonStats, playerSeasonStats } from "../db/schema.js";
import { getCurrentSeason } from "../services/season.js";

export const standingsRouter = Router();

standingsRouter.get("/", async (_req, res) => {
  try {
    // See services/season.ts for why this is "latest season with games
    // synced" rather than "most games actually played" — the standings
    // table is meant to go empty/reset the moment a new season starts,
    // not keep showing the prior season's final table until real games
    // pile up for the new one.
    const season = await getCurrentSeason();
    if (!season) {
      return res.json([]);
    }

    const rows = await db
      .select({ team: teams, stats: teamSeasonStats })
      .from(teamSeasonStats)
      .innerJoin(teams, eq(teamSeasonStats.teamId, teams.id))
      .where(eq(teamSeasonStats.season, season))
      .orderBy(asc(teamSeasonStats.position));

    // No raw "team rebounds per game" field is synced (team_season_stats
    // only has the percentage-based rebPct) — approximate it from the
    // already-populated player_season_stats instead of touching the
    // Python sync: each roster player's own reboundsPerGame, summed. Not
    // exact (a bench player's games-played can undercount slightly
    // relative to the team's own game count) but close enough for a
    // fan-facing comparison, same spirit as the PIR badge thresholds below.
    const reboundRows = await db
      .select({
        teamId: playerSeasonStats.teamId,
        rpg: sql<number>`sum(${playerSeasonStats.reboundsPerGame})`,
      })
      .from(playerSeasonStats)
      .where(eq(playerSeasonStats.season, season))
      .groupBy(playerSeasonStats.teamId);
    const rpgByTeam = new Map(reboundRows.map((r) => [r.teamId, r.rpg]));

    // Last-10 record (matches euroleaguebasketball.net's own "L10" column).
    // Not stored anywhere — games has no per-team "result" column, only
    // home/away scores — so this unpivots each final game into one row per
    // side, ranks each team's own games most-recent-first, and keeps only
    // the top 10 before counting wins/losses. One query for every team
    // rather than 20 (one per team), same "fewer round trips" reasoning as
    // the rebounds query above and elsewhere in this app.
    const last10Rows = await db.execute<{ teamId: string; wins: number; losses: number }>(sql`
      WITH team_games AS (
        SELECT home_team_id AS team_id, tipoff_at, (home_score > away_score) AS won
        FROM games WHERE season = ${season} AND status = 'final'
        UNION ALL
        SELECT away_team_id AS team_id, tipoff_at, (away_score > home_score) AS won
        FROM games WHERE season = ${season} AND status = 'final'
      ),
      ranked AS (
        SELECT team_id, won, row_number() OVER (PARTITION BY team_id ORDER BY tipoff_at DESC) AS rn
        FROM team_games
      )
      SELECT
        team_id AS "teamId",
        sum(CASE WHEN won THEN 1 ELSE 0 END)::int AS wins,
        sum(CASE WHEN NOT won THEN 1 ELSE 0 END)::int AS losses
      FROM ranked
      WHERE rn <= 10
      GROUP BY team_id
    `);
    const last10ByTeam = new Map(last10Rows.map((r) => [r.teamId, { wins: r.wins, losses: r.losses }]));

    // Real bug caught live (2026-09-25 opening night): wins/losses/position
    // here used to come straight from team_season_stats, synced only by
    // the Python standings_sync.py pulling euroleague-api's own Standings
    // endpoint — that endpoint lags real game completion by hours (checked
    // directly: still reported gamesPlayed: 0 for every team well after
    // several round-1 games had genuinely finished on the live widget,
    // same lag already documented for the v2 schedule endpoint's own
    // `played` flag). Rather than depend on that slow external pipeline
    // for the one stat everyone actually looks at, wins/losses/PPG/PAPG/
    // position are now computed straight from our own `games` table
    // (already correct in real time via sync/liveGamesSync.ts) — same
    // "derive it from games, not a separately-synced column" precedent
    // last10Rows above already set. offRating/defRating/rebPct/astPct stay
    // sourced from team_season_stats since euroleague-api's advanced team
    // stats have no equivalent derivable from data this app already syncs.
    const recordRows = await db.execute<{
      teamId: string;
      gamesPlayed: number;
      wins: number;
      losses: number;
      pointsFor: number;
      pointsAgainst: number;
    }>(sql`
      WITH team_games AS (
        SELECT home_team_id AS team_id, home_score AS scored, away_score AS allowed, (home_score > away_score) AS won
        FROM games WHERE season = ${season} AND status = 'final'
        UNION ALL
        SELECT away_team_id AS team_id, away_score AS scored, home_score AS allowed, (away_score > home_score) AS won
        FROM games WHERE season = ${season} AND status = 'final'
      )
      SELECT
        team_id AS "teamId",
        count(*)::int AS "gamesPlayed",
        sum(CASE WHEN won THEN 1 ELSE 0 END)::int AS wins,
        sum(CASE WHEN NOT won THEN 1 ELSE 0 END)::int AS losses,
        sum(scored)::int AS "pointsFor",
        sum(allowed)::int AS "pointsAgainst"
      FROM team_games
      GROUP BY team_id
    `);
    const recordByTeam = new Map(recordRows.map((r) => [r.teamId, r]));

    // Position: sort by wins desc, losses asc, point differential desc —
    // a reasonable single-pass approximation of EuroLeague's real tiebreak
    // rules (which also weigh head-to-head results), not an exact replica.
    // A team with zero games played sorts last among its (0-0) peers via
    // the final team-name tiebreak, so the order stays stable across
    // requests instead of reflecting query/map iteration order.
    const ranked = [...rows].sort((a, b) => {
      const ra = recordByTeam.get(a.stats.teamId);
      const rb = recordByTeam.get(b.stats.teamId);
      const winsA = ra?.wins ?? 0;
      const winsB = rb?.wins ?? 0;
      if (winsB !== winsA) return winsB - winsA;
      const lossesA = ra?.losses ?? 0;
      const lossesB = rb?.losses ?? 0;
      if (lossesA !== lossesB) return lossesA - lossesB;
      const diffA = (ra?.pointsFor ?? 0) - (ra?.pointsAgainst ?? 0);
      const diffB = (rb?.pointsFor ?? 0) - (rb?.pointsAgainst ?? 0);
      if (diffB !== diffA) return diffB - diffA;
      return a.team.name.localeCompare(b.team.name);
    });

    const payload = ranked.map(({ team, stats }, index) => {
      const record = recordByTeam.get(stats.teamId);
      const gamesPlayed = record?.gamesPlayed ?? 0;
      return {
        team,
        position: index + 1,
        stats: {
          teamId: stats.teamId,
          season: stats.season,
          wins: record?.wins ?? 0,
          losses: record?.losses ?? 0,
          ppg: gamesPlayed > 0 ? (record!.pointsFor / gamesPlayed) : null,
          papg: gamesPlayed > 0 ? (record!.pointsAgainst / gamesPlayed) : null,
          offRating: stats.offRating,
          defRating: stats.defRating,
          rebPct: stats.rebPct,
          astPct: stats.astPct,
          rpg: rpgByTeam.get(stats.teamId) ?? null,
          last10: last10ByTeam.get(stats.teamId) ?? null,
        },
      };
    });

    res.json(payload);
  } catch (err) {
    console.error("GET /api/standings failed:", err);
    res.status(500).json({ error: "Failed to load standings" });
  }
});