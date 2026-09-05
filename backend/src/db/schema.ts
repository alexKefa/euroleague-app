import {
  pgTable,
  uuid,
  text,
  varchar,
  integer,
  real,
  doublePrecision,
  boolean,
  timestamp,
  primaryKey,
  uniqueIndex,
  jsonb,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const teams = pgTable("teams", {
  id: uuid("id").defaultRandom().primaryKey(),
  // The EuroLeague *feed's* internal club code (e.g. "BAS" for Baskonia) —
  // this is a real API parameter, not just a label: sync-py/roster_sync.py
  // sends it straight into a request URL
  // (`/clubs/{club_code}/people`), and standings_sync.py/games_sync.py
  // upsert ON CONFLICT(code) using whatever the feed itself calls each
  // club. Confirmed 2026-09-02 (directly hitting the API) that this can
  // differ from EuroLeague's own *public-site* abbreviation for the same
  // club (KBA does not exist as an API club code at all, only BAS does) —
  // never rename this to match the website, or every sync for that team
  // silently breaks/skips going forward. The website-matching abbreviation
  // is a frontend-only presentation concern instead — see
  // frontend/src/app/shared/team-display-code.ts — since threading a
  // second code through every one of this field's ~45 template call sites
  // would be a much bigger change for the same outcome.
  code: varchar("code", { length: 10 }).notNull().unique(), // e.g. "OLY"
  name: text("name").notNull(),
  city: text("city"),
  primaryColor: varchar("primary_color", { length: 7 }), // "#DA1A32"
  secondaryColor: varchar("secondary_color", { length: 7 }),
  logoUrl: text("logo_url"),
  // "SURNAME, First" raw off the feed, same untitled format as players.name
  // — see roster_sync.py's Coach-entry handling. Null until roster_sync.py
  // has run for a team, or if EuroLeague's feed has no Coach entry for it.
  headCoach: text("head_coach"),
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  // Shown everywhere a person's identity appears publicly (leaderboards,
  // trades, league rosters) instead of the email's local part, which used
  // to leak part of a real address to strangers. Auto-generated at
  // registration (services/username.ts's createUniqueUsername, "clutch-user-######")
  // rather than chosen — nothing in the product asks a new user to pick one
  // yet, so every account gets a placeholder identity for free. Existing
  // pre-username accounts were backfilled the same way in a one-off pass
  // (scripts/backfill-usernames.ts), not derived from their email.
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  favoriteTeamId: uuid("favorite_team_id").references(() => teams.id),
  avatarUrl: text("avatar_url"),
  // No signup flow grants this — flip it by hand (e.g. via `db:studio`) for the first admin.
  isAdmin: boolean("is_admin").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),

  // Referrals — every user gets a code (generated at registration,
  // routes/auth.ts) whether or not they used someone else's; shared as
  // ?ref=<code> on the register page. referredByUserId is set once, at
  // registration, from a valid code in the request. referralRewardGranted
  // flips true the first time the *referred* user's own first correct
  // prediction resolves (checked opportunistically alongside round rewards
  // — see services/cards.ts) — the guard against granting the referrer's
  // bonus more than once for the same referred friend.
  referralCode: varchar("referral_code", { length: 10 }),
  referredByUserId: uuid("referred_by_user_id").references((): AnyPgColumn => users.id),
  referralRewardGranted: boolean("referral_reward_granted").default(false).notNull(),

  // Up to MAX_SHOWCASE_CARDS (routes/users.ts) collectible ids this user has
  // chosen to display next to their name on a league leaderboard
  // (routes/leagues.ts) — purely cosmetic, doesn't need to be owned
  // long-term to keep showing (a traded-away card just silently stops
  // resolving, same "best-effort" spirit as a stale wishlist entry).
  showcaseCollectibleIds: jsonb("showcase_collectible_ids").notNull().default([]).$type<string[]>(),
});

