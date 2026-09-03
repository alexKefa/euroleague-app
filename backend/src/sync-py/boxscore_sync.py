"""
Pulls per-player box scores for every completed game, one game at a time
with controlled pacing between requests.

This calls BoxScoreData.get_players_boxscore_stats(season, gamecode) in our
own loop over games already in our `games` table, rather than the bulk
get_players_boxscore_stats_round method. That bulk method fires ~10 rapid
internal requests per round with no pacing, which reliably trips
Cloudflare's rate limiter on live.euroleague.net (confirmed via a separate
project's SDK docs, which hit and documented this exact issue: box score
data lives on a rate-limited origin, standings/schedule do not — that's
why those never had this problem). Their documented safe pacing is 250ms+
between requests to that origin; we use 400ms to stay comfortably under it.

Usage:
    python boxscore_sync.py [season] [start_index] [limit]

    season       start year of the season (default 2026)
    start_index  resume from this position in the games list (default 0)
    limit        max games to process this run (default: all remaining)
"""
import math
import os
import sys
import time
from typing import Optional

import psycopg2
from dotenv import load_dotenv
from euroleague_api.boxscore_data import BoxScoreData

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
# Bumped from 0.4s after the documented "250ms+" pacing still tripped a 429
# in practice around request #36 of a cold run — 1s is more conservative.
REQUEST_PACING_SECONDS = 1.0


def safe_int(value) -> Optional[int]:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else int(f)


def safe_float(value) -> Optional[float]:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def parse_minutes(value) -> Optional[float]:
    """The boxscore feed's Minutes column comes back as "MM:SS" (e.g.
    "33:21") or the literal string "DNP" for a player who didn't play — never
    a plain number, so safe_float(value) on it silently returned None for
    every row via its except-ValueError branch. That went unnoticed because
    nothing read player_game_stats.minutes until this usage% calculation
    needed it. "DNP" is None (didn't play, not "played 0:00"); a bare numeric
    string (seen in some older seasons) is treated as whole minutes."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.upper() == "DNP":
        return None
    if ":" in s:
        minutes_part, _, seconds_part = s.partition(":")
        try:
            return float(minutes_part) + float(seconds_part) / 60
        except ValueError:
            return None
    return safe_float(s)


def sync_boxscores(season: int, start_index: int = 0, limit: Optional[int] = None) -> tuple:
    bs = BoxScoreData(competition="E")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    cur.execute("SELECT code, id FROM players")
    player_ids_by_code = dict(cur.fetchall())

    cur.execute("SELECT game_code, id FROM games WHERE status = 'final' ORDER BY game_code")
    all_games = cur.fetchall()  # [(game_code, game_id), ...]

    games_to_process = all_games[start_index:]
    if limit is not None:
        games_to_process = games_to_process[:limit]

    rows_upserted = 0
    skipped_no_player = 0
    games_processed = 0
    games_failed = []
    consecutive_failures = 0

    try:
        for i, (game_code, game_id) in enumerate(games_to_process):
            position = start_index + i
            try:
                df = bs.get_players_boxscore_stats(season=season, gamecode=game_code)
                consecutive_failures = 0
            except Exception as exc:
                print(f"Game {game_code} (position {position}): fetch failed ({exc})")
                games_failed.append(game_code)
                consecutive_failures += 1
                if consecutive_failures >= 5:
                    print(
                        f"5 consecutive failures — stopping. Resume later with: "
                        f"python boxscore_sync.py {season} {position}"
                    )
                    break
                time.sleep(10)
                continue

            for _, row in df.iterrows():
                # Player_ID comes back fixed-width and padded with trailing
                # whitespace (e.g. "P007200   ") — strip before matching
                # against players.code, or every lookup silently misses.
                raw_player_code = row["Player_ID"].strip()
                player_code = (
                    raw_player_code[1:] if raw_player_code.startswith("P") else raw_player_code
                )
                player_id = player_ids_by_code.get(player_code)
                if player_id is None:
                    skipped_no_player += 1
                    continue

                cur.execute(
                    """
                    INSERT INTO player_game_stats (
                        player_id, game_id, is_starter, minutes, points,
                        field_goals_made_2, field_goals_attempted_2,
                        field_goals_made_3, field_goals_attempted_3,
                        free_throws_made, free_throws_attempted,
                        offensive_rebounds, defensive_rebounds, rebounds,
                        assists, steals, turnovers, blocks_favour,
                        blocks_against, fouls_committed, fouls_received,
                        valuation, plus_minus
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    ON CONFLICT (player_id, game_id) DO UPDATE SET
                        minutes = EXCLUDED.minutes,
                        points = EXCLUDED.points,
                        valuation = EXCLUDED.valuation,
                        plus_minus = EXCLUDED.plus_minus
                    """,
                    (
                        player_id,
                        game_id,
                        bool(row["IsStarter"]) if row["IsStarter"] is not None else None,
                        parse_minutes(row["Minutes"]),
                        safe_int(row["Points"]),
                        safe_int(row["FieldGoalsMade2"]),
                        safe_int(row["FieldGoalsAttempted2"]),
                        safe_int(row["FieldGoalsMade3"]),
                        safe_int(row["FieldGoalsAttempted3"]),
                        safe_int(row["FreeThrowsMade"]),
                        safe_int(row["FreeThrowsAttempted"]),
                        safe_int(row["OffensiveRebounds"]),
                        safe_int(row["DefensiveRebounds"]),
                        safe_int(row["TotalRebounds"]),
                        safe_int(row["Assistances"]),
                        safe_int(row["Steals"]),
                        safe_int(row["Turnovers"]),
                        safe_int(row["BlocksFavour"]),
                        safe_int(row["BlocksAgainst"]),
                        safe_int(row["FoulsCommited"]),
                        safe_int(row["FoulsReceived"]),
                        safe_int(row["Valuation"]),
                        safe_int(row["Plusminus"]),
                    ),
                )
                rows_upserted += 1

            games_processed += 1
            conn.commit()  # commit per-game so a later crash doesn't lose earlier progress
            time.sleep(REQUEST_PACING_SECONDS)

    finally:
        cur.close()
        conn.close()

    return rows_upserted, skipped_no_player, games_processed, games_failed


if __name__ == "__main__":
    # Bumped from 2025 to 2026 on 2026-09-03 — see roster_sync.py's
    # identical fix for why a stale default silently overwrites correct
    # current-season data with the prior season's once a season transitions.
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2026
    start_index = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else None

    rows_upserted, skipped_no_player, games_processed, games_failed = sync_boxscores(
        season, start_index, limit
    )
    print(f"Processed {games_processed} games, synced {rows_upserted} box score rows.")
    print(f"Skipped {skipped_no_player} rows with unrecognized player codes.")
    if games_failed:
        print(f"Games that failed to fetch: {games_failed}")