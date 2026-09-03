export interface PublicUser {
  id: string;
  email: string;
  username: string;
  favoriteTeamId: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  referralCode: string | null;
  // Up to 3 owned collectible ids shown next to this user's name on a
  // league leaderboard — see PUT /api/users/me/showcase.
  showcaseCollectibleIds: string[];
}

export interface NewsSyncStatus {
  lastSyncedAt: string | null;
}

export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  sourceUrl: string;
  summary: string | null;
  imageUrl: string | null;
  lang: string;
  publishedAt: string;
}

export interface Player {
  id: string;
  code: string;
  teamId: string;
  name: string;
  position: string | null;
  jerseyNumber: number | null;
  photoUrl: string | null;
  active: boolean;
}

export interface PlayerSeasonStats {
  playerId: string;
  teamId: string;
  season: string;
  gamesPlayed: number | null;
  minutesPerGame: number | null;
  pointsPerGame: number | null;
  reboundsPerGame: number | null;
  assistsPerGame: number | null;
  stealsPerGame: number | null;
  blocksPerGame: number | null;
  turnoversPerGame: number | null;
  fieldGoalPct: number | null;
  threePointPct: number | null;
  freeThrowPct: number | null;
  valuation: number | null;
  effectiveFieldGoalPct: number | null;
  trueShootingPct: number | null;
  offensiveReboundPct: number | null;
  defensiveReboundPct: number | null;
  totalReboundPct: number | null;
  assistToTurnoverRatio: number | null;
  assistRatio: number | null;
  turnoverRatio: number | null;
  twoPointAttemptRate: number | null;
  threePointAttemptRate: number | null;
  freeThrowRate: number | null;
  possessionsPerGame: number | null;
  usagePercentage: number | null;
}

export interface RosterEntry {
  player: Player;
  stats: PlayerSeasonStats;
}

// GET /api/players/advanced-stats — full playerSeasonStats row per player,
// for the whole league, for a sortable/filterable stats-lab table.
export interface PlayerAdvancedStatsRow {
  player: Player;
  team: Team;
  stats: PlayerSeasonStats;
}

export interface PlayerAdvancedStats {
  season: string | null;
  rows: PlayerAdvancedStatsRow[];
}

// GET/POST/PATCH /api/analytics-views — a user's saved custom stat table:
// which players and which playerSeasonStats columns to show, and how to
// sort it. Free (not points-gated), capped at 5 per user server-side. Pure
// projection over the same /api/players/advanced-stats payload — no
// separate stats fetch.
export interface AnalyticsViewCustomColumn {
  id: string;
  label: string;
  expression: string;
}

export interface AnalyticsView {
  id: string;
  userId: string;
  name: string;
  playerIds: string[];
  columns: string[];
  customColumns: AnalyticsViewCustomColumn[];
  sortKey: string | null;
  sortDesc: boolean;
  createdAt: string;
}

export interface PlayerDetail {
  player: Player;
  team: Team;
  stats: PlayerSeasonStats | null;
}

// GET /api/players/:id/shots — coordX/coordY are EuroLeague's own shot-chart
// system (cm, origin at the basket, y increasing away from the hoop),
// straight from the feed. See backend/src/sync-py/shot_sync.py.
export interface PlayerShot {
  x: number;
  y: number;
  made: boolean;
  actionId: string;
  zone: string | null;
}

export interface PlayerShotChart {
  season: string | null;
  attempts: number;
  made: number;
  fieldGoalPct: number | null;
  shots: PlayerShot[];
}

// GET /api/players/:id/games — one row per "final" game the player has a
// player_game_stats line for, most recent first.
export interface PlayerGameLogEntry {
  game: {
    id: string;
    round: number | null;
    tipoffAt: string;
    homeScore: number | null;
    awayScore: number | null;
    homeTeam: GameTeamSummary;
    awayTeam: GameTeamSummary;
  };
  stats: {
    minutes: number | null;
    points: number | null;
    rebounds: number | null;
    assists: number | null;
    steals: number | null;
    blocksFavour: number | null;
    turnovers: number | null;
    valuation: number | null;
    fieldGoalsMade2: number | null;
    fieldGoalsAttempted2: number | null;
    fieldGoalsMade3: number | null;
    fieldGoalsAttempted3: number | null;
    freeThrowsMade: number | null;
    freeThrowsAttempted: number | null;
  };
}

