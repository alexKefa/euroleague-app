from euroleague_api.player_stats import PlayerStats

ps = PlayerStats(competition="E")
df = ps.get_player_stats_single_season(endpoint="traditional", season=2025)

print(df.shape)
print(df["player.team.code"].value_counts())