CREATE TABLE IF NOT EXISTS "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fcm_token" text NOT NULL,
	"platform" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_tokens_fcm_token_unique" UNIQUE("fcm_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "favorites" (
	"user_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_team_id_pk" PRIMARY KEY("user_id","team_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"tipoff_at" timestamp with time zone NOT NULL,
	"round" integer,
	"status" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"home_score" integer,
	"away_score" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_game_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"points" integer,
	"rebounds" integer,
	"assists" integer,
	"minutes" real,
	"plus_minus" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" varchar(20),
	"jersey_number" integer,
	"photo_url" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "team_season_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"season" varchar(9) NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"ppg" real,
	"papg" real,
	"off_rating" real,
	"def_rating" real,
	"reb_pct" real,
	"ast_pct" real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(10) NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"primary_color" varchar(7),
	"secondary_color" varchar(7),
	"logo_url" text,
	CONSTRAINT "teams_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"favorite_team_id" uuid,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "favorites" ADD CONSTRAINT "favorites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "team_season_stats" ADD CONSTRAINT "team_season_stats_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_favorite_team_id_teams_id_fk" FOREIGN KEY ("favorite_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "team_season_unique" ON "team_season_stats" USING btree ("team_id","season");