"""
Pulls shot-by-shot (x/y coordinate) data for every completed game, one game
at a time with controlled pacing between requests — same rate-limited
`live.euroleague.net` origin as boxscore_sync.py's `/api/Boxscore` (this
endpoint is `/api/Points`), so this reuses that script's pacing/backoff
approach rather than firing requests unpaced.

Free throws come back from the feed too but with COORD_X/COORD_Y == -1 (no
court position) — skipped at sync time, this table is spatial field-goal
data only.

Usage:
    python shot_sync.py [season] [team_code] [start_index] [limit]

    season       start year of the season (default 2025)
    team_code    optional 3-letter team code (e.g. "PAN") to scope the sync
                 to just that team's games, instead of the whole season —
                 useful for trying this out against one team/player first
                 without a full-league backfill
    start_index  resume from this position in the (filtered) games list
                 (default 0)
    limit        max games to process this run (default: all remaining)
"""
import os
import sys
import time
from typing import Optional

import psycopg2
from dotenv import load_dotenv
from euroleague_api.shot_data import ShotData

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
REQUEST_PACING_SECONDS = 1.0

# Only these count as actual shot attempts with a real court position —
# ShotData also returns free throws (FTM/FTA) with COORD_X/Y == -1.
FIELD_GOAL_ACTIONS = {"2FGM", "2FGA", "3FGM", "3FGA"}


def sync_shots(
    season: int,
    team_code: Optional[str] = None,
    start_index: int = 0,
    limit: Optional[int] = None,
) -> tuple:
    sd = ShotData(competition="E")

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    cur.execute("SELECT code, id FROM players")
    player_ids_by_code = dict(cur.fetchall())

    cur.execute("SELECT code, id FROM teams")
    team_ids_by_code = dict(cur.fetchall())

    if team_code:
        cur.execute(
            """
            SELECT g.game_code, g.id FROM games g
            JOIN teams home ON g.home_team_id = home.id
            JOIN teams away ON g.away_team_id = away.id
            WHERE g.season = %s AND g.status = 'final'
              AND (home.code = %s OR away.code = %s)
            ORDER BY g.game_code
            """,
            (f"{season}-{str(season + 1)[2:]}", team_code, team_code),
        )
    else:
        cur.execute(
            "SELECT game_code, id FROM games WHERE season = %s AND status = 'final' ORDER BY game_code",
            (f"{season}-{str(season + 1)[2:]}",),
        )
    all_games = cur.fetchall()  # [(game_code, game_id), ...]

    games_to_process = all_games[start_index:]
    if limit is not None:
        games_to_process = games_to_process[:limit]

    rows_upserted = 0
    skipped_no_team = 0
    skipped_free_throw = 0
    games_processed = 0
    games_failed = []
    consecutive_failures = 0

    try:
        for i, (game_code, game_id) in enumerate(games_to_process):
            position = start_index + i
            try:
                df = sd.get_game_shot_data(season=season, gamecode=game_code)
                consecutive_failures = 0
            except Exception as exc:
                print(f"Game {game_code} (position {position}): fetch failed ({exc})")
                games_failed.append(game_code)
                consecutive_failures += 1
                if consecutive_failures >= 5:
                    print(
                        f"5 consecutive failures — stopping. Resume later with: "
                        f"python shot_sync.py {season} {team_code or ''} {position}"
                    )
                    break
                time.sleep(10)
                continue

            for _, row in df.iterrows():
                action_id = str(row["ID_ACTION"]).strip()
                if action_id not in FIELD_GOAL_ACTIONS:
                    skipped_free_throw += 1
                    continue

                team_code_row = str(row["TEAM"]).strip()
                team_id = team_ids_by_code.get(team_code_row)
                if team_id is None:
                    skipped_no_team += 1
                    continue

                # Player_ID comes back fixed-width and padded with trailing
                # whitespace (e.g. "P012774   ") — strip before matching
                # against players.code, same as boxscore_sync.py. Unmatched
                # is kept (not skipped) since the shot itself is still
                # useful team-level data — player_id just stays null.
                raw_player_code = str(row["ID_PLAYER"]).strip()
                player_code = raw_player_code[1:] if raw_player_code.startswith("P") else raw_player_code
                player_id = player_ids_by_code.get(player_code)

                zone = str(row["ZONE"]).strip() or None

                cur.execute(
                    """
                    INSERT INTO shot_events (
                        game_id, player_id, team_id, season, num_anot,
                        action_id, made, points, coord_x, coord_y, zone,
                        minute, fastbreak, second_chance
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (game_id, num_anot) DO NOTHING
                    """,
                    (
                        game_id,
                        player_id,
                        team_id,
                        f"{season}-{str(season + 1)[2:]}",
                        int(row["NUM_ANOT"]),
                        action_id,
                        action_id.endswith("M"),
                        int(row["POINTS"]),
                        int(row["COORD_X"]),
                        int(row["COORD_Y"]),
                        zone,
                        int(row["MINUTE"]) if row["MINUTE"] is not None else None,
                        str(row["FASTBREAK"]).strip() == "1",
                        str(row["SECOND_CHANCE"]).strip() == "1",
                    ),
                )
                rows_upserted += 1

            games_processed += 1
            conn.commit()  # commit per-game so a later crash doesn't lose earlier progress
            time.sleep(REQUEST_PACING_SECONDS)

    finally:
        cur.close()
        conn.close()

    return rows_upserted, skipped_no_team, skipped_free_throw, games_processed, games_failed


if __name__ == "__main__":
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2025
    team_code = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
    start_index = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    limit = int(sys.argv[4]) if len(sys.argv) > 4 else None

    rows_upserted, skipped_no_team, skipped_free_throw, games_processed, games_failed = sync_shots(
        season, team_code, start_index, limit
    )
    print(f"Processed {games_processed} games, synced {rows_upserted} shot rows.")
    print(f"Skipped {skipped_free_throw} free-throw rows and {skipped_no_team} rows with an unrecognized team code.")
    if games_failed:
        print(f"Games that failed to fetch: {games_failed}")
