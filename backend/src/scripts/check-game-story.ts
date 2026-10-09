// Node checks for game story cards (no test suite in this repo).
// Run from backend/: npx tsx src/scripts/check-game-story.ts
import assert from "node:assert/strict";
import {
  evaluateBench,
  evaluateClutch,
  evaluateComeback,
  evaluateExplosion,
  evaluateLineup,
  lineupTypeRows,
  pickStory,
} from "../services/gameStory/angles.js";
import { AWAY, HOME, baseFacts, line, stint } from "./game-story-fixtures.js";
import { storyText } from "../services/gameStory/copy.js";
import { derivePlays, formatName } from "../services/gameStory/plays.js";
import { withStoryMeta } from "../services/gameStory/meta.js";
import { BoundedCache, storyVersion } from "../services/gameStory/cache.js";
import { accentFor, logoDataUriFromBytes } from "../services/gameStory/logo.js";

const pending: Promise<void>[] = [];
function check(name: string, fn: () => void | Promise<void>) {
  const r = fn();
  if (r instanceof Promise) pending.push(r.then(() => console.log("ok", name)));
  else console.log("ok", name);
}

check("bench triggers at 35", () => {
  const lowShare = (benchEach: number) =>
    baseFacts({
      lines: [
        ...[1, 2, 3, 4, 5].map((i) => line(HOME, `h${i}`, 20, { isStarter: true })), // starters 100 -> share low
        ...[6, 7, 8, 9, 10].map((i) => line(HOME, `h${i}`, benchEach)),
        line(AWAY, "a1", 10, { isStarter: true }),
      ],
      home: { ...baseFacts().home, score: 100 + benchEach * 5 },
    });
  assert.equal(evaluateBench(lowShare(6.8)), null); // 34 pts, share 34/134 < 45%
  const s = evaluateBench(lowShare(7)); // 35 pts
  assert.ok(s);
  assert.equal(s!.score, 1);
});

check("bench share rule", () => {
  const s = evaluateBench(baseFacts()); // 40 bench of 80 = 50%; points 40 >= 35 too -> max ratio
  assert.ok(s);
  assert.equal(Math.round(s!.score * 1000) / 1000, Math.round(Math.max(40 / 35, 0.5 / 0.45) * 1000) / 1000);
});

check("lineup needs 360s and +10", () => {
  const five = ["h1", "h2", "h3", "h4", "h6"];
  assert.equal(evaluateLineup(baseFacts({ stints: [stint(HOME, five, 300, 20, 8)] })), null);
  const s = evaluateLineup(baseFacts({ stints: [stint(HOME, five, 400, 20, 8)] }));
  assert.ok(s);
  assert.equal(s!.score, 1.2);
  // Sums repeated stints of the same five.
  const t = evaluateLineup(baseFacts({ stints: [stint(HOME, five, 200, 10, 4), stint(HOME, [...five].reverse(), 200, 10, 4)] }));
  assert.ok(t);
  assert.equal(t!.score, 1.2);
});

check("lineupTypeRows buckets by starters on court", () => {
  const f = baseFacts({
    stints: [
      stint(HOME, ["h6", "h7", "h8", "h9", "h1"], 600, 20, 10), // 1 starter
      stint(HOME, ["h1", "h2", "h6", "h7", "h8"], 300, 5, 9), // 2 starters
      stint(HOME, ["h1", "h2", "h3", "h4", "h5"], 900, 15, 14), // 5 starters
    ],
  });
  const rows = lineupTypeRows(f, HOME);
  assert.deepEqual(rows.map((r) => [r.label, r.seconds, r.ptsFor, r.ptsAgainst]), [
    ["0-1", 600, 20, 10],
    ["2-3", 300, 5, 9],
    ["4-5", 900, 15, 14],
  ]);
});

check("explosion uses larger ratio", () => {
  const pts = evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 30, { pir: 20, isStarter: true })] }));
  assert.ok(pts);
  assert.equal((pts!.data as { stat: string }).stat, "points");
  const pir = evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 20, { pir: 40, isStarter: true })] }));
  assert.ok(pir);
  assert.equal((pir!.data as { stat: string }).stat, "pir");
  assert.equal(evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 27, { pir: 31 })] })), null);
});

