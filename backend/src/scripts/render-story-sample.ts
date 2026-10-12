// Renders sample game story cards to PNG for visual checks (2026-10-09).
// Run from backend/: npx tsx src/scripts/render-story-sample.ts [outDir]
// Default outDir is the git-ignored plan workspace.
import fs from "node:fs";
import path from "node:path";
import { evaluateClutch, evaluateComeback, evaluateEdge, evaluateExplosion, evaluateLineup, pickStory, withKey } from "../services/gameStory/angles.js";
import { storyText, type Lang } from "../services/gameStory/copy.js";
import { renderStoryPng } from "../services/gameStory/render.js";
import type { GameFacts, StoryBody, Story } from "../services/gameStory/types.js";
import { AWAY, HOME, baseFacts, line, stint } from "./game-story-fixtures.js";

const outDir = path.resolve(process.argv[2] ?? "../.superpowers/sdd/2026-10-09-game-story-cards/samples");
fs.mkdirSync(outDir, { recursive: true });

const PAN = { id: HOME, code: "PAN", name: "Panathinaikos AKTOR Athens", primaryColor: "#007841", secondaryColor: "#FFFFFF", logoUrl: "https://media-cdn.incrowdsports.com/e3dff28a-9ec6-4faf-9d96-ecbc68f75780.png" };
const FEN = { id: AWAY, code: "ULK", name: "Fenerbahce Beko Istanbul", primaryColor: "#0C2340", secondaryColor: "#FFD200", logoUrl: "https://media-cdn.cortextech.io/1dU3kpCqReRp93/1BSdBWIjCiezrk/aa39750a-6203-49ee-a87d-edd0c6f0397d.png" };

// [name, pts, reb, ast, tov, 2pm, 2pa, 3pm, 3pa, ftm, fta, pir]
type Row = [string, number, number, number, number, number, number, number, number, number, number, number];
const box = (teamId: string, rows: Row[]) =>
  rows.map(([name, points, rebounds, assists, turnovers, fg2m, fg2a, fg3m, fg3a, ftm, fta, pir], i) =>
    line(teamId, `${teamId}-${i}`, points, { name, rebounds, assists, turnovers, fg2m, fg2a, fg3m, fg3a, ftm, fta, pir, isStarter: i < 5 })
  );

// A realistic PAN 92-74 FEN: PAN 12/26 from three to FEN's 6/24.
function game(): GameFacts {
  const home = box(HOME, [
    ["Kendrick Nunn", 21, 3, 4, 2, 3, 7, 4, 7, 3, 3, 20],
    ["Jerian Grant", 9, 2, 6, 1, 0, 2, 3, 5, 0, 0, 11],
    ["Kostas Sloukas", 11, 2, 7, 2, 1, 2, 2, 4, 3, 3, 14],
    ["Juancho Hernangomez", 8, 7, 1, 0, 1, 3, 2, 4, 0, 0, 10],
    ["Mathias Lessort", 16, 9, 1, 2, 7, 9, 0, 0, 2, 4, 21],
    ["Nigel Hayes-Davis", 12, 4, 2, 1, 3, 5, 1, 3, 3, 4, 12],
    ["Kenneth Faried", 6, 5, 0, 1, 3, 4, 0, 0, 0, 2, 7],
    ["Brancou Badio", 9, 1, 2, 1, 3, 5, 0, 3, 3, 3, 6],
  ]);
  const away = box(AWAY, [
    ["Scottie Wilbekin", 16, 2, 3, 3, 2, 5, 3, 8, 3, 3, 10],
    ["Marko Guduric", 12, 3, 4, 2, 3, 6, 1, 4, 3, 4, 9],
    ["Nicolo Melli", 8, 6, 2, 2, 4, 7, 0, 2, 0, 0, 8],
    ["Johnathan Motley", 14, 5, 1, 3, 6, 11, 0, 0, 2, 2, 11],
    ["Tarik Biberovic", 10, 2, 1, 2, 1, 4, 2, 6, 2, 2, 5],
    ["Bonzie Colson", 14, 6, 2, 2, 6, 9, 0, 4, 2, 4, 12],
  ]);
  return baseFacts({
    gameId: "sample-1",
    home: { ...PAN, score: 92 },
    away: { ...FEN, score: 74 },
    lines: [...home, ...away],
    quarters: { home: [22, 20, 29, 21], away: [21, 19, 14, 20] },
    runs: [{ teamId: HOME, points: 9, period: 3, endHome: 60, endAway: 49 }, { teamId: AWAY, points: 7, period: 1, endHome: 10, endAway: 15 }],
    margins: [[60, -2], [240, -5], [420, 2], [600, 1], [800, 4], [1000, -1], [1200, 2], [1350, 6], [1500, 11], [1650, 13], [1800, 17], [2000, 14], [2200, 19], [2400, 18]].map(([t, margin]) => ({ t, margin })),
  });
}

