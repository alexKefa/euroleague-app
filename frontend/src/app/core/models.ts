export interface PublicUser {
  id: string;
  email: string;
  favoriteTeamId: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  referralCode: string | null;
}

export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  sourceUrl: string;
  summary: string | null;
  imageUrl: string | null;
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
}

export interface RosterEntry {
  player: Player;
  stats: PlayerSeasonStats;
}

export interface PlayerDetail {
  player: Player;
  team: Team;
  stats: PlayerSeasonStats | null;
}

export interface LeaderEntry {
  category: string;
  value: number | null;
  player: { id: string; code: string; name: string };
  team: { id: string; code: string; name: string; primaryColor: string | null };
}

export interface RoundMvpEntry {
  player: { id: string; code: string; name: string };
  team: { id: string; code: string; name: string; primaryColor: string | null };
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
  homeTeam: GameTeamSummary;
  awayTeam: GameTeamSummary;
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

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  correct: number;
  total: number;
  accuracy: number;
  points: number;
  badges: Badge[];
}

export interface TradeCardRef {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface PredictionSummary {
  points: number;
  badges: Badge[];
  newRoundRewards: TradeCardRef[];
}

export type CollectibleTier = "common" | "rare" | "legendary";

export interface Collectible {
  id: string;
  name: string;
  tier: CollectibleTier;
  pointsCost: number;
  imageUrl: string | null;
  team: { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null };
}

export interface MyCollectible {
  collectibleId: string;
  unlockedAt: string;
}

export interface SpinStatus {
  canSpin: boolean;
  nextEligibleAt: string | null;
}

export interface SpinResult {
  // Same shape as a pack-opening result card — the wheel reward is now
  // routed through the same pack-opening machinery as a real purchase, so
  // a spin can land on a card already owned (wasDuplicate), sellable via
  // the same POST /packs/results/:id/sell endpoint packs.html uses.
  won: PackOpenResultCard | null;
  nextEligibleAt: string;
}

export type PackType = "starter" | "pro" | "elite" | "wheelStarter" | "wheelPro" | "wheelLegendary";

export interface PackDefinition {
  type: PackType;
  label: string;
  pointsCost: number;
  slots: number;
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
  team: { id: string; code: string; name: string; primaryColor: string | null };
  tradeable: boolean;
}

export interface MarketplaceCard {
  id: string;
  name: string;
  tier: CollectibleTier;
  imageUrl: string | null;
  team: { id: string; code: string; name: string; primaryColor: string | null };
  ownerName: string;
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

export interface StandingsRow {
  team: Team;
  stats: TeamSeasonStats;
  position: number;
}