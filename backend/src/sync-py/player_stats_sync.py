"""
Pulls player traditional season stats via euroleague-api and upserts them
into `players` and `player_season_stats`.

Usage:
    python player_stats_sync.py [season]

    season   start year of the season, e.g. 2025 for 2025-26 (default 2026)

Requires teams to already be synced (via standings_sync.py) — this script
looks up each player's team by `teams.code` and skips any player whose
team code isn't found, rather than guessing at team metadata it doesn't have.

Requires DATABASE_URL in the environment (loaded from .env).
"""
import math
import os
import sys
from typing import Optional, Tuple

import psycopg2
from dotenv import load_dotenv
from euroleague_api.player_stats import PlayerStats

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]


def season_label(season: int) -> str:
    end_year = str(season + 1)[-2:]
    return f"{season}-{end_year}"


def safe_float(value) -> Optional[float]:
    """pandas NaN is truthy in Python, so plain `value or 0` silently
    keeps NaN instead of replacing it — this catches that explicitly."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def safe_str(value) -> Optional[str]:
    """Same NaN trap as safe_float, but for string columns (e.g. a player
    with no photo on file comes back as float('nan'), not None or "")."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    value = str(value).strip()
    return value or None


def field_goal_pct(row) -> Optional[float]:
    made = (safe_float(row["twoPointersMade"]) or 0) + (safe_float(row["threePointersMade"]) or 0)
    attempted = (safe_float(row["twoPointersAttempted"]) or 0) + (
        safe_float(row["threePointersAttempted"]) or 0
    )
    return (made / attempted * 100) if attempted else None


def pct_to_float(value) -> Optional[float]:
    """Advanced-endpoint percentage fields come back as strings like
    "51.9%" (or NaN for players with no qualifying possessions)."""
    s = safe_str(value)
    return float(s.rstrip("%")) if s else None


def sync_usage_percentage(cur, season_: str) -> None:
    """Usage% isn't part of euroleague-api's `advanced` endpoint (checked
    directly against its actual response columns — there's no usage field at
    all), so unlike every other column in this script it's computed here
    from raw per-game box scores instead of synced verbatim.

    Standard formula: 100 * (playerFGA + 0.44*playerFTA + playerTOV) *
    (teamMinutes/5) / (playerMinutes * (teamFGA + 0.44*teamFTA + teamTOV)).

    `player_game_stats` has no per-game team column (only `players.team_id`,
    the player's *current* team) — so team totals are built by grouping
    game rows on the current team_id, restricted to rows where that current
    team_id actually matches one side of that specific game
    (`p.team_id IN (g.home_team_id, g.away_team_id)`). For a player who's
    since been traded, an old game with their old team fails that filter and
    is silently excluded from both their own average and their old
    teammates' team totals — same "current team only" simplification as the
    roster page's known limitation (see CLAUDE.md), rather than a new one.
    """
    cur.execute(
        """
        WITH game_team_totals AS (
            SELECT
                pgs.game_id,
                p.team_id,
                SUM(pgs.minutes) AS team_minutes,
                SUM(COALESCE(pgs.field_goals_attempted_2, 0) + COALESCE(pgs.field_goals_attempted_3, 0)) AS team_fga,
                SUM(COALESCE(pgs.free_throws_attempted, 0)) AS team_fta,
                SUM(COALESCE(pgs.turnovers, 0)) AS team_tov
            FROM player_game_stats pgs
            JOIN games g ON g.id = pgs.game_id
            JOIN players p ON p.id = pgs.player_id
            WHERE g.season = %(season)s
              AND pgs.minutes IS NOT NULL AND pgs.minutes > 0
              AND p.team_id IN (g.home_team_id, g.away_team_id)
            GROUP BY pgs.game_id, p.team_id
        ),
        player_game_usage AS (
            SELECT
                pgs.player_id,
                100.0 * (
                    COALESCE(pgs.field_goals_attempted_2, 0) + COALESCE(pgs.field_goals_attempted_3, 0)
                    + 0.44 * COALESCE(pgs.free_throws_attempted, 0) + COALESCE(pgs.turnovers, 0)
                ) * (gtt.team_minutes / 5.0)
                / NULLIF(pgs.minutes * (gtt.team_fga + 0.44 * gtt.team_fta + gtt.team_tov), 0) AS usage_pct
            FROM player_game_stats pgs
            JOIN games g ON g.id = pgs.game_id
            JOIN players p ON p.id = pgs.player_id
            JOIN game_team_totals gtt ON gtt.game_id = pgs.game_id AND gtt.team_id = p.team_id
            WHERE g.season = %(season)s
              AND pgs.minutes IS NOT NULL AND pgs.minutes > 0
        )
        UPDATE player_season_stats pss
        SET usage_percentage = agg.usage_percentage
        FROM (
            SELECT player_id, AVG(usage_pct) AS usage_percentage
            FROM player_game_usage
            WHERE usage_pct IS NOT NULL
            GROUP BY player_id
        ) agg
        WHERE pss.player_id = agg.player_id AND pss.season = %(season)s
        """,
        {"season": season_},
    )


