from euroleague_api.boxscore_data import BoxScoreData

bs = BoxScoreData(competition="E")
df = bs.get_players_boxscore_stats(season=2025, gamecode=1)

print(df.shape)
print(df.head(10))
print(df.columns.tolist())