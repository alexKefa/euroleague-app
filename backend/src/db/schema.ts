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
    // Advanced stats, from euroleague-api's `advanced` player-stats endpoint.
    effectiveFieldGoalPct: real("effective_field_goal_pct"),
    trueShootingPct: real("true_shooting_pct"),
    offensiveReboundPct: real("offensive_rebound_pct"),
    defensiveReboundPct: real("defensive_rebound_pct"),
    totalReboundPct: real("total_rebound_pct"),
    assistToTurnoverRatio: real("assist_to_turnover_ratio"),
    assistRatio: real("assist_ratio"),
    turnoverRatio: real("turnover_ratio"),
    twoPointAttemptRate: real("two_point_attempt_rate"),
    threePointAttemptRate: real("three_point_attempt_rate"),
    freeThrowRate: real("free_throw_rate"),
    possessionsPerGame: real("possessions_per_game"),
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
    // Opt-in: a legendary only shows up in the trade marketplace once its
    // owner explicitly flags it, rather than every collector's whole
    // legendary collection being publicly browsable by default. Reset to
    // false when a trade transfers the card (routes/trades.ts) — the new
    // owner hasn't opted their copy in.
    tradeable: boolean("tradeable").default(false).notNull(),
  },
  (table) => ({
    userCollectibleUnique: uniqueIndex("user_collectible_unique").on(table.userId, table.collectibleId),
  })
);

// One row per spin attempt — a ledger, same style as point_adjustments,
// rather than a stored "next spin at" balance. Eligibility is computed on
// read by comparing now() to the latest spunAt (see services/cards.ts).
// collectibleId is null when the spin found nothing left to win (the user
// already owns every legendary collectible).
export const wheelSpins = pgTable("wheel_spins", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  collectibleId: uuid("collectible_id").references(() => collectibles.id),
  spunAt: timestamp("spun_at", { withTimezone: true }).defaultNow().notNull(),
});

// Legendary-card payout for going 100% correct across every game in a
// round. One row per (user, season, round) — the unique index doubles as
// the idempotency guard so a round can only pay out once per user (see
// checkAndGrantRoundRewards in services/cards.ts). Round numbers reset
// every season (games.season), so round alone isn't a stable key — e.g.
// "round 1" exists in both 2025-26 and 2026-27. collectibleId is null when
// the round qualified but the user already owned every legendary.
export const roundRewards = pgTable(
  "round_rewards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    season: varchar("season", { length: 9 }).notNull(),
    round: integer("round").notNull(),
    collectibleId: uuid("collectible_id").references(() => collectibles.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    // Null until the user has actually been shown the "Perfect round!"
    // banner. Several other pages (inventory/store/packs) also hit the
    // summary endpoint that triggers the grant, purely to read points —
    // without this, whichever page loads first "eats" the one-shot
    // notification silently, and the user who actually earned it never
    // sees it. See checkAndGrantRoundRewards / POST /predictions/round-rewards/ack.
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (table) => ({
    userRoundRewardUnique: uniqueIndex("user_round_reward_unique").on(
      table.userId,
      table.season,
      table.round
    ),
  })
);

// Direct trade offers between two users, scoped to legendary collectibles
// only (the only tier that's ever "yours" without being purchasable — see
// collectibles.ts's redeem guard). Accepting one re-points the two
// matching userCollectibles rows' userId rather than moving any new kind
// of row, since ownership is still just that boolean-unlock table.
// Point-sink alternative to buying a specific card: spend points on a pack,
// get several random cards (duplicates allowed, unlike direct redeem/wheel).
// One row per pack purchase; the actual cards granted live in
// packOpeningResults, mirroring the ledger style of wheelSpins/roundRewards
// rather than trying to derive "what did this pack give me" after the fact.
export const packOpenings = pgTable("pack_openings", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  packType: varchar("pack_type", { length: 20 }).notNull(), // "starter" | "pro" | "elite"
  pointsCost: integer("points_cost").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
});

// One row per card rolled in a pack. wasDuplicate is decided at roll time
// (did the user already own this collectible?) — duplicates aren't inserted
// into userCollectibles again (nothing to gain from a second copy), but the
// roll is still recorded so the user can cash it in via POST
// /packs/results/:id/sell. soldForPoints stays null until they do, and that
// null-check is what stops the same duplicate being sold twice.
export const packOpeningResults = pgTable("pack_opening_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  packOpeningId: uuid("pack_opening_id").notNull().references(() => packOpenings.id),
  collectibleId: uuid("collectible_id").notNull().references(() => collectibles.id),
  wasDuplicate: boolean("was_duplicate").notNull(),
  soldForPoints: integer("sold_for_points"),
});

export const tradeOffers = pgTable("trade_offers", {
  id: uuid("id").defaultRandom().primaryKey(),
  fromUserId: uuid("from_user_id").notNull().references(() => users.id),
  toUserId: uuid("to_user_id").notNull().references(() => users.id),
  requestedCollectibleId: uuid("requested_collectible_id").notNull().references(() => collectibles.id),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | accepted | declined | cancelled
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
});

// The many side of a many-for-one trade — one row per card the sender is
// putting up in exchange for the offer's single requestedCollectibleId.
export const tradeOfferItems = pgTable(
  "trade_offer_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tradeOfferId: uuid("trade_offer_id").notNull().references(() => tradeOffers.id),
    collectibleId: uuid("collectible_id").notNull().references(() => collectibles.id),
  },
  (table) => ({
    tradeOfferItemUnique: uniqueIndex("trade_offer_item_unique").on(table.tradeOfferId, table.collectibleId),
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

export const wheelSpinsRelations = relations(wheelSpins, ({ one }) => ({
  user: one(users, { fields: [wheelSpins.userId], references: [users.id] }),
  collectible: one(collectibles, { fields: [wheelSpins.collectibleId], references: [collectibles.id] }),
}));

export const roundRewardsRelations = relations(roundRewards, ({ one }) => ({
  user: one(users, { fields: [roundRewards.userId], references: [users.id] }),
  collectible: one(collectibles, { fields: [roundRewards.collectibleId], references: [collectibles.id] }),
}));

export const packOpeningsRelations = relations(packOpenings, ({ one, many }) => ({
  user: one(users, { fields: [packOpenings.userId], references: [users.id] }),
  results: many(packOpeningResults),
}));

export const packOpeningResultsRelations = relations(packOpeningResults, ({ one }) => ({
  packOpening: one(packOpenings, {
    fields: [packOpeningResults.packOpeningId],
    references: [packOpenings.id],
  }),
  collectible: one(collectibles, { fields: [packOpeningResults.collectibleId], references: [collectibles.id] }),
}));

export const tradeOffersRelations = relations(tradeOffers, ({ one, many }) => ({
  fromUser: one(users, {
    fields: [tradeOffers.fromUserId],
    references: [users.id],
    relationName: "tradeOffersFrom",
  }),
  toUser: one(users, {
    fields: [tradeOffers.toUserId],
    references: [users.id],
    relationName: "tradeOffersTo",
  }),
  items: many(tradeOfferItems),
  requestedCollectible: one(collectibles, {
    fields: [tradeOffers.requestedCollectibleId],
    references: [collectibles.id],
    relationName: "tradeOffersRequested",
  }),
}));

export const tradeOfferItemsRelations = relations(tradeOfferItems, ({ one }) => ({
  tradeOffer: one(tradeOffers, {
    fields: [tradeOfferItems.tradeOfferId],
    references: [tradeOffers.id],
  }),
  collectible: one(collectibles, {
    fields: [tradeOfferItems.collectibleId],
    references: [collectibles.id],
  }),
}));