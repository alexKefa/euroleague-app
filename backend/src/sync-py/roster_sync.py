"""
Syncs team rosters (player <-> team assignment, name, position, jersey
number) from EuroLeague's live club-roster endpoint, and upserts them into
`players`.

Why this exists separately from player_stats_sync.py: that script pulls
*season stats*, which the euroleague-api package only has for games that
have actually been played — for a freshly imported season with zero games
played yet (confirmed 2026-09-02: `python player_stats_sync.py 2026`
returned 0 rows), there's nothing for it to sync, so a team like Besiktas
Istanbul stays at 0 synced players all preseason even though its real
2026-27 squad is fully known. This script hits the roster endpoint directly
(same pattern as player_positions_sync.py hitting api-live.euroleague.net
for something the euroleague-api package doesn't wrap) instead, which is
populated as soon as clubs register their squads — confirmed working
2026-09-02 by fetching Besiktas's actual 2026-27 roster (14 players) even
though they have zero played-game stats.

Deliberately does NOT touch `players.photo_url` — this endpoint has no
photo field at all (checked directly: every entry's "images" key is `{}`),
photos only ever come from player_stats_sync.py's season-stats endpoint
once real games exist. Leaving photo_url out of the UPDATE SET clause
entirely (rather than setting it to NULL) preserves whatever photo a
returning player already has and leaves a new player's photo_url at its
column default (NULL) — which the frontend's jersey-number placeholder
(PlayerPhotoComponent) is exactly the fallback for.

Usage:
    python roster_sync.py [season]

    season   start year of the season, e.g. 2026 for 2026-27 (default 2025)

Requires teams to already be synced (via standings_sync.py) — loops over
every row already in `teams` and skips any whose code the feed doesn't
recognize for that season (e.g. a team no longer in the competition, like
last season's AS Monaco), rather than guessing at a team list of its own.

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


def season_code(season: int) -> str:
    return f"E{season}"


def parse_dorsal(dorsal: str | None) -> int | None:
    if not dorsal:
        return None
    try:
        return int(dorsal)
    except ValueError:
        return None


def fetch_club_roster(season: int, club_code: str) -> list[dict] | None:
    """Returns None (not []) on a non-200 response — lets the caller tell
    "this club has no roster in the feed for this season" apart from "the
    request itself failed", so a real HTTP error doesn't get silently
    counted the same as a legitimately empty/absent club."""
    resp = requests.get(
        f"{BASE_URL}/v2/competitions/E/seasons/{season_code(season)}/clubs/{club_code}/people",
        params={"type": "J"},
        timeout=30,
    )
    if resp.status_code != 200:
        return None
    # A brand-new signing can appear in the club roster before EuroLeague's
    # backoffice has assigned them an official player code (seen live:
    # "BESSON, HUGO" with person.code = null) — `players.code` is our
    # upsert key and NOT NULL, so there's nothing to match/insert against
    # yet. Skipped rather than crashing the whole sync; re-running this
    # script later (once the feed assigns a code) picks them up normally.
    return [
        {
            "code": entry["person"]["code"],
            "name": entry["person"]["name"],
            "position": entry.get("positionName"),
            "jerseyNumber": parse_dorsal(entry.get("dorsal")),
        }
        for entry in resp.json()
        if entry.get("typeName") == "Player" and entry.get("person", {}).get("code")
    ]


def sync_rosters(season: int) -> None:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    try:
        cur.execute("SELECT id, code, name FROM teams ORDER BY code")
        teams = cur.fetchall()

        total_upserted = 0
        teams_synced = 0
        teams_skipped: list[str] = []

        for team_id, team_code, team_name in teams:
            roster = fetch_club_roster(season, team_code)
            if roster is None:
                teams_skipped.append(team_code)
                continue

            for p in roster:
                cur.execute(
                    """
                    INSERT INTO players (code, team_id, name, position, jersey_number)
                    VALUES (%(code)s, %(team_id)s, %(name)s, %(position)s, %(jersey_number)s)
                    ON CONFLICT (code) DO UPDATE SET
                        team_id = EXCLUDED.team_id,
                        name = EXCLUDED.name,
                        position = EXCLUDED.position,
                        jersey_number = EXCLUDED.jersey_number
                    """,
                    {
                        "code": p["code"],
                        "team_id": team_id,
                        "name": p["name"],
                        "position": p["position"],
                        "jersey_number": p["jerseyNumber"],
                    },
                )
            total_upserted += len(roster)
            teams_synced += 1
            print(f"  {team_code:6s} {team_name:38s} {len(roster)} player(s)")

        conn.commit()
        print(f"\nDone — {total_upserted} player row(s) upserted across {teams_synced} team(s).")
        if teams_skipped:
            print(f"Skipped {len(teams_skipped)} team(s) not found in the {season_code(season)} feed: {', '.join(teams_skipped)}")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    season_arg = int(sys.argv[1]) if len(sys.argv) > 1 else 2025
    sync_rosters(season_arg)
