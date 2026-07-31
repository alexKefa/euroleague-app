"""
Pulls EuroLeague standings via the euroleague-api package and upserts
them into the same Postgres tables the Node backend's Drizzle schema
defines (teams, team_season_stats).

Usage:
    python standings_sync.py [season] [round_number]

    season        start year of the season, e.g. 2025 for 2025-26 (default 2025)
    round_number  the round to pull standings as-of, e.g. 38 for the end
                  of a 38-round regular season (default 38)

Requires DATABASE_URL in the environment (loaded from .env via python-dotenv) —
the same Neon connection string the Node backend uses.
"""
import os
import sys

import psycopg2
from dotenv import load_dotenv
from euroleague_api.standings import Standings

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]


def season_label(season: int) -> str:
    """2025 -> '2025-26', matching team_season_stats.season in the Drizzle schema."""
    end_year = str(season + 1)[-2:]
    return f"{season}-{end_year}"


def sync_standings(season: int, round_number: int) -> tuple[int, int]:
    standings = Standings(competition="E")
    df = standings.get_standings(season=season, round_number=round_number)

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    season_ = season_label(season)
    teams_upserted = 0
    stats_upserted = 0

    try:
        for _, row in df.iterrows():
            code = row["club.code"]
            name = row["club.name"]

            cur.execute(
                """
                INSERT INTO teams (code, name)
                VALUES (%s, %s)
                ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
                RETURNING id
                """,
                (code, name),
            )
            team_id = cur.fetchone()[0]
            teams_upserted += 1

            games_played = int(row["gamesPlayed"])
            wins = int(row["gamesWon"])
            losses = int(row["gamesLost"])
            points_for = float(row["pointsFor"])
            points_against = float(row["pointsAgainst"])
            position = int(row["position"])
            ppg = points_for / games_played if games_played else None
            papg = points_against / games_played if games_played else None

            cur.execute(
                """
                INSERT INTO team_season_stats (team_id, season, position, wins, losses, ppg, papg)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (team_id, season) DO UPDATE
                SET position = EXCLUDED.position,
                    wins = EXCLUDED.wins,
                    losses = EXCLUDED.losses,
                    ppg = EXCLUDED.ppg,
                    papg = EXCLUDED.papg
                """,
                (team_id, season_, position, wins, losses, ppg, papg),
            )
            stats_upserted += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    return teams_upserted, stats_upserted


if __name__ == "__main__":
    season = int(sys.argv[1]) if len(sys.argv) > 1 else 2025
    round_number = int(sys.argv[2]) if len(sys.argv) > 2 else 38

    teams_upserted, stats_upserted = sync_standings(season, round_number)
    print(
        f"Synced {teams_upserted} teams, {stats_upserted} season-stat rows "
        f"for season {season}, round {round_number}."
    )