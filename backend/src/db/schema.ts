import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  real,
  boolean,
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
  // No signup flow grants this — flip it by hand (e.g. via `db:studio`) for the first admin.
  isAdmin: boolean("is_admin").default(false).notNull(),
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

export const games = pgTable(
  "games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameCode: integer("game_code").notNull(), // per-season game code — NOT globally unique, see below
    season: varchar("season", { length: 9 }).notNull(), // "2025-26"
    homeTeamId: uuid("home_team_id").notNull().references(() => teams.id),
    awayTeamId: uuid("away_team_id").notNull().references(() => teams.id),
    tipoffAt: timestamp("tipoff_at", { withTimezone: true }).notNull(),
    round: integer("round"),
    status: varchar("status", { length: 20 }).default("scheduled").notNull(), // scheduled | live | final
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
  },
  (table) => ({
    // EuroLeague reuses game codes starting from 1 every season — game_code
    // alone is not a stable identity across seasons, only (season, game_code)
    // is. A prior single-column unique constraint here caused 2026-27 sync
    // to silently overwrite completed 2025-26 game results via game_code
    // collision. Fixed to the composite key that's actually unique.
    seasonGameCodeUnique: uniqueIndex("season_game_code_unique").on(table.season, table.gameCode),
  })
);

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

export const playerGameStats = pgTable(
  "player_game_stats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    playerId: uuid("player_id").notNull().references(() => players.id),
    gameId: uuid("game_id").notNull().references(() => games.id),
    isStarter: boolean("is_starter"),
    minutes: real("minutes"),
    points: integer("points"),
    fieldGoalsMade2: integer("field_goals_made_2"),
    fieldGoalsAttempted2: integer("field_goals_attempted_2"),
    fieldGoalsMade3: integer("field_goals_made_3"),
    fieldGoalsAttempted3: integer("field_goals_attempted_3"),
    freeThrowsMade: integer("free_throws_made"),
    freeThrowsAttempted: integer("free_throws_attempted"),
    offensiveRebounds: integer("offensive_rebounds"),
    defensiveRebounds: integer("defensive_rebounds"),
    rebounds: integer("rebounds"),
    assists: integer("assists"),
    steals: integer("steals"),
    turnovers: integer("turnovers"),
    blocksFavour: integer("blocks_favour"),
    blocksAgainst: integer("blocks_against"),
    foulsCommitted: integer("fouls_committed"),
    foulsReceived: integer("fouls_received"),
    valuation: integer("valuation"),
    plusMinus: integer("plus_minus"),
  },
  (table) => ({
    playerGameUnique: uniqueIndex("player_game_unique").on(table.playerId, table.gameId),
  })
);

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

export const newsArticles = pgTable("news_articles", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull().unique(),
  sourceName: text("source_name").notNull(), // e.g. "Eurohoops"
  sourceUrl: text("source_url").notNull(), // e.g. "https://www.eurohoops.net"
  summary: text("summary"), // short excerpt from the feed, never the full article
  imageUrl: text("image_url"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), // when we ingested it
});

export const predictions = pgTable(
  "predictions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    gameId: uuid("game_id").notNull().references(() => games.id),
    predictedWinnerTeamId: uuid("predicted_winner_team_id").notNull().references(() => teams.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // One pick per user per game — re-predicting updates it (allowed until
    // tipoff, enforced at the route level, not here).
    userGameUnique: uniqueIndex("user_game_prediction_unique").on(table.userId, table.gameId),
  })
);

// Manual point grants/deductions — layered on top of the picks-derived
// points at read time rather than mutating a stored balance, since there
// is no stored balance (see predictions.ts). Points may be negative.
export const pointAdjustments = pgTable("point_adjustments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  points: integer("points").notNull(),
  reason: text("reason").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Points reward-store catalog. imageUrl is optional — cards fall back to
// generated placeholder art (tier + team color) when it's null.
export const collectibles = pgTable("collectibles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(), // e.g. "Kendrick Nunn"
  teamId: uuid("team_id").notNull().references(() => teams.id),
  tier: varchar("tier", { length: 20 }).notNull(), // "common" | "rare" | "legendary"
  pointsCost: integer("points_cost").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userCollectibles = pgTable(
  "user_collectibles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    collectibleId: uuid("collectible_id").notNull().references(() => collectibles.id),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userCollectibleUnique: uniqueIndex("user_collectible_unique").on(table.userId, table.collectibleId),
  })
);

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

export const predictionsRelations = relations(predictions, ({ one }) => ({
  user: one(users, { fields: [predictions.userId], references: [users.id] }),
  game: one(games, { fields: [predictions.gameId], references: [games.id] }),
  predictedWinnerTeam: one(teams, {
    fields: [predictions.predictedWinnerTeamId],
    references: [teams.id],
  }),
}));

export const collectiblesRelations = relations(collectibles, ({ one, many }) => ({
  team: one(teams, { fields: [collectibles.teamId], references: [teams.id] }),
  unlockedBy: many(userCollectibles),
}));

export const userCollectiblesRelations = relations(userCollectibles, ({ one }) => ({
  user: one(users, { fields: [userCollectibles.userId], references: [users.id] }),
  collectible: one(collectibles, {
    fields: [userCollectibles.collectibleId],
    references: [collectibles.id],
  }),
}));