// Game story cards (2026-10-09). Facts about one final game, loaded by
// facts.ts, and the story picked from them by angles.ts. Spec:
// docs/superpowers/specs/2026-10-09-game-story-cards-design.md

export interface TeamFacts {
  id: string;
  code: string;
  name: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  score: number;
}

export interface LineFacts {
  playerCode: string;
  name: string; // "First Last"
  teamId: string;
  isStarter: boolean | null; // null on games with no starter flags (simulated)
  points: number;
  rebounds: number;
  offRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  pir: number;
  plusMinus: number | null;
  minutes: number | null;
  fg2m: number;
  fg2a: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  // Best points / PIR in any earlier game we have; null = no history.
  prevHighPoints: number | null;
  prevHighPir: number | null;
  last5Points: number[]; // oldest first, including this game
}

export interface StintFacts {
  teamId: string;
  playerCodes: string[];
  seconds: number;
  ptsFor: number;
  ptsAgainst: number;
  possFor: number;
  possAgainst: number;
}

export interface MarginPoint {
  t: number; // seconds elapsed in the game
  margin: number; // home - away
}

export interface ClutchPlay {
  t: number;
  period: number;
  clock: number; // seconds remaining in the period
  teamId: string | null;
  playerName: string | null;
  playType: string;
  homeScore: number;
  awayScore: number;
}

export interface GameFacts {
  gameId: string;
  season: string;
  round: number | null;
  tipoffAt: string;
  home: TeamFacts;
  away: TeamFacts;
  overtime: boolean;
  lines: LineFacts[];
  stints: StintFacts[];
  margins: MarginPoint[];
  clutchPoints: { playerName: string; teamId: string; points: number }[];
  clutchPlays: ClutchPlay[];
}

export type Angle = "bench" | "lineup" | "explosion" | "comeback" | "clutch" | "numbers";

export interface LineupTypeRow {
  label: "0-1" | "2-3" | "4-5";
  seconds: number;
  ptsFor: number;
  ptsAgainst: number;
}

export interface LineupSummary {
  teamId: string;
  playerCodes: string[];
  names: string[];
  seconds: number;
  ptsFor: number;
  ptsAgainst: number;
  plusMinus: number;
  netRating: number | null;
  possessions: number;
  startersOnCourt: number | null; // null when the game has no starter flags
}

export interface BenchData {
  teamId: string;
  benchPoints: number;
  starterPoints: number;
  teamPoints: number;
  share: number;
  scorers: LineFacts[]; // bench players, most points first
  byType: LineupTypeRow[];
}

export interface LineupData {
  lineup: LineupSummary;
  byType: LineupTypeRow[];
}

export interface ExplosionData {
  line: LineFacts;
  stat: "points" | "pir";
  value: number;
  careerHigh: boolean;
}

export interface ComebackData {
  teamId: string; // the winner
  deficit: number;
  finalMargin: number;
  margins: MarginPoint[]; // winner's perspective (positive = winner ahead)
  lowAt: number; // t of the largest deficit
}

export interface ClutchData {
  margin: number;
  overtime: boolean;
  hero: { playerName: string; teamId: string; points: number } | null;
  plays: ClutchPlay[];
}

export interface NumbersData {
  topScorers: { home: LineFacts | null; away: LineFacts | null };
  bench: { home: { bench: number; starters: number } | null; away: { bench: number; starters: number } | null };
  bestLineup: LineupSummary | null;
}

export type Story =
  | { angle: "bench"; score: number; data: BenchData }
  | { angle: "lineup"; score: number; data: LineupData }
  | { angle: "explosion"; score: number; data: ExplosionData }
  | { angle: "comeback"; score: number; data: ComebackData }
  | { angle: "clutch"; score: number; data: ClutchData }
  | { angle: "numbers"; score: number; data: NumbersData };