def sync_player_stats(season: int) -> Tuple[int, int, int]:
    ps = PlayerStats(competition="E")
    df = ps.get_player_stats_single_season(endpoint="traditional", season=season)
    adv_df = ps.get_player_stats_single_season(endpoint="advanced", season=season)
    adv_by_code = {row["player.code"]: row for _, row in adv_df.iterrows()}

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    season_ = season_label(season)

    cur.execute("SELECT code, id FROM teams")
    team_ids_by_code = dict(cur.fetchall())

    players_upserted = 0
    stats_upserted = 0
    skipped_no_team = 0

    try:
        for _, row in df.iterrows():
            # Players who changed teams mid-season have a compound code
            # like "OLY;PAR" — the last entry is their most recent team.
            raw_team_code = row["player.team.code"]
            team_code = raw_team_code.split(";")[-1] if ";" in raw_team_code else raw_team_code
            team_id = team_ids_by_code.get(team_code)
            if team_id is None:
                skipped_no_team += 1
                continue

            player_code = row["player.code"]
            player_name = row["player.name"]
            photo_url = safe_str(row["player.imageUrl"])

            cur.execute(
                """
                INSERT INTO players (code, team_id, name, photo_url)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (code) DO UPDATE
                SET team_id = EXCLUDED.team_id, name = EXCLUDED.name, photo_url = EXCLUDED.photo_url
                RETURNING id
                """,
                (player_code, team_id, player_name, photo_url),
            )
            player_id = cur.fetchone()[0]
            players_upserted += 1

            adv = adv_by_code.get(player_code)

            cur.execute(
                """
                INSERT INTO player_season_stats (
                    player_id, team_id, season, games_played, minutes_per_game,
                    points_per_game, rebounds_per_game, assists_per_game,
                    steals_per_game, blocks_per_game, turnovers_per_game,
                    field_goal_pct, three_point_pct, free_throw_pct, valuation,
                    effective_field_goal_pct, true_shooting_pct,
                    offensive_rebound_pct, defensive_rebound_pct, total_rebound_pct,
                    assist_to_turnover_ratio, assist_ratio, turnover_ratio,
                    two_point_attempt_rate, three_point_attempt_rate,
                    free_throw_rate, possessions_per_game
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (player_id, season) DO UPDATE SET
                    team_id = EXCLUDED.team_id,
                    games_played = EXCLUDED.games_played,
                    minutes_per_game = EXCLUDED.minutes_per_game,
                    points_per_game = EXCLUDED.points_per_game,
                    rebounds_per_game = EXCLUDED.rebounds_per_game,
                    assists_per_game = EXCLUDED.assists_per_game,
                    steals_per_game = EXCLUDED.steals_per_game,
                    blocks_per_game = EXCLUDED.blocks_per_game,
                    turnovers_per_game = EXCLUDED.turnovers_per_game,
                    field_goal_pct = EXCLUDED.field_goal_pct,
                    three_point_pct = EXCLUDED.three_point_pct,
                    free_throw_pct = EXCLUDED.free_throw_pct,
                    valuation = EXCLUDED.valuation,
                    effective_field_goal_pct = EXCLUDED.effective_field_goal_pct,
                    true_shooting_pct = EXCLUDED.true_shooting_pct,
                    offensive_rebound_pct = EXCLUDED.offensive_rebound_pct,
                    defensive_rebound_pct = EXCLUDED.defensive_rebound_pct,
                    total_rebound_pct = EXCLUDED.total_rebound_pct,
                    assist_to_turnover_ratio = EXCLUDED.assist_to_turnover_ratio,
                    assist_ratio = EXCLUDED.assist_ratio,
                    turnover_ratio = EXCLUDED.turnover_ratio,
                    two_point_attempt_rate = EXCLUDED.two_point_attempt_rate,
                    three_point_attempt_rate = EXCLUDED.three_point_attempt_rate,
                    free_throw_rate = EXCLUDED.free_throw_rate,
                    possessions_per_game = EXCLUDED.possessions_per_game
                """,
                (
                    player_id,
                    team_id,
                    season_,
                    int(safe_float(row["gamesPlayed"]) or 0),
                    safe_float(row["minutesPlayed"]),
                    safe_float(row["pointsScored"]),
                    safe_float(row["totalRebounds"]),
                    safe_float(row["assists"]),
                    safe_float(row["steals"]),
                    safe_float(row["blocks"]),
                    safe_float(row["turnovers"]),
                    field_goal_pct(row),
                    pct_to_float(row["threePointersPercentage"]),
                    pct_to_float(row["freeThrowsPercentage"]),
                    safe_float(row["pir"]),
                    pct_to_float(adv["effectiveFieldGoalPercentage"]) if adv is not None else None,
                    pct_to_float(adv["trueShootingPercentage"]) if adv is not None else None,
                    pct_to_float(adv["offensiveReboundsPercentage"]) if adv is not None else None,
                    pct_to_float(adv["defensiveReboundsPercentage"]) if adv is not None else None,
                    pct_to_float(adv["reboundsPercentage"]) if adv is not None else None,
                    safe_float(adv["assistsToTurnoversRatio"]) if adv is not None else None,
                    pct_to_float(adv["assistsRatio"]) if adv is not None else None,
                    pct_to_float(adv["turnoversRatio"]) if adv is not None else None,
                    pct_to_float(adv["twoPointAttemptsRatio"]) if adv is not None else None,
                    pct_to_float(adv["threePointAttemptsRatio"]) if adv is not None else None,
                    pct_to_float(adv["freeThrowsRate"]) if adv is not None else None,
                    safe_float(adv["possesions"]) if adv is not None else None,
                ),
            )
            stats_upserted += 1

        sync_usage_percentage(cur, season_)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    return players_upserted, stats_upserted, skipped_no_team


if __name__ == "__main__":
    # Bumped from 2025 to 2026 on 2026-09-03 — see roster_sync.py's
    # identical fix for why a stale default silently overwrites correct
    # current-season data with the prior season's once a season transitions.
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026

    players_upserted, stats_upserted, skipped = sync_player_stats(season)
    print(
        f"Synced {players_upserted} players, {stats_upserted} season-stat rows "
        f"for season {season}. Skipped {skipped} players with unrecognized team codes."
    )