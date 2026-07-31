export interface PublicUser {
  id: string;
  email: string;
  favoriteTeamId: string | null;
  avatarUrl: string | null;
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
}

export interface RosterEntry {
  player: Player;
  stats: PlayerSeasonStats;
}

export interface LeaderEntry {
  category: string;
  value: number | null;
  player: { id: string; code: string; name: string };
  team: { id: string; code: string; name: string; primaryColor: string | null };
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

export interface StandingsRow {
  team: Team;
  stats: TeamSeasonStats;
  position: number;
}