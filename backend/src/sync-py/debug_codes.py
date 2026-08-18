import os
import psycopg2
from dotenv import load_dotenv
from euroleague_api.boxscore_data import BoxScoreData

load_dotenv()
bs = BoxScoreData(competition="E")
df = bs.get_players_boxscore_stats_round(season=2025, round_number=2)

# Save immediately so we never need to re-fetch this just to debug matching.
df.to_csv("boxscore_round2_raw.csv", index=False)
print(f"Saved {len(df)} rows to boxscore_round2_raw.csv")

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
cur.execute("SELECT code FROM players")
db_codes = set(r[0] for r in cur.fetchall())

sample = df["Player_ID"].unique()[:10]
for pid in sample:
    stripped = pid[1:] if pid.startswith("P") else pid
    print(f"{pid!r} -> stripped {stripped!r} -> in DB? {stripped in db_codes}")