check("career high only above previous", () => {
  const at = evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 30, { pir: 10, prevHighPoints: 30 })] }));
  assert.equal((at!.data as { careerHigh: boolean }).careerHigh, false);
  const above = evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 31, { pir: 10, prevHighPoints: 30 })] }));
  assert.equal((above!.data as { careerHigh: boolean }).careerHigh, true);
  const none = evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 31, { pir: 10, prevHighPoints: null })] }));
  assert.equal((none!.data as { careerHigh: boolean }).careerHigh, false); // no history -> no claim
});

check("comeback from margins", () => {
  const margins = [{ t: 0, margin: 0 }, { t: 600, margin: -14 }, { t: 2400, margin: 10 }];
  const s = evaluateComeback(baseFacts({ margins }));
  assert.ok(s);
  assert.equal(s!.score, 14 / 12);
  assert.equal((s!.data as { deficit: number }).deficit, 14);
  assert.equal(evaluateComeback(baseFacts({ margins: [{ t: 0, margin: -11 }] })), null);
  // Away winner: deficit is a positive home margin.
  const away = baseFacts({ home: { ...baseFacts().home, score: 70 }, away: { ...baseFacts().away, score: 80 }, margins: [{ t: 5, margin: 13 }] });
  assert.equal((evaluateComeback(away)!.data as { deficit: number }).deficit, 13);
});

check("clutch margin or OT", () => {
  const close = (margin: number, ot = false) =>
    baseFacts({ home: { ...baseFacts().home, score: 70 + margin }, away: { ...baseFacts().away, score: 70 }, overtime: ot });
  assert.equal(evaluateClutch(close(2))!.score, 1.5);
  assert.equal(evaluateClutch(close(5)), null);
  assert.ok(evaluateClutch(close(5, true)));
  assert.equal(evaluateClutch(close(2, true))!.score, 2.5);
});

check("highest score wins, ties by table order", () => {
  // Bench (score ~1.14) vs comeback 14/12 (~1.17) -> comeback.
  const f = baseFacts({ margins: [{ t: 1, margin: -14 }] });
  assert.equal(pickStory(f).angle, "comeback");
  // Equal scores: bench 35/35=1 and comeback 12/12=1 -> bench first in table order.
  const tie = baseFacts({
    lines: [...[1, 2, 3, 4, 5].map((i) => line(HOME, `h${i}`, 20, { isStarter: true })), ...[6, 7, 8, 9, 10].map((i) => line(HOME, `h${i}`, 7))],
    home: { ...baseFacts().home, score: 135 },
    margins: [{ t: 1, margin: -12 }],
  });
  assert.equal(pickStory(tie).angle, "bench");
});

check("fallback when nothing qualifies", () => {
  const f = baseFacts({ lines: [line(HOME, "h1", 10, { isStarter: true }), line(AWAY, "a1", 9, { isStarter: true })] });
  const s = pickStory(f);
  assert.equal(s.angle, "numbers");
  assert.equal(s.score, 0);
});

check("missing data skips angles", () => {
  const noFlags = baseFacts();
  noFlags.lines = noFlags.lines.map((l) => ({ ...l, isStarter: null }));
  assert.equal(evaluateBench(noFlags), null);
  assert.equal(evaluateLineup(baseFacts({ stints: [] })), null);
  assert.equal(evaluateComeback(baseFacts({ margins: [] })), null);
  assert.ok(pickStory(noFlags)); // still a story
});

