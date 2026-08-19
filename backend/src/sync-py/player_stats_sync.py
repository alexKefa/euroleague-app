"""
Pulls player traditional season stats via euroleague-api and upserts them
into `players` and `player_season_stats`.

Usage:
    python player_stats_sync.py [season]

    season   start year of the season, e.g. 2025 for 2025-26 (default 2025)

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


def sync_player_stats(season: int) -> Tuple[int, int, int]:
    ps = PlayerStats(competition="E")
    df = ps.get_player_stats_single_season(endpoint="traditional", season=season)

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

            cur.execute(
                """
                INSERT INTO player_season_stats (
                    player_id, team_id, season, games_played, minutes_per_game,
                    points_per_game, rebounds_per_game, assists_per_game,
                    steals_per_game, blocks_per_game, turnovers_per_game,
                    field_goal_pct, three_point_pct, free_throw_pct, valuation
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    valuation = EXCLUDED.valuation
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
                    safe_float(row["threePointersPercentage"]),
                    safe_float(row["freeThrowsPercentage"]),
                    safe_float(row["pir"]),
                ),
            )
            stats_upserted += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    return players_upserted, stats_upserted, skipped_no_team


if __name__ == "__main__":
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2025

    players_upserted, stats_upserted, skipped = sync_player_stats(season)
    print(
        f"Synced {players_upserted} players, {stats_upserted} season-stat rows "
        f"for season {season}. Skipped {skipped} players with unrecognized team codes."
    )