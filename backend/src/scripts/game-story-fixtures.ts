// Hand-made GameFacts for the game story checks and sample renders.
import type { GameFacts, LineFacts, StintFacts } from "../services/gameStory/types.js";

export const HOME = "home-id";
export const AWAY = "away-id";

export function line(teamId: string, code: string, points: number, extra: Partial<LineFacts> = {}): LineFacts {
  return {
    playerCode: code, name: `Player ${code}`, teamId, isStarter: false, points, rebounds: 3, offRebounds: 1, assists: 2,
    steals: 1, blocks: 0, pir: Math.round(points * 1.1), plusMinus: 0, minutes: 20, fg2m: 2, fg2a: 4, fg3m: 1, fg3a: 3,
    ftm: 1, fta: 2, prevHighPoints: 40, prevHighPir: 45, last5Points: [8, 9, 10, 11, 12], ...extra,
  };
}

// Home wins 80-70. 5 starters x 8 = 40, bench 4 x 10 = 40 (share 50%).
export function baseFacts(over: Partial<GameFacts> = {}): GameFacts {
  const homeStarters = [1, 2, 3, 4, 5].map((i) => line(HOME, `h${i}`, 8, { isStarter: true }));
  const homeBench = [6, 7, 8, 9].map((i) => line(HOME, `h${i}`, 10));
  const away = [1, 2, 3, 4, 5, 6, 7].map((i) => line(AWAY, `a${i}`, 10, { isStarter: i <= 5 }));
  return {
    gameId: "game-1", season: "2026-27", round: 4, tipoffAt: "2026-10-08T18:00:00.000Z",
    home: { id: HOME, code: "PAN", name: "Panathinaikos", primaryColor: "#007A3D", secondaryColor: "#FFFFFF", logoUrl: null, score: 80 },
    away: { id: AWAY, code: "FEN", name: "Fenerbahce", primaryColor: "#002D72", secondaryColor: "#FFD200", logoUrl: null, score: 70 },
    overtime: false,
    lines: [...homeStarters, ...homeBench, ...away],
    stints: [],
    margins: [],
    clutchPoints: [],
    clutchPlays: [],
    ...over,
  };
}

export const stint = (teamId: string, codes: string[], seconds: number, ptsFor: number, ptsAgainst: number): StintFacts => ({
  teamId, playerCodes: [...codes].sort(), seconds, ptsFor, ptsAgainst, possFor: seconds / 30, possAgainst: seconds / 30,
});

