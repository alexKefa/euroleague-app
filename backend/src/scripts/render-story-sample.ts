// Renders sample game story cards to PNG for visual checks (2026-10-09).
// Run from backend/: npx tsx src/scripts/render-story-sample.ts [outDir]
// Default outDir is the git-ignored plan workspace.
import fs from "node:fs";
import path from "node:path";
import { evaluateBench, evaluateClutch, evaluateComeback, evaluateExplosion, evaluateLineup, pickStory } from "../services/gameStory/angles.js";
import { storyText, type Lang } from "../services/gameStory/copy.js";
import { renderStoryPng } from "../services/gameStory/render.js";
import type { GameFacts, Story } from "../services/gameStory/types.js";
import { AWAY, HOME, baseFacts, line, stint } from "./game-story-fixtures.js";

const outDir = path.resolve(process.argv[2] ?? "../.superpowers/sdd/2026-10-09-game-story-cards/samples");
fs.mkdirSync(outDir, { recursive: true });

const PAN = { id: HOME, code: "PAN", name: "Panathinaikos AKTOR Athens", primaryColor: "#007841", secondaryColor: "#FFFFFF", logoUrl: "https://media-cdn.incrowdsports.com/e3dff28a-9ec6-4faf-9d96-ecbc68f75780.png" };
const FEN = { id: AWAY, code: "ULK", name: "Fenerbahce Beko Istanbul", primaryColor: "#0C2340", secondaryColor: "#FFD200", logoUrl: "https://media-cdn.cortextech.io/1dU3kpCqReRp93/1BSdBWIjCiezrk/aa39750a-6203-49ee-a87d-edd0c6f0397d.png" };

// A realistic PAN 92-74 FEN box score: bench 74, starters 18.
function benchGame(): GameFacts {
  const starters = [
    ["Kendrick Nunn", 6], ["Jerian Grant", 4], ["Kostas Sloukas", 4], ["Juancho Hernangomez", 2], ["Kenneth Faried", 2],
  ].map(([n, p], i) => line(HOME, `s${i}`, p as number, { name: n as string, isStarter: true, plusMinus: -2 }));
  const bench = [
    ["Nigel Hayes-Davis", 19, 24, 3], ["Mathias Lessort", 19, 22, 0], ["Sylvain Francisco", 17, 13, 1], ["Nikos Rogkavopoulos", 10, 11, 0],
    ["Brancou Badio", 7, 15, 2], ["Moustapha Fall", 2, 2, 0], ["Isaac Bonga", 0, 17, 0],
  ].map(([n, p, pm, st], i) => line(HOME, `b${i}`, p as number, { name: n as string, isStarter: false, plusMinus: pm as number, steals: st as number }));
  const away = [["Scottie Wilbekin", 16], ["Marko Guduric", 14], ["Nigel Hayes", 12], ["Johnathan Motley", 12], ["Bonzie Colson", 10], ["Tarik Biberovic", 10]].map(
    ([n, p], i) => line(AWAY, `a${i}`, p as number, { name: n as string, isStarter: i < 5 })
  );
  const benchFive = ["b0", "b1", "b2", "b4", "b6"];
  return baseFacts({
    home: { ...PAN, score: 92 },
    away: { ...FEN, score: 74 },
    lines: [...starters, ...bench, ...away],
    stints: [
      stint(HOME, benchFive, 552, 31, 16),
      stint(HOME, ["b0", "b1", "b2", "b3", "s0"], 834, 34, 24),
      stint(HOME, ["s0", "s1", "b0", "b1", "b5"], 402, 9, 17),
      stint(HOME, ["s0", "s1", "s2", "s3", "b1"], 618, 18, 17),
    ],
  });
}

function explosionGame(): GameFacts {
  const f = benchGame();
  f.lines = f.lines.map((l) => (l.name === "Kendrick Nunn" ? { ...l, points: 38, pir: 41, prevHighPoints: 36, fg2m: 7, fg2a: 10, fg3m: 6, fg3a: 9, ftm: 6, fta: 6, last5Points: [21, 17, 25, 19, 38] } : l));
  f.lines = f.lines.map((l) => (l.isStarter === false && l.teamId === HOME ? { ...l, points: 4 } : l));
  return f;
}

function comebackGame(): GameFacts {
  const f = benchGame();
  f.lines = f.lines.map((l) => (l.isStarter === false ? { ...l, points: 3 } : l));
  f.home = { ...f.home, score: 80 };
  f.away = { ...f.away, score: 74 };
  f.margins = Array.from({ length: 41 }, (_, i) => ({ t: i * 60, margin: i < 18 ? -Math.round(i * 1.0) : Math.round(-18 + (i - 18) * 1.05) }));
  return f;
}

function clutchGame(): GameFacts {
  const f = benchGame();
  f.lines = f.lines.map((l) => (l.isStarter === false ? { ...l, points: 2 } : l));
  f.home = { ...f.home, score: 101, name: "Panathinaikos AKTOR Athens", logoUrl: "https://example.invalid/missing-logo.png" };
  f.away = { ...f.away, score: 99 };
  f.overtime = true;
  f.lines.push(line(HOME, "long", 12, { name: "Nikola Kalinić-Marinković Jr.", isStarter: false }));
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
  const f = benchGame();
  f.lines = f.lines.map((l) => ({ ...l, isStarter: null, points: Math.min(l.points, 14) }));
  f.stints = [];
  return f;
}

const cases: [string, GameFacts, (f: GameFacts) => Story | null, Lang][] = [
  ["bench-en", benchGame(), evaluateBench, "en"],
  ["bench-el", benchGame(), evaluateBench, "el"],
  ["lineup-en", benchGame(), evaluateLineup, "en"],
  ["explosion-en", explosionGame(), evaluateExplosion, "en"],
  ["comeback-el", comebackGame(), evaluateComeback, "el"],
  ["clutch-ot-longname-badlogo-en", clutchGame(), evaluateClutch, "en"],
  ["numbers-el", numbersGame(), pickStory, "el"],
  ["auto-pick-en", benchGame(), pickStory, "en"],
];

for (const [name, facts, pick, lang] of cases) {
  const story = pick(facts);
  if (!story) throw new Error(`${name}: fixture produced no story`);
  const png = await renderStoryPng(story, facts, storyText(story, facts, lang));
  fs.writeFileSync(path.join(outDir, `${name}.png`), png);
  console.log("wrote", name, story.angle, `${Math.round(png.length / 1024)} KB`);
}
