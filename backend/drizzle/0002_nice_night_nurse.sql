CREATE TABLE IF NOT EXISTS "player_season_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"season" varchar(9) NOT NULL,
	"games_played" integer,
	"minutes_per_game" real,
	"points_per_game" real,
	"rebounds_per_game" real,
	"assists_per_game" real,
	"steals_per_game" real,
	"blocks_per_game" real,
	"turnovers_per_game" real,
	"field_goal_pct" real,
	"three_point_pct" real,
	"free_throw_pct" real,
	"valuation" real
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "code" varchar(20) NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_season_stats" ADD CONSTRAINT "player_season_stats_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "player_season_unique" ON "player_season_stats" USING btree ("player_id","season");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_code_unique" UNIQUE("code");