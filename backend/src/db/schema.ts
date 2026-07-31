import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  real,
  timestamp,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 10 }).notNull().unique(), // e.g. "OLY"
  name: text("name").notNull(),
  city: text("city"),
  primaryColor: varchar("primary_color", { length: 7 }), // "#DA1A32"
  secondaryColor: varchar("secondary_color", { length: 7 }),
  logoUrl: text("logo_url"),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  favoriteTeamId: uuid("favorite_team_id").references(() => teams.id),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const players = pgTable("players", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(), // stable player code from the feed
  teamId: uuid("team_id").notNull().references(() => teams.id),
  name: text("name").notNull(),
  position: varchar("position", { length: 20 }),
  jerseyNumber: integer("jersey_number"),
  photoUrl: text("photo_url"),
});

export const games = pgTable("games", {
  id: uuid("id").defaultRandom().primaryKey(),
  homeTeamId: uuid("home_team_id").notNull().references(() => teams.id),
  awayTeamId: uuid("away_team_id").notNull().references(() => teams.id),
  tipoffAt: timestamp("tipoff_at", { withTimezone: true }).notNull(),
  round: integer("round"),
  status: varchar("status", { length: 20 }).default("scheduled").notNull(), // scheduled | live | final
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
});

export const teamSeasonStats = pgTable(
  "team_season_stats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    season: varchar("season", { length: 9 }).notNull(), // "2025-26"
    position: integer("position"), // official standings rank, from the feed's `position` field
    wins: integer("wins").notNull(),
    losses: integer("losses").notNull(),
    ppg: real("ppg"),
    papg: real("papg"),
    offRating: real("off_rating"),
    defRating: real("def_rating"),
    rebPct: real("reb_pct"),
    astPct: real("ast_pct"),
  },
  (table) => ({
    teamSeasonUnique: uniqueIndex("team_season_unique").on(table.teamId, table.season),
  })
);

export const playerGameStats = pgTable("player_game_stats", {
  id: uuid("id").defaultRandom().primaryKey(),
  playerId: uuid("player_id").notNull().references(() => players.id),
  gameId: uuid("game_id").notNull().references(() => games.id),
  points: integer("points"),
  rebounds: integer("rebounds"),
  assists: integer("assists"),
  minutes: real("minutes"),
  plusMinus: integer("plus_minus"),
});

export const playerSeasonStats = pgTable(
  "player_season_stats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    playerId: uuid("player_id").notNull().references(() => players.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    season: varchar("season", { length: 9 }).notNull(), // "2025-26"
    gamesPlayed: integer("games_played"),
    minutesPerGame: real("minutes_per_game"),
    pointsPerGame: real("points_per_game"),
    reboundsPerGame: real("rebounds_per_game"),
    assistsPerGame: real("assists_per_game"),
    stealsPerGame: real("steals_per_game"),
    blocksPerGame: real("blocks_per_game"),
    turnoversPerGame: real("turnovers_per_game"),
    fieldGoalPct: real("field_goal_pct"),
    threePointPct: real("three_point_pct"),
    freeThrowPct: real("free_throw_pct"),
    valuation: real("valuation"), // PIR — EuroLeague's efficiency rating
  },
  (table) => ({
    playerSeasonUnique: uniqueIndex("player_season_unique").on(table.playerId, table.season),
  })
);

export const favorites = pgTable(
  "favorites",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.teamId] }),
  })
);

export const deviceTokens = pgTable("device_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  fcmToken: text("fcm_token").notNull().unique(),
  platform: varchar("platform", { length: 10 }), // "ios" | "android" | "web"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Relations — mainly so query.teams.findMany({ with: { ... } }) style
// lookups work without hand-written joins later.

export const teamsRelations = relations(teams, ({ many }) => ({
  players: many(players),
  seasonStats: many(teamSeasonStats),
  homeGames: many(games, { relationName: "homeTeam" }),
  awayGames: many(games, { relationName: "awayTeam" }),
  favoritedBy: many(favorites),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  favoriteTeam: one(teams, {
    fields: [users.favoriteTeamId],
    references: [teams.id],
  }),
  favorites: many(favorites),
  deviceTokens: many(deviceTokens),
}));

export const playersRelations = relations(players, ({ one, many }) => ({
  team: one(teams, { fields: [players.teamId], references: [teams.id] }),
  gameStats: many(playerGameStats),
  seasonStats: many(playerSeasonStats),
}));

export const gamesRelations = relations(games, ({ one, many }) => ({
  homeTeam: one(teams, {
    fields: [games.homeTeamId],
    references: [teams.id],
    relationName: "homeTeam",
  }),
  awayTeam: one(teams, {
    fields: [games.awayTeamId],
    references: [teams.id],
    relationName: "awayTeam",
  }),
  playerStats: many(playerGameStats),
}));

export const teamSeasonStatsRelations = relations(teamSeasonStats, ({ one }) => ({
  team: one(teams, { fields: [teamSeasonStats.teamId], references: [teams.id] }),
}));

export const playerGameStatsRelations = relations(playerGameStats, ({ one }) => ({
  player: one(players, { fields: [playerGameStats.playerId], references: [players.id] }),
  game: one(games, { fields: [playerGameStats.gameId], references: [games.id] }),
}));

export const playerSeasonStatsRelations = relations(playerSeasonStats, ({ one }) => ({
  player: one(players, { fields: [playerSeasonStats.playerId], references: [players.id] }),
  team: one(teams, { fields: [playerSeasonStats.teamId], references: [teams.id] }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, { fields: [favorites.userId], references: [users.id] }),
  team: one(teams, { fields: [favorites.teamId], references: [teams.id] }),
}));

export const deviceTokensRelations = relations(deviceTokens, ({ one }) => ({
  user: one(users, { fields: [deviceTokens.userId], references: [users.id] }),
}));