export const players = pgTable("players", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(), // stable player code from the feed
  // "Current" team per roster_sync.py's own upsert, but only ever moved
  // *forward* to wherever a still-active player's current-season roster
  // fetch places them — a player who drops off every 2026-27 roster
  // entirely (retired, left for a non-EuroLeague league) keeps whatever
  // team_id they last had, since it can't be null (NOT NULL FK) and can't
  // be deleted without breaking the NOT NULL playerGameStats/
  // playerSeasonStats FKs to their real season history. `active` (below)
  // is what actually says whether they still belong on that team's roster.
  teamId: uuid("team_id").notNull().references(() => teams.id),
  name: text("name").notNull(),
  position: varchar("position", { length: 20 }),
  jerseyNumber: integer("jersey_number"),
  photoUrl: text("photo_url"),
  // False once roster_sync.py's current-season fetch no longer lists this
  // player on ANY team's roster (found 2026-09-03: departed players like
  // Cedi Osman off Panathinaikos's real 2026-27 roster kept showing on its
  // roster page forever, since nothing ever un-set their stale team_id —
  // the sync only ever upserted players still present in a fetch, never
  // reacted to one disappearing). Roster-listing routes should filter on
  // this; stat/history routes keyed by season shouldn't, since a departed
  // player's real past-season numbers are still real.
  active: boolean("active").default(true).notNull(),
});