export interface PlayerGameLog {
  season: string | null;
  rows: PlayerGameLogEntry[];
}

export interface LeaderEntry {
  category: string;
  value: number | null;
  player: { id: string; code: string; name: string };
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
}

export interface RoundMvpEntry {
  player: { id: string; code: string; name: string };
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
  valuation: number | null;
  points: number | null;
  gameId: string;
}

export interface RoundMvp {
  season: string | null;
  round: number | null;
  leaders: RoundMvpEntry[];
}

export interface Team {
  id: string;
  code: string;
  name: string;
  city: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  headCoach: string | null;
}

export interface TeamSeasonStats {
  teamId: string;
  season: string;
  wins: number;
  losses: number;
  ppg: number | null;
  papg: number | null;
  offRating: number | null;
  defRating: number | null;
  rebPct: number | null;
  astPct: number | null;
  // Approximated backend-side from player_season_stats (sum of each
  // roster player's own reboundsPerGame) — no raw team total is synced.
  rpg: number | null;
  // Record across the team's last 10 *final* games (chronological, most
  // recent first) — computed backend-side from `games`, not stored. Null
  // rather than {wins:0, losses:0} when the team has zero final games yet,
  // so the standings column can tell "0-0 so far" apart from "no games
  // played this season" (see standings.ts's format function).
  last10: { wins: number; losses: number } | null;
}

export interface GameTeamSummary {
  id: string;
  code: string;
  name: string;
  primaryColor: string | null;
  logoUrl: string | null;
}

export interface Game {
  id: string;
  gameCode: number;
  round: number | null;
  status: string; // "scheduled" | "final"
  tipoffAt: string;
  homeScore: number | null;
  awayScore: number | null;
  // Only populated while status is "live" — see the backend schema comment
  // (games.quarter/game_clock_seconds) for where these come from.
  quarter: number | null;
  gameClockSeconds: number | null;
  homeTeam: GameTeamSummary;
  awayTeam: GameTeamSummary;
  highlightVideoId?: string | null;
  // De-vigged implied win probability per side, from a one-time betting-
  // odds snapshot (backend's game_odds table) — undefined/null until
  // sync/oddsSync.ts has captured one for this game (only GET
  // /games/schedule populates these; other Game-shaped endpoints omit
  // them). Drives the real per-pick point preview on the Predictions page
  // — see backend CLAUDE.md's "Odds-weighted prediction points" section.
  homeFairProb?: number | null;
  awayFairProb?: number | null;
  // Current league standing per side (team_season_stats.position) and the
  // game's venue — only GET /games/schedule populates these, same
  // "schedule-only extras" pattern as homeFairProb/awayFairProb above.
  homeTeamPosition?: number | null;
  awayTeamPosition?: number | null;
  venueName?: string | null;
}

export interface RoundsInfo {
  season: string;
  rounds: number[];
}

export interface GameTeamStats {
  teamId: string;
  season: string;
  position: number | null;
  wins: number;
  losses: number;
  ppg: number | null;
  papg: number | null;
  offRating: number | null;
  defRating: number | null;
  rebPct: number | null;
  astPct: number | null;
}

export interface PlayerToWatch {
  player: { id: string; code: string; name: string };
  pointsPerGame: number | null;
  reboundsPerGame: number | null;
  assistsPerGame: number | null;
  valuation: number | null;
}

export interface GameBoxscoreLine {
  player: { id: string; code: string; name: string };
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  valuation: number | null;
}

export interface GameDetail {
  game: Game & { season: string };
  statsSeason: string;
  teamComparison: { home: GameTeamStats | null; away: GameTeamStats | null };
  playersToWatch: { home: PlayerToWatch[]; away: PlayerToWatch[] };
  boxscore: { home: GameBoxscoreLine[]; away: GameBoxscoreLine[] } | null;
  topPerformers: GameBoxscoreLine[];
  doubleDoubles: GameBoxscoreLine[];
}

export interface Schedule {
  season: string;
  round: number;
  games: Game[];
}

export interface Prediction {
  id: string;
  gameId: string;
  tipoffAt: string;
  status: string; // "scheduled" | "final"
  predictedTeam: { id: string; code: string; name: string };
  isCorrect: boolean | null; // null = game not resolved yet
}

export interface Badge {
  id: string;
  label: string;
  description: string;
}