// One story per angle, for the copy checks.
function storiesByAngle() {
  const five = ["h1", "h2", "h3", "h6", "h7"];
  const lineupFacts = baseFacts({ stints: [stint(HOME, five, 600, 30, 12), stint(HOME, ["h1", "h2", "h3", "h4", "h5"], 900, 20, 24)] });
  const close = baseFacts({
    home: { ...baseFacts().home, score: 72 },
    overtime: true,
    clutchPoints: [{ playerName: "Kendrick Nunn", teamId: HOME, points: 7 }],
    clutchPlays: [{ t: 2690, period: 5, clock: 10, teamId: HOME, playerName: "Kendrick Nunn", playType: "3FGM", homeScore: 72, awayScore: 70 }],
  });
  const noFlags = baseFacts({ lines: [line(HOME, "h1", 10, { isStarter: null }), line(AWAY, "a1", 9, { isStarter: null })] });
  return {
    bench: evaluateBench(baseFacts())!,
    lineup: evaluateLineup(lineupFacts)!,
    explosion: evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 34, { pir: 30, prevHighPoints: 31 })] }))!,
    comeback: evaluateComeback(baseFacts({ margins: [{ t: 300, margin: -15 }, { t: 2400, margin: 10 }] }))!,
    clutch: evaluateClutch(close)!,
    numbers: pickStory(noFlags),
    facts: { bench: baseFacts(), lineup: lineupFacts, explosion: baseFacts(), comeback: baseFacts(), clutch: close, numbers: noFlags },
  };
}

check("no placeholder left", () => {
  const all = storiesByAngle();
  for (const angle of ["bench", "lineup", "explosion", "comeback", "clutch", "numbers"] as const) {
    assert.ok(all[angle], `${angle} fixture produced no story`);
    for (const lang of ["en", "el"] as const) {
      const t = storyText(all[angle], all.facts[angle], lang);
      const strings = [t.label, t.headline, t.lede, t.takeaway, t.context, t.matchup, t.shareText, ...(t.footnote ? [t.footnote] : []), ...Object.values(t.labels)];
      for (const s of strings) {
        assert.ok(s.trim().length > 0, `${angle}/${lang}: empty string`);
        assert.ok(!/[{}]/.test(s), `${angle}/${lang}: placeholder left in "${s}"`);
      }
    }
  }
});

check("lede is deterministic", () => {
  const s = storiesByAngle().bench;
  const a = storyText(s, baseFacts({ gameId: "game-A" }), "en").lede;
  assert.equal(storyText(s, baseFacts({ gameId: "game-A" }), "en").lede, a);
  const ledes = new Set(["g1", "g2", "g3", "g4", "g5", "g6"].map((id) => storyText(s, baseFacts({ gameId: id }), "en").lede));
  assert.ok(ledes.size > 1, "variants never rotate");
});

check("share text has link", () => {
  const t = storyText(storiesByAngle().bench, baseFacts(), "el");
  assert.ok(t.shareText.includes("getclutchapp.com/games/game-1"));
  assert.ok(t.shareText.includes("#EuroLeague"));
});

check("feed names to First Last", () => {
  assert.equal(formatName("WRIGHT, MOSES"), "Moses Wright");
  assert.equal(formatName("HAYES-DAVIS, NIGEL"), "Nigel Hayes-Davis");
  assert.equal(formatName("O'NEALE, ROYCE"), "Royce O'Neale");
  assert.equal(formatName("Already Done"), "Already Done");
});

check("play-by-play derivations", () => {
  const ev = (period: number, clock: number, team: string, code: string, type: string, points: number, hb: number, ab: number) => ({
    period, clock, teamId: team, playerCode: code, playType: type, points, homeBefore: hb, awayBefore: ab,
  });
  const names = new Map([["h1", "Kendrick Nunn"], ["a1", "Scottie Wilbekin"]]);
  const events = [
    ev(1, 590, HOME, "h1", "2FGM", 2, 0, 0), // t=10, margin +2
    ev(4, 290, AWAY, "a1", "3FGM", 3, 70, 68), // clutch (Q4 <=300, |2|<=5); 70-71 lead change
    ev(4, 100, HOME, "h1", "2FGM", 2, 70, 71), // clutch, last 2:00, lead change 72-71
    ev(5, 20, HOME, "h1", "FTM", 1, 76, 76), // OT, breaks tie
  ];
  const d = derivePlays(events, names, HOME);
  assert.deepEqual(d.margins[0], { t: 10, margin: 2 });
  assert.equal(d.margins.length, 4);
  assert.equal(d.overtime, true);
  assert.deepEqual(d.clutchPoints.find((c) => c.playerName === "Kendrick Nunn"), { playerName: "Kendrick Nunn", teamId: HOME, points: 3 });
  assert.equal(d.clutchPoints.find((c) => c.playerName === "Scottie Wilbekin")!.points, 3);
  // Lead changes/ties in the last 2:00 of Q4 or any OT only (the 290s play is outside 2:00).
  assert.deepEqual(d.clutchPlays.map((p) => [p.period, p.clock, p.homeScore, p.awayScore]), [[4, 100, 72, 71], [5, 20, 77, 76]]);
  assert.equal(derivePlays([], names, HOME).overtime, false);
});