// Admin-entered, not synced — EuroLeague's own feed (euroleague-api) has no
// injury endpoint at all, unlike everything else this app pulls in. One row
// per currently-injured player (playerId unique — a fresh admin write
// overwrites the prior report rather than accumulating a history), so
// "healthy" is just "no row here" rather than a status value. Cleared by
// deleting the row (routes/injuries.ts's DELETE), not by writing an
// "available" status.
export const playerInjuries = pgTable("player_injuries", {
  id: uuid("id").defaultRandom().primaryKey(),
  playerId: uuid("player_id")
    .notNull()
    .unique()
    .references(() => players.id),
  status: varchar("status", { length: 20 }).notNull(), // "out" | "doubtful" | "questionable" | "probable"
  note: text("note"),
  updatedByUserId: uuid("updated_by_user_id").notNull().references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
    // Only ever populated while status is "live" — null for scheduled/final
    // (a real feed will source these; today only liveScoreSimulator.ts
    // writes them, derived from its own compressed tick timeline — see the
    // comment there). quarter: 1-4 regulation (overtime not modeled by the
    // simulator yet). gameClockSeconds: seconds left in that quarter.
    quarter: integer("quarter"),
    gameClockSeconds: integer("game_clock_seconds"),
    // YouTube video ID (not a full URL) for this game's official highlight
    // reel, e.g. "MDWcq_KCkzY" — admin-set for now (PATCH /api/games/:id/
    // highlight, mirrors collectibles' admin imageUrl pattern) since there's
    // no sync source that maps a game to its highlight video yet.
    highlightVideoId: varchar("highlight_video_id", { length: 32 }),
    // Straight from the feed's own `venue.name` (games_sync.py) — e.g.
    // "ASTROBALLE". Not previously persisted even though the raw feed
    // response already carries a full venue object (name, code, capacity,
    // address); only the name is surfaced today, nothing else is needed yet.
    venueName: varchar("venue_name", { length: 120 }),
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

// A one-time betting-odds snapshot for a game, captured by
// sync/oddsSync.ts while the game is still `scheduled` — inserted once and
// never updated, which *is* the "fixed snapshot before tipoff" (see
// services/points.ts's pointsForCorrectPick): every user who picked that
// game is scored against the same number regardless of later line
// movement, and the sync job never re-spends odds-API quota re-fetching a
// game it already captured (it only queries for games missing a row here).
// home/awayFairProb are de-vigged (bookmaker margin removed, so the pair
// sums to 1) implied win probabilities averaged across every bookmaker the
// odds API returned for that game. No row at all for a game (API
// down/quota exhausted/game outside the sync window) means
// pointsForCorrectPick() falls back to the flat POINTS_PER_CORRECT rate —
// this table is a bonus signal, never a scoring dependency.
export const gameOdds = pgTable("game_odds", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id")
    .notNull()
    .unique()
    .references(() => games.id),
  // double precision, not real (float4) — the scoring formula
  // (services/points.ts) does all its arithmetic in float8 to match JS's
  // own number type exactly; widening a float4 column value up to float8
  // for that arithmetic doesn't reproduce the same bits as a float8
  // literal would, which was enough to disagree with the JS-side formula
  // by ±1 point right at a x.5 rounding boundary (caught by testing the
  // SQL and JS implementations against the same input and finding they
  // disagreed at fairProb=0.05 specifically).
  homeFairProb: doublePrecision("home_fair_prob").notNull(),
  awayFairProb: doublePrecision("away_fair_prob").notNull(),
  bookmakerCount: integer("bookmaker_count").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
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

// One row per field-goal attempt, from EuroLeague's live shot-by-shot feed
// (`https://live.euroleague.net/api/Points`, wrapped by euroleague-api's
// ShotData class — see backend/src/sync-py/shot_sync.py). Free throws come
// back from that feed too but with coordX/coordY == -1 (no court position),
// so they're filtered out at sync time — this table is spatial shot data
// only, not a full play-by-play log.
export const shotEvents = pgTable(
  "shot_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id").notNull().references(() => games.id),
    playerId: uuid("player_id").references(() => players.id), // nullable — see shot_sync.py's player-code matching note
    teamId: uuid("team_id").notNull().references(() => teams.id),
    season: varchar("season", { length: 9 }).notNull(), // "2025-26" — denormalized for a season-scoped query without a games join
    numAnot: integer("num_anot").notNull(), // the feed's own event sequence number within the game — this row's natural key alongside gameId
    actionId: varchar("action_id", { length: 10 }).notNull(), // "2FGM" | "2FGA" | "3FGM" | "3FGA"
    made: boolean("made").notNull(),
    points: integer("points").notNull(),
    coordX: integer("coord_x").notNull(),
    coordY: integer("coord_y").notNull(),
    zone: varchar("zone", { length: 4 }),
    minute: integer("minute"),
    fastbreak: boolean("fastbreak").notNull().default(false),
    secondChance: boolean("second_chance").notNull().default(false),
  },
  (table) => ({
    gameEventUnique: uniqueIndex("shot_events_game_event_unique").on(table.gameId, table.numAnot),
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
    // Usage% — NOT part of euroleague-api's `advanced` endpoint (checked
    // directly: it has no usage field at all), so unlike everything else in
    // this block it isn't synced verbatim. Computed instead from
    // `player_game_stats`' raw per-game box score columns via the standard
    // formula, by sync-py/player_stats_sync.py's own SQL after the
    // traditional/advanced upsert loop — see the comment there for the
    // per-game team-total join and its accuracy caveat for traded players.
    usagePercentage: real("usage_percentage"),
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
  // "en" | "el" — which of a feed's language-specific RSS URLs this came
  // from (e.g. eurohoops.net/en/feed vs /el/feed), not detected from the
  // text. A source with no language split of its own (SDNA) is tagged with
  // whichever language it actually publishes in, same as any other feed.
  lang: varchar("lang", { length: 5 }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(), // when we ingested it
});

// One row per sync job (id is a fixed key, e.g. "news"), upserted every run
// so the frontend can show "updated N minutes ago" — separate from
// newsArticles.publishedAt, which reflects the article's own publish time,
// not whether we've actually checked the feed recently (a quiet news day
// with no new articles would otherwise look identical to a broken sync).
export const syncState = pgTable("sync_state", {
  id: varchar("id", { length: 40 }).primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
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
  // False only on the pack-purchase-cost row (routes/packs.ts) — spending
  // points shouldn't lower a predictor's leaderboard rank, since points are
  // a real currency (packs) as well as a prediction score. Everything else
  // (welcome/referral bonus, duplicate-card sell-back credit, an admin's
  // manual grant *or* penalty) still counts, so an admin can still actually
  // dock someone's rank if that's ever needed. getUserPoints() (the
  // spendable balance shown on Store/Packs/Wheel) ignores this column
  // entirely and keeps summing every row — spending still has to reduce
  // what you can afford, just not your rank.
  countsTowardRanking: boolean("counts_toward_ranking").default(true).notNull(),
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
    // Optional, listing-scoped: other legendary collectible ids this owner
    // would accept in return, shown in the marketplace so a browser isn't
    // guessing what to offer. Purely informational — POST /trades still
    // accepts any combination of the offerer's legendaries, this is never
    // enforced server-side. Reset to [] alongside tradeable when a trade
    // transfers the card, same reasoning: the new owner hasn't stated one.
    wishlist: jsonb("wishlist").notNull().default([]).$type<string[]>(),
    // Cosmetic-only flourish rolled once, at first acquisition, for a
    // legendary slot in rollPackForUser (services/packs.ts) — never rolled
    // again for a later duplicate pull (that path never touches this row,
    // see the newlyOwnedIds-only insert in routes/packs.ts) and carries no
    // gameplay weight: same album-completion credit, same forceNewLegendary
    // guarantee, same trade eligibility as "standard". Exists so two
    // marketplace listings of the same legendary aren't perfectly
    // interchangeable — see the trades.ts marketplace comment. Always
    // "standard" for common/rare; the column isn't tier-scoped in the DB
    // since every row already carries a default that's correct for them.
    finish: varchar("finish", { length: 20 }).default("standard").notNull(),
  },
  (table) => ({
    userCollectibleUnique: uniqueIndex("user_collectible_unique").on(table.userId, table.collectibleId),
  })
);

// Pack pity timer: consecutive-duplicate streak per tier (common/rare —
// legendary deliberately excluded, it should always stay pure luck). Reset
// to 0 whenever a pack roll of that tier lands a genuinely new card;
// incremented on a duplicate. Once a streak reaches services/packs.ts's
// PITY_THRESHOLD, the next roll of that tier is forced to a card the user
// doesn't yet own instead of a fully random pick from the tier. One row
// per user, upserted in the same transaction as the rest of a pack-opening
// outcome (routes/packs.ts) so it can never drift out of sync with what
// was actually rolled.
export const pityCounters = pgTable("pity_counters", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  commonStreak: integer("common_streak").default(0).notNull(),
  rareStreak: integer("rare_streak").default(0).notNull(),
  // Consecutive Elite-pack opens whose "big slot" (the one slot carrying
  // both legendary and coach odds) landed on rare instead — see
  // ELITE_BIG_SLOT_PITY_THRESHOLD in services/packs.ts. Unlike
  // commonStreak/rareStreak (which just avoid a duplicate), tripping this
  // forces the slot itself onto legendary or coach, since a rare/common
  // pity streak never helps a tier the slot can't even normally land on
  // without one already dominating the roll.
  eliteBigSlotStreak: integer("elite_big_slot_streak").default(0).notNull(),
});

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
    // Unused by new grants as of the 2026-08-26 "reward a pack, not a card"
    // pass (see ownedPackId below) — left in place rather than dropped,
    // since existing historical rows from before that pass still carry it.
    collectibleId: uuid("collectible_id").references(() => collectibles.id),
    // The unopened pack this reward actually grants — wheelLegendary for a
    // perfect round, wheelPro for a "great" one — same concept as a wheel
    // win: it sits in ownedPacks until the user opens it themselves from
    // the Packs page, rather than instantly handing over a specific card.
    ownedPackId: uuid("owned_pack_id").references(() => ownedPacks.id),
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

// Career-wide (not per-round, not per-season) legendary reward: every
// LEGENDARY_MILESTONE_INTERVAL cumulative correct predictions a user has
// ever made grants one. milestoneNumber (1st, 2nd, ...) rather than a raw
// correct-pick count is the claim key — same "insert as a mutex, ignore the
// conflict" idempotency pattern as roundRewards/referralRewardGranted, just
// keyed on an ever-increasing counter instead of (season, round). Exists
// because at realistic (<100%) daily wheel engagement, legendary was found
// to be the tightest bottleneck on finishing the album — see
// scripts/season-simulation.ts and the "album completable" note in
// services/cards.ts — and unlike the wheel, this only accrues from picks
// actually gotten right.
export const legendaryMilestones = pgTable(
  "legendary_milestones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    milestoneNumber: integer("milestone_number").notNull(),
    // Unused by new grants as of the 2026-08-26 "reward a pack, not a card"
    // pass — see roundRewards.ownedPackId's comment, same reasoning here.
    collectibleId: uuid("collectible_id").references(() => collectibles.id),
    ownedPackId: uuid("owned_pack_id").references(() => ownedPacks.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    // Same "not shown yet" purpose as roundRewards.seenAt.
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (table) => ({
    userMilestoneUnique: uniqueIndex("user_legendary_milestone_unique").on(
      table.userId,
      table.milestoneNumber
    ),
  })
);

// Exact structural mirror of legendaryMilestones — a separate table rather
// than a shared "tier" column, since the two tracks accrue on independent
// counters (see COACH_MILESTONE_INTERVAL in services/cards.ts) and this
// keeps each track's own claim/mutex index simple. Added 2026-09-04:
// legendary and great/perfect-round rewards were the only non-wheel,
// non-elite-pack-luck path to a legendary; coach had none at all until this
// gave it its own parallel milestone track.
export const coachMilestones = pgTable(
  "coach_milestones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    milestoneNumber: integer("milestone_number").notNull(),
    collectibleId: uuid("collectible_id").references(() => collectibles.id),
    ownedPackId: uuid("owned_pack_id").references(() => ownedPacks.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (table) => ({
    userMilestoneUnique: uniqueIndex("user_coach_milestone_unique").on(
      table.userId,
      table.milestoneNumber
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

// A pack the user has won but not yet opened — currently only ever granted
// by the wheel (routes/spin.ts), which now hands over an unopened pack
// instead of rolling a card on the spot. Purchased packs (routes/packs.ts's
// POST /:type/open) still open immediately and never create a row here.
// openedAt starts null; POST /packs/owned/:id/open claims it (conditional
// UPDATE ... WHERE opened_at IS NULL, same claim-first pattern as
// roundRewards/referralRewardGranted) then rolls the actual card the same
// way a purchase does.
export const ownedPacks = pgTable("owned_packs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  packType: varchar("pack_type", { length: 20 }).notNull(),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }).defaultNow().notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  // Admin-only debug knob (routes/spin.ts's POST /cheat-foil) — forces
  // rollPackForUser's legendary slot to land "foil" instead of rolling
  // FOIL_CHANCE, so the "pull 100% foil" cheat button doesn't just resolve
  // to a coin flip on open like a real pull would. Always false for every
  // real grant (purchase, real spin, round/milestone rewards).
  forceFoil: boolean("force_foil").default(false).notNull(),
});

// One-off marketing campaigns (e.g. a link in a YouTube video description),
// redeemed at registration only — same "apply once at signup" shape as
// users.referralCode, but this rewards the *new* user directly (an unopened
// pack + optional bonus points) rather than whoever shared the link.
// `active` is a manual on/off switch for ending a campaign without deleting
// its history/redemption count; maxRedemptions/expiresAt are independent
// optional caps (either or both null = uncapped). See
// services/promoCodes.ts for the atomic claim-and-grant logic.
export const promoCodes = pgTable("promo_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  packType: varchar("pack_type", { length: 20 }).notNull(),
  bonusPoints: integer("bonus_points").default(0).notNull(),
  maxRedemptions: integer("max_redemptions"),
  redemptionCount: integer("redemption_count").default(0).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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

// Private friend groups, ranked by the same lifetime prediction points as
// the global leaderboard (services/leaderboard.ts's getLeaderboardEntries,
// just scoped to a member list instead of the whole user base) — no
// separate points/scoring concept of its own. code is a short, shareable
// invite code (services/leagues.ts's createUniqueLeagueCode, same
// alphabet/length as users.referralCode) rather than a raw league id, so an
// invite link/code is short enough to read aloud or type by hand.
export const leagues = pgTable("leagues", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// The creator is just the first row here (inserted alongside the league
// itself) — no separate "owner" concept beyond leagues.createdByUserId,
// and no v1 delete/kick, only join (POST /leagues/join) and leave (POST
// /leagues/:id/leave).
export const leagueMembers = pgTable(
  "league_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    leagueId: uuid("league_id").notNull().references(() => leagues.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    leagueMemberUnique: uniqueIndex("league_member_unique").on(table.leagueId, table.userId),
  })
);

// A user's saved custom stat table — which players and which
// playerSeasonStats columns to show, plus how to sort it. Free (not
// points-gated — considered and deliberately dropped), capped at 5 per
// user (enforced in routes/analyticsViews.ts, not here). Deliberately just
// a saved *projection* over data already served by GET
// /api/players/advanced-stats — no new stats endpoint, this table only
// stores which rows/columns of that existing payload to show.
export const analyticsViews = pgTable("analytics_views", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  playerIds: jsonb("player_ids").notNull().$type<string[]>(),
  columns: jsonb("columns").notNull().$type<string[]>(),
  // User-defined "spreadsheet cell" columns — {id, label, expression}, e.g.
  // {label: "Scoring Load", expression: "pointsPerGame + assistsPerGame * 1.5"}.
  // Evaluated entirely client-side (features/analytics-builder/formula.ts)
  // against the same advanced-stats fields `columns` picks from — this
  // table only stores the definition, never a computed value, same spirit
  // as `columns` storing keys rather than snapshotted numbers.
  customColumns: jsonb("custom_columns")
    .notNull()
    .default([])
    .$type<{ id: string; label: string; expression: string }[]>(),
  sortKey: varchar("sort_key", { length: 40 }),
  sortDesc: boolean("sort_desc").default(true).notNull(),
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
  injury: one(playerInjuries, { fields: [players.id], references: [playerInjuries.playerId] }),
}));

export const playerInjuriesRelations = relations(playerInjuries, ({ one }) => ({
  player: one(players, { fields: [playerInjuries.playerId], references: [players.id] }),
  updatedByUser: one(users, { fields: [playerInjuries.updatedByUserId], references: [users.id] }),
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
  odds: one(gameOdds, { fields: [games.id], references: [gameOdds.gameId] }),
}));

export const gameOddsRelations = relations(gameOdds, ({ one }) => ({
  game: one(games, { fields: [gameOdds.gameId], references: [games.id] }),
}));

export const teamSeasonStatsRelations = relations(teamSeasonStats, ({ one }) => ({
  team: one(teams, { fields: [teamSeasonStats.teamId], references: [teams.id] }),
}));

export const playerGameStatsRelations = relations(playerGameStats, ({ one }) => ({
  player: one(players, { fields: [playerGameStats.playerId], references: [players.id] }),
  game: one(games, { fields: [playerGameStats.gameId], references: [games.id] }),
}));

export const shotEventsRelations = relations(shotEvents, ({ one }) => ({
  player: one(players, { fields: [shotEvents.playerId], references: [players.id] }),
  game: one(games, { fields: [shotEvents.gameId], references: [games.id] }),
  team: one(teams, { fields: [shotEvents.teamId], references: [teams.id] }),
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

export const legendaryMilestonesRelations = relations(legendaryMilestones, ({ one }) => ({
  user: one(users, { fields: [legendaryMilestones.userId], references: [users.id] }),
  collectible: one(collectibles, { fields: [legendaryMilestones.collectibleId], references: [collectibles.id] }),
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

export const leaguesRelations = relations(leagues, ({ one, many }) => ({
  createdByUser: one(users, { fields: [leagues.createdByUserId], references: [users.id] }),
  members: many(leagueMembers),
}));

export const leagueMembersRelations = relations(leagueMembers, ({ one }) => ({
  league: one(leagues, { fields: [leagueMembers.leagueId], references: [leagues.id] }),
  user: one(users, { fields: [leagueMembers.userId], references: [users.id] }),
}));

// Fantasy Five — a parallel, budget-cap fantasy squad mode alongside
// predictions, added to compete with EuroLeague Fantasy's own core mechanic
// directly rather than just accumulating around it. One row per (player,
// season): the credit cost of drafting that player into a lineup, computed
// from their rolling season PIR by scripts/reprice-fantasy-players.ts (run
// manually, same cadence as sync:*/economy:* scripts — not a cron). A
// player with no playerSeasonStats row yet (new/rookie, no games played
// this season) still gets a row, floored at MIN_PRICE, so they're always
// selectable in the roster builder.
export const playerFantasyPrices = pgTable(
  "player_fantasy_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    playerId: uuid("player_id").notNull().references(() => players.id),
    season: varchar("season", { length: 9 }).notNull(),
    price: integer("price").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    playerFantasySeasonUnique: uniqueIndex("player_fantasy_season_unique").on(table.playerId, table.season),
  })
);

// A user's fantasy lineup for one round — one row per player currently in
// that round's 5-player squad. A round's rows are wholesale-replaced
// (delete + multi-row insert in one transaction, routes/fantasy.ts) rather
// than diffed like predictions, since a lineup is always exactly 5 fixed
// slots, not an open-ended list. Editable until the round *locks* — the
// earliest tipoffAt among that round's games (services/fantasyScoring.ts's
// getRoundLockTime) — same "whole gameweek locks at the first game" rule
// real fantasy uses, enforced at the route level like predictions'
// before-tipoff window, not here. Once locked, a round's rows are never
// touched again — the historical record scoring reads directly, same
// "insert once, source of truth forever" spirit as game_odds. Scoring
// (getFantasyLeaderboardEntries) sums playerGameStats.valuation for each
// locked player's final games that round, captain doubled — an unplayed
// game contributes 0 by construction (no playerGameStats row yet), so a
// still-open or bye round needs no special-casing.
export const fantasyLineups = pgTable(
  "fantasy_lineups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    season: varchar("season", { length: 9 }).notNull(),
    round: integer("round").notNull(),
    playerId: uuid("player_id").notNull().references(() => players.id),
    isCaptain: boolean("is_captain").default(false).notNull(),
    // "starter" | "sixth_man" | "bench" — added 2026-09-05 alongside the
    // real-rules rebuild (see CLAUDE.md's Fantasy Five section): starters
    // and the sixth man score 100% of a locked round's points, bench scores
    // 50% (services/fantasyScoring.ts). Independent of isCaptain — the
    // captain is always one of the 5 "starter" rows, never sixth_man/bench.
    slotRole: varchar("slot_role", { length: 10 }).default("starter").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    fantasyLineupUnique: uniqueIndex("fantasy_lineups_user_id_season_round_player_id_key").on(
      table.userId,
      table.season,
      table.round,
      table.playerId
    ),
    // Enforces "at most one captain per (user, season, round)" at the DB
    // level — a partial unique index rather than a full one, since only
    // is_captain=true rows need to be unique per round (every non-captain
    // row would otherwise collide on this same key).
    fantasyLineupOneCaptain: uniqueIndex("fantasy_lineup_one_captain")
      .on(table.userId, table.season, table.round)
      .where(sql`${table.isCaptain}`),
  })
);

// A team's head coach draft price for a Fantasy Five round — same
// per-(entity, season) snapshot shape as player_fantasy_prices, just keyed
// on team instead of player (coaches aren't in the `players` table).
// Recomputed by the same `fantasy:reprice` script, off each team's real
// standings position (team_season_stats.position) rather than any coach-
// specific stat, since none is synced — see the script's own comment.
export const coachFantasyPrices = pgTable(
  "coach_fantasy_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    season: varchar("season", { length: 9 }).notNull(),
    price: integer("price").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    coachFantasyPriceUnique: uniqueIndex("coach_fantasy_prices_team_id_season_key").on(table.teamId, table.season),
  })
);

// A user's coach pick for one round — a single row (unlike fantasy_lineups'
// 10 player rows), since only one coach is ever drafted. Editable until the
// round's overall lock time (its first tipoff, same as the original v1
// lock — coach swaps aren't part of the real rules' per-player "turn"
// substitution window, so this doesn't need the finer per-player lock
// fantasy_lineups' bench/starter swaps do).
export const fantasyCoachPicks = pgTable(
  "fantasy_coach_picks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    season: varchar("season", { length: 9 }).notNull(),
    round: integer("round").notNull(),
    teamId: uuid("team_id").notNull().references(() => teams.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    fantasyCoachPickUnique: uniqueIndex("fantasy_coach_picks_user_id_season_round_key").on(
      table.userId,
      table.season,
      table.round
    ),
  })
);

export const playerFantasyPricesRelations = relations(playerFantasyPrices, ({ one }) => ({
  player: one(players, { fields: [playerFantasyPrices.playerId], references: [players.id] }),
}));

export const fantasyLineupsRelations = relations(fantasyLineups, ({ one }) => ({
  user: one(users, { fields: [fantasyLineups.userId], references: [users.id] }),
  player: one(players, { fields: [fantasyLineups.playerId], references: [players.id] }),
}));

export const coachFantasyPricesRelations = relations(coachFantasyPrices, ({ one }) => ({
  team: one(teams, { fields: [coachFantasyPrices.teamId], references: [teams.id] }),
}));

export const fantasyCoachPicksRelations = relations(fantasyCoachPicks, ({ one }) => ({
  user: one(users, { fields: [fantasyCoachPicks.userId], references: [users.id] }),
  team: one(teams, { fields: [fantasyCoachPicks.teamId], references: [teams.id] }),
}));