// Cosmetic-only card shown next to a leaderboard entry — resolved from
// users.showcaseCollectibleIds server-side (services/leaderboard.ts), not
// the full Collectible shape (no pointsCost/buyPrice/serial, not relevant
// here). Shared by the global and league leaderboards alike.
export interface ShowcaseCard {
  id: string;
  name: string;
  tier: CollectibleTier;
  imageUrl: string | null;
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  correct: number;
  total: number;
  accuracy: number;
  points: number;
  badges: Badge[];
  showcase: ShowcaseCard[];
}

export interface TradeCardRef {
  id: string;
  name: string;
  imageUrl: string | null;
}

// A perfect/great round or a legendary milestone now grants an *unopened
// pack* (wheelLegendary or wheelPro), same concept as a wheel win — not a
// specific card directly, so this carries packType/tier rather than a card
// name/image the way TradeCardRef does.
export interface RewardPack {
  id: string;
  packType: "wheelLegendary" | "wheelPro";
  tier: CollectibleTier;
}

export interface PredictionSummary {
  points: number;
  badges: Badge[];
  newRoundRewards: RewardPack[];
  // Career-wide (not round-scoped) legendary reward every N cumulative
  // correct predictions — see LEGENDARY_MILESTONE_INTERVAL on the backend.
  newMilestoneRewards: RewardPack[];
}

// GET /api/predictions/analytics — community-wide pick accuracy, not
// per-user (that's LeaderboardEntry above).
export interface TeamPickAccuracy {
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
  timesPicked: number;
  timesCorrect: number;
  accuracy: number | null;
}

export interface PredictionUpset {
  gameId: string;
  round: number | null;
  tipoffAt: string;
  homeScore: number;
  awayScore: number;
  homeTeam: { id: string; code: string; name: string; logoUrl: string | null };
  awayTeam: { id: string; code: string; name: string; logoUrl: string | null };
  totalPicks: number;
  majorityPickedTeamId: string;
  majorityPct: number;
  majorityWasWrong: boolean;
}

export interface PredictionAnalytics {
  overall: { total: number; correct: number; accuracy: number | null };
  byTeam: TeamPickAccuracy[];
  upsets: PredictionUpset[];
}

export type CollectibleTier = "common" | "rare" | "legendary" | "coach";

// Cosmetic-only, legendary-only flourish rolled once at first acquisition
// (services/packs.ts) — never affects album completion, forceNewLegendary,
// or trade eligibility. Absent/undefined reads the same as "standard" for
// payload shapes that don't carry it.
export type CollectibleFinish = "standard" | "foil";

export interface Collectible {
  id: string;
  name: string;
  tier: CollectibleTier;
  pointsCost: number;
  // Direct-purchase price — null for legendary (never directly purchasable,
  // wheel/packs/perfect-round only). Deliberately above pointsCost's book
  // value for common/rare, see backend/src/routes/collectibles.ts.
  buyPrice: number | null;
  imageUrl: string | null;
  // Print numbering within this card's own tier (e.g. 42/208) — computed
  // fresh per request (backend/src/routes/collectibles.ts), not stored.
  // Optional because leaner card shapes elsewhere (trades, pack-reveal)
  // don't carry it.
  serialNumber?: number;
  serialTotal?: number;
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
  // Only ever "foil" for a legendary — see CollectibleFinish. Optional
  // because most card shapes (store browse, album) don't carry it.
  finish?: CollectibleFinish;
}

// A single tier's card within a bundle — same shape as Collectible minus
// `team`, since every card in a bundle shares its parent CollectibleBundle's
// team (bundling only ever groups tiers of the *same* player on the *same*
// team — see backend/src/routes/collectibles.ts's GET /browse comment).
export interface CollectibleBundleCard {
  id: string;
  name: string;
  tier: CollectibleTier;
  pointsCost: number;
  buyPrice: number | null;
  imageUrl: string | null;
  serialNumber?: number;
  serialTotal?: number;
}

// One player's common/rare/legendary cards grouped together — `cards` holds
// whichever of the 3 tiers actually exist for this player (1-3, ordered
// common → rare → legendary), never all three unless that player has a
// legendary print.
export interface CollectibleBundle {
  name: string;
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
  cards: CollectibleBundleCard[];
}

// Response shape of GET /api/collectibles/browse (the Store page's paginated,
// filtered, bundled card list) — distinct from GET /api/collectibles, which
// still returns the full flat catalog unpaginated for callers that need it
// all at once (inventory, profile, album).
export interface CollectiblesPage {
  items: CollectibleBundle[];
  hasMore: boolean;
}