check("link-preview meta replaces the generic tags", () => {
  const base = `<html><head><title>Clutch</title>
<meta property="og:title" content="Clutch"><meta property="og:image" content="https://x/og.png">
<meta property="og:image:width" content="1200"><meta name="twitter:image" content="https://x/og.png">
</head><body></body></html>`;
  const out = withStoryMeta(base, {
    title: `74 BENCH POINTS · PAN 92–74 "FEN" <b>`,
    description: "The bench won it & more",
    url: "https://getclutchapp.com/games/g1",
    image: "https://getclutchapp.com/api/games/g1/story.png?lang=el",
  });
  assert.equal((out.match(/property="og:image"/g) ?? []).length, 1, "og:image duplicated");
  assert.ok(out.includes(`<meta property="og:image" content="https://getclutchapp.com/api/games/g1/story.png?lang=el">`));
  assert.ok(out.includes(`<meta property="og:image:width" content="1080">`));
  assert.ok(out.includes(`<meta property="og:image:height" content="1350">`)); // inserted, was missing
  assert.ok(out.includes(`<meta name="twitter:image" content="https://getclutchapp.com/api/games/g1/story.png?lang=el">`));
  assert.ok(out.includes("&quot;FEN&quot; &lt;b&gt;"), "title not escaped");
  assert.ok(out.includes("<title>74 BENCH POINTS"));
  assert.ok(out.includes(`content="The bench won it &amp; more"`));
});

check("logo bytes must really be an image", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>');
  assert.ok(logoDataUriFromBytes("image/png", png)?.startsWith("data:image/png;base64,"));
  assert.ok(logoDataUriFromBytes("image/jpg", jpg)?.startsWith("data:image/jpeg;base64,")); // sniffed, not trusted
  assert.ok(logoDataUriFromBytes("image/svg+xml", svg)?.startsWith("data:image/svg+xml;base64,"));
  assert.equal(logoDataUriFromBytes("image/png", Buffer.from("<html>error</html>")), null);
  assert.equal(logoDataUriFromBytes("image/svg+xml", Buffer.from("<svg><circle/></svg>")), null); // no viewBox
  assert.equal(logoDataUriFromBytes("image/webp", Buffer.from("RIFF0000WEBP")), null);
});

check("bounded cache never keeps nulls or stale rejections", async () => {
  const cache = new BoundedCache(2);
  assert.equal(await cache.remember("a", async () => null), null);
  assert.equal(cache.size, 0, "null was cached");
  await cache.remember("x", async () => 1);
  await cache.remember("y", async () => 2);
  await cache.remember("z", async () => 3); // evicts x
  assert.equal(cache.size, 2);
  let calls = 0;
  await cache.remember("x", async () => (calls++, 9));
  assert.equal(calls, 1, "x should have been evicted");
  // A late rejection of an evicted promise must not delete the newer entry.
  let rejectOld!: (e: Error) => void;
  const old = cache.remember("k", () => new Promise((_, rej) => (rejectOld = rej)));
  cache.clear();
  await cache.remember("k", async () => "new");
  rejectOld(new Error("late"));
  await old.catch(() => {});
  assert.equal(await cache.remember("k", async () => "other"), "new");
});

check("story version changes with the story", () => {
  const a = storyVersion(storiesByAngle().bench);
  assert.equal(a, storyVersion(storiesByAngle().bench));
  assert.notEqual(a, storyVersion(storiesByAngle().lineup));
  assert.match(a, /^[0-9a-z]{4,12}$/);
});

check("fallback circle stays visible on white", () => {
  assert.equal(accentFor({ ...baseFacts().home, primaryColor: "#FFFFFF", secondaryColor: "#00529F" }), "#00529F");
});

await Promise.all(pending);
console.log("all game-story checks passed");
