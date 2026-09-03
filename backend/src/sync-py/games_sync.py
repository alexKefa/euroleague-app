"""
Pulls the full season schedule (all rounds) via euroleague-api's
get_gamecodes_round and upserts into `games`.

get_gamecodes_round returns much richer data than get_gamecodes_season
(team codes, UTC kickoff time, live scores) — confirmed by an actual pull,
not assumed — so this loops every round rather than using the season-wide
method, which uses an older, sparser endpoint.

Usage:
    python games_sync.py [season] [num_rounds]

    season      start year of the season, e.g. 2025 (default 2026)
    num_rounds  regular-season rounds to pull, 1..N (default 38)

Requires teams to already be synced (via standings_sync.py) — games for
teams not found by code are skipped, not guessed at.
"""
import math
import os
import sys
from typing import Optional

import pandas as pd
import psycopg2
from dotenv import load_dotenv
from euroleague_api.EuroLeagueData import EuroLeagueData

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]


def safe_int(value) -> Optional[int]:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else int(f)


def season_label(season: int) -> str:
    """2025 -> '2025-26', matching the season format used across every other table."""
    end_year = str(season + 1)[-2:]
    return f"{season}-{end_year}"


def sync_games(season: int, num_rounds: int) -> tuple:
    ed = EuroLeagueData(competition="E")
    season_ = season_label(season)

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    cur.execute("SELECT code, id FROM teams")
    team_ids_by_code = dict(cur.fetchall())

    games_upserted = 0
    rounds_failed = []
    skipped_no_team = 0

    try:
        for round_number in range(1, num_rounds + 1):
            try:
                df = ed.get_gamecodes_round(season=season, round_number=round_number)
            except Exception as exc:
                print(f"Round {round_number}: fetch failed ({exc}), skipping")
                rounds_failed.append(round_number)
                continue

            for _, row in df.iterrows():
                home_code = row["local.club.code"]
                away_code = row["road.club.code"]
                home_team_id = team_ids_by_code.get(home_code)
                away_team_id = team_ids_by_code.get(away_code)

                if home_team_id is None or away_team_id is None:
                    skipped_no_team += 1
                    continue

                tipoff_raw = row["utcDate"]
                if pd.isna(tipoff_raw):
                    continue
                tipoff_at = pd.Timestamp(tipoff_raw).to_pydatetime()

                game_code = int(row["gameCode"])
                played = bool(row["played"])
                status = "final" if played else "scheduled"
                home_score = safe_int(row["local.score"])
                away_score = safe_int(row["road.score"])
                # "venue.name" — pandas' json_normalize flattens the feed's
                # nested `venue: {name, code, capacity, address, ...}` object
                # into a dotted column, same as "local.club.code" above. Only
                # the name is captured; the rest of that object isn't needed
                # yet.
                venue_name = row.get("venue.name")
                if pd.isna(venue_name):
                    venue_name = None

                cur.execute(
                    """
                    INSERT INTO games (
                        game_code, season, home_team_id, away_team_id, tipoff_at,
                        round, status, home_score, away_score, venue_name
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (season, game_code) DO UPDATE SET
                        tipoff_at = EXCLUDED.tipoff_at,
                        status = EXCLUDED.status,
                        home_score = EXCLUDED.home_score,
                        away_score = EXCLUDED.away_score,
                        venue_name = EXCLUDED.venue_name
                    """,
                    (
                        game_code,
                        season_,
                        home_team_id,
                        away_team_id,
                        tipoff_at,
                        round_number,
                        status,
                        home_score,
                        away_score,
                        venue_name,
                    ),
                )
                games_upserted += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    return games_upserted, rounds_failed, skipped_no_team


if __name__ == "__main__":
    # Bumped from 2025 to 2026 on 2026-09-03 — see roster_sync.py's
    # identical fix for why a stale default silently overwrites correct
    # current-season data with the prior season's once a season transitions.
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    num_rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 38

    games_upserted, rounds_failed, skipped = sync_games(season, num_rounds)
    print(f"Synced {games_upserted} games for season {season} ({num_rounds} rounds).")
    if rounds_failed:
        print(f"Rounds that failed to fetch: {rounds_failed}")
    if skipped:
        print(f"Skipped {skipped} games with unrecognized team codes.")