export type CollectibleTeamFilter = { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };

// Response for the card-preview flip — a best-effort match against the
// real players table (see backend/src/routes/collectibles.ts's
// normalizePlayerName), so `matched: false` is a normal outcome to render,
// not an error.
export interface CollectibleStatsResponse {
  matched: boolean;
  player?: { id: string; name: string; position: string | null; jerseyNumber: number | null };
  stats?: PlayerSeasonStats | null;
}

export interface MyCollectible {
  collectibleId: string;
  unlockedAt: string;
  finish: CollectibleFinish;
}

export interface SpinStatus {
  canSpin: boolean;
  nextEligibleAt: string | null;
}

export interface SpinResult {
  // The wheel no longer rolls a card on the spot — it grants an unopened
  // pack straight into the inventory (GET /api/packs/owned), opened later
  // via POST /api/packs/owned/:id/open, same PackOpenOutcome shape a
  // purchase gets. Every spin wins something, so this is never null.
  wonPack: { id: string; packType: PackType; label: string; tier: CollectibleTier };
  nextEligibleAt: string;
}

export type PackType = "starter" | "pro" | "elite" | "wheelStarter" | "wheelPro" | "wheelLegendary" | "wheelCoach";

export interface PackDefinition {
  type: PackType;
  label: string;
  pointsCost: number;
  slots: number;
}

// An unopened pack sitting in the user's inventory — currently only ever
// granted by the wheel; purchased packs still open immediately and never
// appear here.
export interface OwnedPack {
  id: string;
  packType: PackType;
  label: string;
  acquiredAt: string;
}

export interface PackOpenResultCard {
  resultId: string;
  collectible: Collectible;
  wasDuplicate: boolean;
  sellValue: number | null;
}

export interface PackOpenOutcome {
  openingId: string;
  packType: PackType;
  results: PackOpenResultCard[];
}

export interface TradeableCard {
  id: string;
  name: string;
  tier: CollectibleTier;
  imageUrl: string | null;
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
  tradeable: boolean;
  finish: CollectibleFinish;
  // Other legendary collectible ids you'd accept in return for this card,
  // shown to browsers of the marketplace — purely informational, never
  // enforced. Only meaningful while `tradeable` is true.
  wishlist: string[];
}

export interface MarketplaceCard {
  // The listing itself (userCollectibles.id) — not the catalog collectible
  // id, which the same legendary can share across multiple owners' listings.
  id: string;
  // The catalog card this listing is for — used to detect "you already own
  // this exact legendary" (a different owner can list the same collectible).
  collectibleId: string;
  name: string;
  tier: CollectibleTier;
  imageUrl: string | null;
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
  ownerName: string;
  finish: CollectibleFinish;
  // Resolved to name/image (not just ids) so the marketplace can render
  // "wants: <name>" without a second round trip.
  wishlist: TradeCardRef[];
}

export type TradeOfferStatus = "pending" | "accepted" | "declined" | "cancelled";

export interface TradeOffer {
  id: string;
  status: TradeOfferStatus;
  createdAt: string;
  direction: "incoming" | "outgoing";
  counterpartyName: string;
  offered: TradeCardRef[];
  requested: TradeCardRef;
}

// GET /api/leagues/mine — a league the current user belongs to. joinedAt is
// *this user's* join date, not the league's creation date (see the route's
// comment) — a league someone else made you a member of long ago should
// still surface like anything else new.
export interface League {
  id: string;
  name: string;
  code: string;
  memberCount: number;
  joinedAt: string;
}

export interface LeagueMember {
  userId: string;
  displayName: string;
  joinedAt: string;
}

// GET /api/leagues/:id
export interface LeagueDetail {
  id: string;
  name: string;
  code: string;
  createdByUserId: string;
  createdAt: string;
  members: LeagueMember[];
}

// GET /api/leagues/:id/leaderboard — identical shape to the global
// LeaderboardEntry (showcase included on both now). Unlike the global
// board, a member with zero resolved predictions yet is still included
// (0 points, ranked last) — see the route's comment. Kept as a distinct
// alias for readability at call sites, not because the shape differs.
export type LeagueShowcaseCard = ShowcaseCard;
export type LeagueLeaderboardEntry = LeaderboardEntry;

export interface StandingsRow {
  team: Team;
  stats: TeamSeasonStats;
  position: number;
}