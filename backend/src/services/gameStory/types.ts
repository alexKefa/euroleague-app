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
  turnovers: number;
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

export interface RunFacts {
  teamId: string;
  points: number;
  period: number; // the period the run started in
  endHome: number; // score when the run ended
  endAway: number;
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
  // Points per quarter; index 4 (when present) is all overtime together.
  quarters: { home: number[]; away: number[] };
  // Each team's longest unanswered scoring run (empty = no play-by-play).
  runs: RunFacts[];
}

export type Angle = "edge" | "lineup" | "explosion" | "comeback" | "clutch" | "numbers";

// "What won it": a team-level edge the winner had over the loser.
export type EdgeKey = "run" | "quarter" | "threes" | "boards" | "turnovers" | "freeThrows" | "assists" | "shooting";

export interface EdgeData {
  key: EdgeKey;
  winner: number; // the winner's value (turnovers: committed; shooting: FG%)
  loser: number;
  diff: number; // in the winner's favour, > 0
  ratio: number; // diff / threshold; >= 1 makes it a story angle
  period: number | null; // run / quarter only
}

// One "tale of the tape" row, winner vs loser.
export interface TapeRow {
  key: "shooting" | "threes" | "boards" | "assists" | "turnovers" | "freeThrows";
  winner: string;
  loser: string;
  winnerShare: number; // 0..1, the winner's side of the bar (turnovers inverted)
  winnerBetter: boolean;
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
}

export interface LineupData {
  lineup: LineupSummary;
  tape: TapeRow[];
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
  tape: TapeRow[];
}

// The card's "what won it" strip: the winner's biggest edge, or the
// winner's leader when that edge is already the headline or none stands out.
export type KeyNote = { kind: "edge"; edge: EdgeData } | { kind: "leader"; line: LineFacts };

export type StoryBody =
  | { angle: "edge"; score: number; data: EdgeData & { tape: TapeRow[] } }
  | { angle: "lineup"; score: number; data: LineupData }
  | { angle: "explosion"; score: number; data: ExplosionData }
  | { angle: "comeback"; score: number; data: ComebackData }
  | { angle: "clutch"; score: number; data: ClutchData }
  | { angle: "numbers"; score: number; data: NumbersData };

export type Story = StoryBody & { key: KeyNote | null };