function runGame(): GameFacts {
  const f = game();
  f.runs = [{ teamId: HOME, points: 16, period: 3, endHome: 64, endAway: 49 }, ...f.runs.slice(1)];
  return f;
}

function lineupGame(): GameFacts {
  const f = game();
  const five = [0, 1, 2, 3, 4].map((i) => `${HOME}-${i}`);
  f.stints = [stint(HOME, five, 840, 38, 19), stint(HOME, [`${HOME}-5`, `${HOME}-6`, `${HOME}-7`, `${HOME}-1`, `${HOME}-2`], 600, 20, 21)];
  return f;
}

function explosionGame(): GameFacts {
  const f = game();
  f.lines = f.lines.map((l) => (l.name === "Kendrick Nunn" ? { ...l, points: 38, pir: 41, prevHighPoints: 36, fg2m: 7, fg2a: 10, fg3m: 6, fg3a: 9, ftm: 6, fta: 6, last5Points: [21, 17, 25, 19, 38] } : l));
  return f;
}

function comebackGame(): GameFacts {
  const f = game();
  f.home = { ...f.home, score: 80 };
  f.away = { ...f.away, score: 74 };
  f.margins = Array.from({ length: 41 }, (_, i) => ({ t: i * 60, margin: i < 18 ? -Math.round(i * 1.0) : Math.round(-18 + (i - 18) * 1.05) }));
  return f;
}

function clutchGame(): GameFacts {
  const f = game();
  f.home = { ...f.home, score: 101, logoUrl: "https://example.invalid/missing-logo.png" };
  f.away = { ...f.away, score: 99 };
  f.overtime = true;
  f.quarters = { home: [22, 20, 25, 21, 13], away: [21, 19, 24, 24, 11] };
  f.lines.push(line(HOME, "long", 12, { name: "Nikola Kalinić-Marinković Jr." }));
  f.clutchPoints = [{ playerName: "Kendrick Nunn", teamId: HOME, points: 9 }];
  f.clutchPlays = [
    { t: 2580, period: 5, clock: 120, teamId: AWAY, playerName: "Scottie Wilbekin", playType: "3FGM", homeScore: 94, awayScore: 96 },
    { t: 2620, period: 5, clock: 80, teamId: HOME, playerName: "Kendrick Nunn", playType: "3FGM", homeScore: 97, awayScore: 96 },
    { t: 2650, period: 5, clock: 50, teamId: AWAY, playerName: "Marko Guduric", playType: "2FGM", homeScore: 97, awayScore: 98 },
    { t: 2680, period: 5, clock: 20, teamId: HOME, playerName: "Nikola Kalinić-Marinković Jr.", playType: "2FGM", homeScore: 99, awayScore: 98 },
    { t: 2695, period: 5, clock: 5, teamId: HOME, playerName: "Kendrick Nunn", playType: "FTM", homeScore: 101, awayScore: 99 },
  ];
  return f;
}

function numbersGame(): GameFacts {
  const f = game();
  f.home = { ...f.home, score: 78 };
  f.away = { ...f.away, score: 74 };
  f.lines = f.lines.map((l) => ({ ...l, points: Math.min(l.points, 14), pir: Math.min(l.pir, 14), fg3m: Math.min(l.fg3m, 1), assists: 2 }));
  f.quarters = { home: [20, 19, 20, 19], away: [18, 19, 18, 19] };
  f.runs = [];
  f.margins = [];
  return f;
}

const cases: [string, GameFacts, (f: GameFacts) => StoryBody | Story | null, Lang][] = [
  ["edge-threes-en", game(), evaluateEdge, "en"],
  ["edge-threes-el", game(), evaluateEdge, "el"],
  ["edge-run-en", runGame(), evaluateEdge, "en"],
  ["lineup-en", lineupGame(), evaluateLineup, "en"],
  ["explosion-en", explosionGame(), evaluateExplosion, "en"],
  ["comeback-el", comebackGame(), evaluateComeback, "el"],
  ["clutch-ot-longname-badlogo-en", clutchGame(), evaluateClutch, "en"],
  ["numbers-el", numbersGame(), pickStory, "el"],
];

for (const [name, facts, pick, lang] of cases) {
  const story = withKey(facts, pick(facts));
  if (!story) throw new Error(`${name}: fixture produced no story`);
  const png = await renderStoryPng(story, facts, storyText(story, facts, lang));
  fs.writeFileSync(path.join(outDir, `${name}.png`), png);
  console.log("wrote", name, story.angle, story.key?.kind === "edge" ? story.key.edge.key : story.key?.kind, `${Math.round(png.length / 1024)} KB`);
}
