"""
Backfills `players.position` from EuroLeague's official Guards/Forwards/
Centers grouping.

Unlike the other sync scripts here, this hits the v2 stats/players/leaders
REST endpoint directly with `requests` rather than going through the
euroleague-api package's PlayerStats.get_player_stats_leaders wrapper —
that wrapper's own type hints (`str | None`) only parse on Python 3.10+,
and this repo's sync-py venv is 3.9, so importing it raises a TypeError at
class-definition time before this script even gets a chance to call it.
The raw endpoint is a plain GET with query params, so there's nothing the
wrapper was actually saving us here.

`misc=Guards`/`Forwards`/`Centers` are non-overlapping and exhaustive over
the roster (verified 2026-08-25: 83+80+45 = 208, matching the then-current
player count with zero duplicate codes across groups) — no player is
"None of the above", so every player who has a season-stats row ends up
with a position.

Usage:
    python player_positions_sync.py [season]

    season   start year of the season, e.g. 2025 for 2025-26 (default 2025)

Requires DATABASE_URL in the environment (loaded from .env).
"""
import os
import sys

import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
BASE_URL = "https://api-live.euroleague.net"

POSITION_GROUPS = {
    "Guards": "Guard",
    "Forwards": "Forward",
    "Centers": "Center",
}


def season_code(season: int) -> str:
    return f"E{season}"


def fetch_position_group(misc: str, season: int) -> list[str]:
    resp = requests.get(
        f"{BASE_URL}/v2/competitions/E/stats/players/leaders",
        params={
            "category": "Valuation",
            "statisticMode": "PerGame",
            "limit": 300,
            "misc": misc,
            "seasonMode": "Single",
            "seasonCode": season_code(season),
        },
        timeout=30,
    )
    resp.raise_for_status()
    return [row["playerCode"] for row in resp.json()["data"]]


def sync_positions(season: int) -> tuple[int, int]:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    updated = 0
    unmatched = 0

    try:
        for misc, position in POSITION_GROUPS.items():
            codes = fetch_position_group(misc, season)
            cur.execute(
                "UPDATE players SET position = %s WHERE code = ANY(%s)",
                (position, codes),
            )
            matched = cur.rowcount
            updated += matched
            unmatched += len(codes) - matched
            print(f"{misc}: {len(codes)} codes from feed, {matched} matched a player row")

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    return updated, unmatched


if __name__ == "__main__":
    season_arg = int(sys.argv[1]) if len(sys.argv) > 1 else 2025
    total_updated, total_unmatched = sync_positions(season_arg)
    print(f"Done. {total_updated} players updated, {total_unmatched} feed codes had no matching player row.")
