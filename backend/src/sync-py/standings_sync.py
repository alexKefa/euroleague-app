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

# NOT verified official club brand colors — I don't have a reliable source
# for all 20 clubs' real hex values and would rather not guess (got two
# team codes wrong earlier in this project from memory alone). This is a
# curated, visually distinct palette assigned by sync order, purely so
# each team looks different. Swap in real colors here once verified.
FALLBACK_PALETTE = [
    ("#C0272D", "#6E1015"),
    ("#1B4F91", "#0A2540"),
    ("#1E7A46", "#0B3D24"),
    ("#B8621B", "#5C310D"),
    ("#6A3FA0", "#34205A"),
    ("#1A7A8C", "#0C3C45"),
    ("#A02060", "#501030"),
    ("#4A4A4A", "#1E1E1E"),
    ("#C9A227", "#6B5510"),
    ("#2D6E4E", "#163A28"),
    ("#8C3B2E", "#451D17"),
    ("#2E5C8C", "#162D45"),
    ("#7A1E3D", "#3D0F1F"),
    ("#3E7C3F", "#1F3E20"),
    ("#9C4A9C", "#4E254E"),
    ("#1F5A5A", "#0F2D2D"),
    ("#B04A2E", "#582517"),
    ("#4A5C8C", "#252E45"),
    ("#7C6A2E", "#3E3517"),
    ("#5C2E5C", "#2E172E"),
]


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
        for i, (_, row) in enumerate(df.iterrows()):
            code = row["club.code"]
            name = row["club.name"]
            logo_url = row["club.images.crest"]
            primary_color, secondary_color = FALLBACK_PALETTE[i % len(FALLBACK_PALETTE)]

            cur.execute(
                """
                INSERT INTO teams (code, name, logo_url, primary_color, secondary_color)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (code) DO UPDATE
                SET name = EXCLUDED.name,
                    logo_url = EXCLUDED.logo_url,
                    primary_color = COALESCE(teams.primary_color, EXCLUDED.primary_color),
                    secondary_color = COALESCE(teams.secondary_color, EXCLUDED.secondary_color)
                RETURNING id
                """,
                (code, name, logo_url, primary_color, secondary_color),
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