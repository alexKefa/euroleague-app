// Node checks for game story cards (no test suite in this repo).
// Run from backend/: npx tsx src/scripts/check-game-story.ts
import assert from "node:assert/strict";
import {
  evaluateClutch,
  evaluateComeback,
  evaluateEdge,
  edges,
  evaluateExplosion,
  evaluateLineup,
  pickStory,
  tape,
  withKey,
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

check("edge triggers at its threshold", () => {
  // Base game: boards +6, assists +4 etc. all below threshold.
  assert.equal(evaluateEdge(baseFacts()), null);
  // Turnovers: the loser commits 6 more -> ratio 1.
  const tov = baseFacts();
  tov.lines = tov.lines.map((l) => (l.playerCode === "a1" ? { ...l, turnovers: 1 + 6 + 2 } : l)); // away 7+8 = 15 vs home 9
  const s = evaluateEdge(tov);
  assert.ok(s);
  assert.equal(s!.angle, "edge");
  assert.equal((s!.data as { key: string }).key, "turnovers");
  assert.equal(s!.score, 1);
  const below = baseFacts();
  below.lines = below.lines.map((l) => (l.playerCode === "a1" ? { ...l, turnovers: 1 + 6 + 1 } : l)); // +5
  assert.equal(evaluateEdge(below), null);
});

check("edges only count in the winner's favour", () => {
  const f = baseFacts({ quarters: { home: [10, 30, 20, 20], away: [25, 15, 15, 15] } });
  const q = edges(f).find((e) => e.key === "quarter")!;
  assert.deepEqual([q.winner, q.loser, q.diff, q.period], [30, 15, 15, 2]);
  assert.ok(edges(f).every((e) => e.diff > 0));
  // Away winner: the loser's longer run doesn't count as an away edge.
  const away = baseFacts({
    home: { ...baseFacts().home, score: 70 },
    away: { ...baseFacts().away, score: 80 },
    runs: [{ teamId: HOME, points: 20, period: 1, endHome: 20, endAway: 0 }, { teamId: AWAY, points: 14, period: 4, endHome: 60, endAway: 74 }],
  });
  const run = edges(away).find((e) => e.key === "run")!;
  assert.deepEqual([run.winner, run.loser, run.period], [14, 20, 4]);
});

check("tape inverts turnovers", () => {
  const f = baseFacts();
  f.lines = f.lines.map((l) => (l.teamId === AWAY ? { ...l, turnovers: 3 } : l)); // home 9, away 21
  const row = tape(f).find((r) => r.key === "turnovers")!;
  assert.equal(row.winnerBetter, true);
  assert.equal(row.winnerShare, 1 - 9 / 30);
});

check("key note: top edge, or the leader", () => {
  const f = baseFacts({ margins: [{ t: 1, margin: -14 }] }); // comeback; boards +6 = ratio 0.6
  const s = pickStory(f);
  assert.equal(s.angle, "comeback");
  assert.equal(s.key?.kind, "edge");
  assert.equal(s.key?.kind === "edge" && s.key.edge.key, "boards");
  // When the edge is the headline, the strip names the winner's leader.
  const tov = baseFacts();
  tov.lines = tov.lines.map((l) => (l.playerCode === "a1" ? { ...l, turnovers: 20 } : l));
  const e = pickStory(tov);
  assert.equal(e.angle, "edge");
  assert.equal(e.key?.kind, "leader");
  assert.equal(e.key?.kind === "leader" && e.key.line.teamId, HOME);
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
  const tov = (n: number) => baseFacts().lines.map((l) => (l.playerCode === "a1" ? { ...l, turnovers: 3 + n } : l)); // away 9 + n vs home 9
  // Turnover edge 8/6 (~1.33) vs comeback 14/12 (~1.17) -> edge.
  assert.equal(pickStory(baseFacts({ lines: tov(8), margins: [{ t: 1, margin: -14 }] })).angle, "edge");
  // Turnover edge 7/6 (~1.17) vs comeback 15/12 (1.25) -> comeback.
  assert.equal(pickStory(baseFacts({ lines: tov(7), margins: [{ t: 1, margin: -15 }] })).angle, "comeback");
  // Equal scores: edge 6/6=1 and comeback 12/12=1 -> edge first in table order.
  assert.equal(pickStory(baseFacts({ lines: tov(6), margins: [{ t: 1, margin: -12 }] })).angle, "edge");
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
  assert.equal(evaluateEdge(baseFacts({ lines: [], quarters: { home: [], away: [] } })), null);
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
  const edgeFacts = baseFacts({ runs: [{ teamId: HOME, points: 14, period: 3, endHome: 60, endAway: 50 }] });
  return {
    edge: withKey(edgeFacts, evaluateEdge(edgeFacts))!,
    lineup: withKey(lineupFacts, evaluateLineup(lineupFacts))!,
    explosion: withKey(baseFacts(), evaluateExplosion(baseFacts({ lines: [line(HOME, "h1", 34, { pir: 30, prevHighPoints: 31 })] })))!,
    comeback: withKey(baseFacts(), evaluateComeback(baseFacts({ margins: [{ t: 300, margin: -15 }, { t: 2400, margin: 10 }] })))!,
    clutch: withKey(close, evaluateClutch(close))!,
    numbers: pickStory(noFlags),
    facts: { edge: edgeFacts, lineup: lineupFacts, explosion: baseFacts(), comeback: baseFacts(), clutch: close, numbers: noFlags },
  };
}

check("no placeholder left", () => {
  const all = storiesByAngle();
  for (const angle of ["edge", "lineup", "explosion", "comeback", "clutch", "numbers"] as const) {
    assert.ok(all[angle], `${angle} fixture produced no story`);
    for (const lang of ["en", "el"] as const) {
      const t = storyText(all[angle], all.facts[angle], lang);
      const k = t.key;
      const strings = [t.label, t.headline, t.lede, ...(k ? [k.label, k.big, k.title, k.sentence] : []), t.context, t.matchup, t.shareText, ...(t.footnote ? [t.footnote] : []), ...Object.values(t.labels)];
      for (const s of strings) {
        assert.ok(s.trim().length > 0, `${angle}/${lang}: empty string`);
        assert.ok(!/[{}]/.test(s), `${angle}/${lang}: placeholder left in "${s}"`);
      }
    }
  }
});

check("lede is deterministic", () => {
  const s = storiesByAngle().comeback;
  const a = storyText(s, baseFacts({ gameId: "game-A" }), "en").lede;
  assert.equal(storyText(s, baseFacts({ gameId: "game-A" }), "en").lede, a);
  const ledes = new Set(["g1", "g2", "g3", "g4", "g5", "g6"].map((id) => storyText(s, baseFacts({ gameId: id }), "en").lede));
  assert.ok(ledes.size > 1, "variants never rotate");
});

check("share text has link", () => {
  const t = storyText(storiesByAngle().edge, baseFacts(), "el");
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
  // Runs: home 2+1 unanswered across Q4/OT counts as one 3-point run from Q4.
  assert.deepEqual(d.runs.find((r) => r.teamId === HOME), { teamId: HOME, points: 3, period: 4, endHome: 77, endAway: 76 });
  assert.equal(d.runs.find((r) => r.teamId === AWAY)!.points, 3);
  assert.equal(derivePlays([], names, HOME).overtime, false);
});

check("link-preview meta replaces the generic tags", () => {
  const base = `<html><head><title>Clutch</title>
<meta property="og:title" content="Clutch"><meta property="og:image" content="https://x/og.png">
<meta property="og:image:width" content="1200"><meta name="twitter:image" content="https://x/og.png">
</head><body></body></html>`;
  const out = withStoryMeta(base, {
    title: `14–0 RUN · PAN 92–74 "FEN" <b>`,
    description: "Ran away with it & more",
    url: "https://getclutchapp.com/games/g1",
    image: "https://getclutchapp.com/api/games/g1/story.png?lang=el",
  });
  assert.equal((out.match(/property="og:image"/g) ?? []).length, 1, "og:image duplicated");
  assert.ok(out.includes(`<meta property="og:image" content="https://getclutchapp.com/api/games/g1/story.png?lang=el">`));
  assert.ok(out.includes(`<meta property="og:image:width" content="1080">`));
  assert.ok(out.includes(`<meta property="og:image:height" content="1350">`)); // inserted, was missing
  assert.ok(out.includes(`<meta name="twitter:image" content="https://getclutchapp.com/api/games/g1/story.png?lang=el">`));
  assert.ok(out.includes("&quot;FEN&quot; &lt;b&gt;"), "title not escaped");
  assert.ok(out.includes("<title>14–0 RUN"));
  assert.ok(out.includes(`content="Ran away with it &amp; more"`));
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
  const a = storyVersion(storiesByAngle().edge);
  assert.equal(a, storyVersion(storiesByAngle().edge));
  assert.notEqual(a, storyVersion(storiesByAngle().lineup));
  assert.match(a, /^[0-9a-z]{4,12}$/);
});

check("fallback circle stays visible on white", () => {
  assert.equal(accentFor({ ...baseFacts().home, primaryColor: "#FFFFFF", secondaryColor: "#00529F" }), "#00529F");
});

await Promise.all(pending);
console.log("all game-story checks passed");
