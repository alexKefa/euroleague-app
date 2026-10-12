// Game story cards (2026-10-09): the 1080x1350 PNG. A satori element tree
// (plain objects, no JSX) rendered by resvg, with the app's own Sofia Sans
// bundled in assets/fonts (OFL) so Greek renders and the look matches the
// app.
//
// The Clutch look (2026-10-12 redesign): the promo pieces' near-black
// ground with a glow in the winner's colour; a scoreboard hero with the
// game's flow traced behind the score; the angle's headline; one body
// panel; and a solid "What won it" strip in the winner's colour.
import fs from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { loserOf, winnerOf } from "./angles.js";
import { upper, type StoryText } from "./copy.js";
import { accentOnDark, forgetLogo, inkOn, logoDataUri } from "./logo.js";
import type { ClutchPlay, EdgeData, GameFacts, LineFacts, MarginPoint, Story, TapeRow, TeamFacts } from "./types.js";

const W = 1080;
const H = 1350;
const PAD = 60;
const GROUND = "#0B0C0F";
const PANEL = "#15171C";
const LINE = "#262931";
const TEXT = "#F0F0EC";
const DIM = "#9A9DA6";
const FAINT = "#3A3D46";
const LOSER = "#4A4E58";
const BODY = "Sofia Sans";
const COND = "Sofia Sans Condensed";

type El = { type: string; props: Record<string, unknown> };
type Child = El | string | null | false;

function h(type: string, style: Record<string, unknown>, ...children: Child[]): El {
  const kids = children.filter((c): c is El | string => c !== null && c !== false);
  return { type, props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids } };
}
const text = (s: string, style: Record<string, unknown> = {}) => h("div", style, s);
const img = (src: string, width: number, height: number, style: Record<string, unknown> = {}): El => ({
  type: "img",
  props: { src, width, height, style: { objectFit: "contain", ...style } },
});
const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// --- assets -----------------------------------------------------------------

const ASSETS = path.resolve(process.cwd(), "assets");
let fonts: { name: string; data: Buffer; weight: 400 | 600 | 800; style: "normal" }[] | null = null;
function loadFonts() {
  fonts ??= [
    { name: BODY, data: fs.readFileSync(path.join(ASSETS, "fonts/SofiaSans-400.woff")), weight: 400, style: "normal" },
    { name: BODY, data: fs.readFileSync(path.join(ASSETS, "fonts/SofiaSans-600.woff")), weight: 600, style: "normal" },
    { name: COND, data: fs.readFileSync(path.join(ASSETS, "fonts/SofiaSansCondensed-800.woff")), weight: 800, style: "normal" },
  ];
  return fonts;
}

let logoMark: string | null = null;
function clutchLogo(): string {
  logoMark ??= `data:image/svg+xml;base64,${fs.readFileSync(path.join(ASSETS, "brand/clutch-compact-dark.svg")).toString("base64")}`;
  return logoMark;
}

// --- shared pieces ----------------------------------------------------------

interface Ctx {
  f: GameFacts;
  t: StoryText;
  accent: string;
  winner: TeamFacts;
  loser: TeamFacts;
  logos: Map<string, string | null>; // team id -> data URI
}

const sign = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const mins = (seconds: number) => (seconds / 60).toFixed(1);
const lastName = (n: string) => n.split(" ").slice(-1)[0];

function teamMark(c: Ctx, team: TeamFacts, size: number) {
  const logo = c.logos.get(team.id);
  return logo
    ? img(logo, size, size)
    : h("div", { width: size, height: size, borderRadius: size / 2, backgroundColor: accentOnDark(team), flexShrink: 0 });
}

function sectionTitle(s: string, color = DIM) {
  return text(upper(s), { fontFamily: COND, fontWeight: 800, fontSize: 24, letterSpacing: 3, color, marginBottom: 14 });
}

// A small "■ LABEL" tag, the card's recurring marker.
function tag(s: string, color: string) {
  return h(
    "div",
    { alignItems: "center", gap: 12 },
    h("div", { width: 14, height: 14, backgroundColor: color, transform: "rotate(45deg)" }),
    text(s, { fontFamily: COND, fontWeight: 800, fontSize: 26, letterSpacing: 4, color })
  );
}

// The game's flow (home - away margin) as a faint line from the winner's
// side: drawn behind the scoreboard, the card's signature.
function pulse(c: Ctx, width: number, height: number): string | null {
  if (c.f.margins.length < 4) return null;
  const s = c.winner.id === c.f.home.id ? 1 : -1;
  const pts = [{ t: 0, margin: 0 }, ...c.f.margins];
  const maxT = Math.max(2400, ...pts.map((m) => m.t));
  const maxAbs = Math.max(8, ...pts.map((m) => Math.abs(m.margin)));
  const x = (t: number) => ((t / maxT) * width).toFixed(1);
  const y = (m: number) => (height / 2 - ((m * s) / maxAbs) * (height / 2 - 6)).toFixed(1);
  // A step line: the margin holds until the next basket.
  let d = `M0 ${y(0)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t)} V${y(pts[i].margin)}`;
  d += ` H${width}`;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="${TEXT}" stroke-opacity="0.10" stroke-width="2"/>
    <path d="${d} V${height / 2} H0 Z" fill="${c.accent}" fill-opacity="0.08"/>
    <path d="${d}" fill="none" stroke="${c.accent}" stroke-opacity="0.45" stroke-width="3" stroke-linejoin="round"/>
  </svg>`);
}

function scoreboard(c: Ctx) {
  const { f } = c;
  const side = (team: TeamFacts, align: "flex-start" | "flex-end") => {
    const won = team.id === c.winner.id;
    return h(
      "div",
      { flexDirection: "column", alignItems: align, gap: 12, width: 240 },
      teamMark(c, team, 84),
      text(upper(team.name, "en"), {
        fontFamily: COND,
        fontWeight: 800,
        fontSize: 26,
        lineHeight: 1.05,
        letterSpacing: 1,
        color: won ? TEXT : DIM,
        textAlign: align === "flex-start" ? "left" : "right",
        justifyContent: align,
      })
    );
  };
  const digits = Math.max(String(f.home.score).length, String(f.away.score).length);
  const score = (team: TeamFacts) => {
    const won = team.id === c.winner.id;
    return h(
      "div",
      { flexDirection: "column", alignItems: "center", width: digits > 2 ? 200 : 180 },
      text(String(team.score), { fontFamily: COND, fontWeight: 800, fontSize: digits > 2 ? 122 : 150, lineHeight: 0.9, color: won ? TEXT : LOSER, letterSpacing: -2 }),
      h("div", { width: 110, height: 9, marginTop: 10, backgroundColor: won ? c.accent : "transparent" })
    );
  };
  const flow = pulse(c, W - PAD * 2, 190);
  return h(
    "div",
    { position: "relative", justifyContent: "space-between", alignItems: "center", height: 210, flexShrink: 0 },
    flow ? h("div", { position: "absolute", left: 0, top: 10 }, img(flow, W - PAD * 2, 190)) : null,
    side(f.home, "flex-start"),
    h("div", { alignItems: "center" }, score(f.home), text("–", { fontFamily: COND, fontWeight: 800, fontSize: 64, color: LOSER, margin: "0 6px 22px" }), score(f.away)),
    side(f.away, "flex-end")
  );
}

// "Tale of the tape": winner left, loser right, a split bar per stat.
// `hot` is the row that won the game.
function tapeRows(c: Ctx, rows: TapeRow[], hot: TapeRow["key"] | null, compact = false) {
  if (rows.length === 0) return null;
  const label: Record<TapeRow["key"], string> = {
    shooting: c.t.labels.tapeShooting,
    threes: c.t.labels.tapeThrees,
    boards: c.t.labels.tapeBoards,
    assists: c.t.labels.tapeAssists,
    turnovers: c.t.labels.tapeTurnovers,
    freeThrows: c.t.labels.tapeFreeThrows,
  };
  return h(
    "div",
    { flexDirection: "column", gap: compact ? 10 : 13 },
    h(
      "div",
      { justifyContent: "space-between", alignItems: "center", marginBottom: 2 },
      h("div", { alignItems: "center", gap: 10 }, teamMark(c, c.winner, 30), text(upper(c.winner.code, "en"), { fontFamily: COND, fontWeight: 800, fontSize: 22, letterSpacing: 2, color: TEXT })),
      h("div", { alignItems: "center", gap: 10 }, text(upper(c.loser.code, "en"), { fontFamily: COND, fontWeight: 800, fontSize: 22, letterSpacing: 2, color: DIM }), teamMark(c, c.loser, 30))
    ),
    ...rows.map((r) => {
      const isHot = r.key === hot;
      const size = compact ? 30 : 34;
      return h(
        "div",
        { flexDirection: "column", gap: 6 },
        h(
          "div",
          { justifyContent: "space-between", alignItems: "baseline" },
          text(r.winner, { width: 160, fontFamily: COND, fontWeight: 800, fontSize: size, color: r.winnerBetter ? c.accent : TEXT }),
          text(upper(label[r.key]), { fontFamily: COND, fontWeight: 800, fontSize: 21, letterSpacing: 3, color: isHot ? TEXT : DIM }),
          text(r.loser, { width: 160, justifyContent: "flex-end", fontFamily: COND, fontWeight: 800, fontSize: size, color: r.winnerBetter ? DIM : TEXT })
        ),
        h(
          "div",
          { height: isHot ? 12 : 6, borderRadius: 6, backgroundColor: FAINT, overflow: "hidden" },
          h("div", { width: `${Math.round(Math.min(1, Math.max(0, r.winnerShare)) * 100)}%`, height: "100%", backgroundColor: c.accent, opacity: isHot ? 1 : 0.7 })
        )
      );
    })
  );
}

// Quarter by quarter, the decisive one lit up.
function quarterGrid(c: Ctx, hot: number | null) {
  const wq = c.winner.id === c.f.home.id ? c.f.quarters.home : c.f.quarters.away;
  const lq = c.winner.id === c.f.home.id ? c.f.quarters.away : c.f.quarters.home;
  const n = Math.min(wq.length, lq.length);
  if (n === 0) return null;
  const cell = (i: number) => {
    const isHot = hot === i + 1;
    return h(
      "div",
      { flexDirection: "column", alignItems: "center", flex: 1, padding: "14px 0", borderRadius: 16, backgroundColor: isHot ? c.accent : "transparent", border: `2px solid ${isHot ? c.accent : LINE}` },
      text(i < 4 ? `Q${i + 1}` : "OT", { fontFamily: COND, fontWeight: 800, fontSize: 20, letterSpacing: 3, color: isHot ? inkOn(c.accent) : DIM }),
      text(String(wq[i]), { fontFamily: COND, fontWeight: 800, fontSize: 44, lineHeight: 1.1, color: isHot ? inkOn(c.accent) : TEXT }),
      text(String(lq[i]), { fontFamily: COND, fontWeight: 800, fontSize: 30, color: isHot ? inkOn(c.accent) : DIM, opacity: isHot ? 0.75 : 1 })
    );
  };
  return h("div", { gap: 12, marginBottom: 22 }, ...Array.from({ length: n }, (_, i) => cell(i)));
}

// --- bodies -----------------------------------------------------------------

const TAPE_KEY: Partial<Record<EdgeData["key"], TapeRow["key"]>> = {
  threes: "threes",
  boards: "boards",
  turnovers: "turnovers",
  freeThrows: "freeThrows",
  assists: "assists",
  shooting: "shooting",
};

function edgeBody(story: Extract<Story, { angle: "edge" }>, c: Ctx) {
  const d = story.data;
  if (d.key === "run" || d.key === "quarter") {
    return [
      quarterGrid(c, d.period),
      sectionTitle(c.t.labels.tape),
      tapeRows(c, d.tape.filter((r) => r.key !== "freeThrows" && r.key !== "assists"), null, true),
    ];
  }
  return [sectionTitle(c.t.labels.tape), tapeRows(c, d.tape, TAPE_KEY[d.key] ?? null)];
}

function lineupBody(story: Extract<Story, { angle: "lineup" }>, c: Ctx) {
  const l = story.data.lineup;
  const stat = (big: string, small: string, color = TEXT) =>
    h("div", { flexDirection: "column" }, text(big, { fontFamily: COND, fontWeight: 800, fontSize: 52, lineHeight: 1, color }), text(upper(small), { fontSize: 18, letterSpacing: 2, color: DIM, marginTop: 6 }));
  const team = l.teamId === c.f.home.id ? c.f.home : c.f.away;
  return [
    h("div", { alignItems: "center", gap: 14, marginBottom: 10 }, teamMark(c, team, 34), sectionTitle(c.t.labels.bestLineup, DIM)),
    text(l.names.map(lastName).join(" · "), { fontFamily: COND, fontWeight: 800, fontSize: 36, lineHeight: 1.1, color: TEXT, marginBottom: 20 }),
    h(
      "div",
      { justifyContent: "space-between", paddingBottom: 24, marginBottom: 22, borderBottom: `2px solid ${LINE}` },
      stat(mins(l.seconds), c.t.labels.min),
      stat(`${l.ptsFor}–${l.ptsAgainst}`, c.t.labels.score),
      stat(sign(l.plusMinus), c.t.labels.pm),
      stat(l.netRating !== null ? sign(Math.round(l.netRating)) : "—", `${c.t.labels.netRating} · ≈${l.possessions}`, c.accent)
    ),
    tapeRows(c, story.data.tape.slice(0, 4), null, true),
  ];
}

function explosionBody(story: Extract<Story, { angle: "explosion" }>, c: Ctx) {
  const l = story.data.line;
  const team = l.teamId === c.f.home.id ? c.f.home : c.f.away;
  const color = accentOnDark(team);
  const box = (v: string, k: string, hot: boolean) =>
    h(
      "div",
      { flexDirection: "column", alignItems: "center", flex: 1, borderRadius: 18, padding: "14px 0", backgroundColor: hot ? color : "transparent", border: `2px solid ${hot ? color : LINE}` },
      text(v, { fontFamily: COND, fontWeight: 800, fontSize: 64, lineHeight: 1, color: hot ? inkOn(color) : TEXT }),
      text(k, { fontFamily: COND, fontWeight: 800, fontSize: 20, letterSpacing: 3, marginTop: 6, color: hot ? inkOn(color) : DIM })
    );
  const max = Math.max(1, ...l.last5Points);
  return [
    h(
      "div",
      { alignItems: "center", gap: 16, marginBottom: 18 },
      teamMark(c, team, 44),
      text(l.name, { fontFamily: COND, fontWeight: 800, fontSize: 42, color: TEXT }),
      story.data.careerHigh ? text(upper(c.t.labels.careerHigh), { fontFamily: COND, fontWeight: 800, fontSize: 20, letterSpacing: 2, color: inkOn(color), backgroundColor: color, padding: "6px 12px", borderRadius: 8 }) : null
    ),
    h("div", { gap: 12 }, box(String(l.points), c.t.labels.colPts, story.data.stat === "points"), box(String(l.rebounds), c.t.labels.colReb, false), box(String(l.assists), c.t.labels.colAst, false), box(String(l.pir), "PIR", story.data.stat === "pir")),
    h(
      "div",
      { justifyContent: "space-between", marginTop: 20, padding: "16px 0", borderTop: `2px solid ${LINE}`, borderBottom: `2px solid ${LINE}` },
      ...[["2P", l.fg2m, l.fg2a], ["3P", l.fg3m, l.fg3a], ["FT", l.ftm, l.fta]].map(([k, m, a]) =>
        h("div", { alignItems: "baseline", gap: 10 }, text(String(k), { fontFamily: COND, fontWeight: 800, fontSize: 22, letterSpacing: 2, color: DIM }), text(`${m}/${a}`, { fontFamily: COND, fontWeight: 800, fontSize: 36, color: TEXT }))
      )
    ),
    h(
      "div",
      { flexDirection: "column", marginTop: 18 },
      sectionTitle(c.t.labels.last5),
      h(
        "div",
        { alignItems: "flex-end", gap: 14, height: 104 },
        ...l.last5Points.map((p, i) => {
          const now = i === l.last5Points.length - 1;
          return h(
            "div",
            { flexDirection: "column", alignItems: "center", flex: 1, justifyContent: "flex-end", height: "100%" },
            text(String(p), { fontFamily: COND, fontWeight: 800, fontSize: 26, color: now ? color : DIM }),
            h("div", { width: "100%", height: Math.max(6, Math.round((p / max) * 66)), borderRadius: 6, backgroundColor: now ? color : FAINT })
          );
        })
      )
    ),
  ];
}

function marginChart(margins: MarginPoint[], lowAt: number, accent: string, cw: number, ch: number): string {
  const maxT = Math.max(2400, ...margins.map((m) => m.t));
  const maxAbs = Math.max(5, ...margins.map((m) => Math.abs(m.margin)));
  const x = (t: number) => (t / maxT) * cw;
  const y = (m: number) => ch / 2 - (m / maxAbs) * (ch / 2 - 14);
  const pts = margins.map((m) => `${x(m.t).toFixed(1)},${y(m.margin).toFixed(1)}`).join(" ");
  const low = margins.find((m) => m.t === lowAt) ?? margins[0];
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}">
    ${[600, 1200, 1800].map((q) => `<line x1="${x(q)}" y1="0" x2="${x(q)}" y2="${ch}" stroke="${LINE}" stroke-width="2"/>`).join("")}
    <line x1="0" y1="${ch / 2}" x2="${cw}" y2="${ch / 2}" stroke="${DIM}" stroke-opacity="0.6" stroke-width="2" stroke-dasharray="6 8"/>
    <polygon points="0,${ch / 2} ${pts} ${x(margins[margins.length - 1].t).toFixed(1)},${ch / 2}" fill="${accent}" fill-opacity="0.14"/>
    <polyline points="${pts}" fill="none" stroke="${accent}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(low.t)}" cy="${y(low.margin)}" r="13" fill="${GROUND}" stroke="${accent}" stroke-width="6"/>
  </svg>`);
}

function comebackBody(story: Extract<Story, { angle: "comeback" }>, c: Ctx) {
  const cw = W - PAD * 2 - 64;
  return [
    sectionTitle(c.t.labels.margin),
    img(marginChart(story.data.margins, story.data.lowAt, c.accent, cw, 380), cw, 380),
    h("div", { marginTop: 10 }, ...["Q1", "Q2", "Q3", "Q4"].map((q) => text(q, { flex: 1, justifyContent: "center", fontFamily: COND, fontWeight: 800, fontSize: 20, letterSpacing: 3, color: DIM }))),
  ];
}

function clockLabel(p: ClutchPlay): string {
  const m = Math.floor(p.clock / 60);
  const s = String(p.clock % 60).padStart(2, "0");
  return `${p.period > 4 ? `OT${p.period > 5 ? p.period - 4 : ""}` : `Q${p.period}`} ${m}:${s}`;
}

function clutchBody(story: Extract<Story, { angle: "clutch" }>, c: Ctx) {
  const playLabel = (p: string) => (p === "3FGM" ? "3PT" : p === "2FGM" ? "2PT" : p === "FTM" ? "FT" : p);
  const plays = story.data.plays;
  return [
    sectionTitle(plays.length > 0 ? c.t.labels.keyPlays : c.t.labels.topScorers),
    plays.length > 0
      ? h(
          "div",
          { flexDirection: "column" },
          ...plays.map((p, i) => {
            const team = p.teamId === c.f.home.id ? c.f.home : p.teamId === c.f.away.id ? c.f.away : null;
            const last = i === plays.length - 1;
            return h(
              "div",
              { alignItems: "center", gap: 16, padding: "10px 0", borderTop: i === 0 ? "none" : `2px solid ${LINE}` },
              text(clockLabel(p), { width: 120, fontFamily: COND, fontWeight: 800, fontSize: 24, letterSpacing: 1, color: DIM }),
              team ? teamMark(c, team, 30) : null,
              text(`${p.playerName ?? ""}`, { flex: 1, fontSize: 26, fontWeight: 600, color: TEXT, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }),
              text(playLabel(p.playType), { width: 60, fontFamily: COND, fontWeight: 800, fontSize: 22, color: DIM }),
              text(`${p.homeScore}–${p.awayScore}`, { width: 110, justifyContent: "flex-end", fontFamily: COND, fontWeight: 800, fontSize: 32, color: last ? c.accent : TEXT })
            );
          })
        )
      : topScorers(c, 3),
    story.data.hero
      ? h(
          "div",
          { alignItems: "center", gap: 22, marginTop: "auto", paddingTop: 16 },
          text(String(story.data.hero.points), { fontFamily: COND, fontWeight: 800, fontSize: 88, lineHeight: 1, color: c.accent }),
          h("div", { flexDirection: "column" }, text(story.data.hero.playerName, { fontFamily: COND, fontWeight: 800, fontSize: 34, color: TEXT }), text(c.t.labels.clutchPts, { fontSize: 22, color: DIM }))
        )
      : null,
  ];
}

// Each team's top scorers, side by side.
function topScorers(c: Ctx, n: number) {
  const col = (team: TeamFacts) => {
    const top = c.f.lines.filter((l) => l.teamId === team.id).sort((a, b) => b.points - a.points).slice(0, n);
    return h(
      "div",
      { flexDirection: "column", flex: 1, gap: 8 },
      h("div", { alignItems: "center", gap: 10, marginBottom: 4 }, teamMark(c, team, 28), text(upper(team.code, "en"), { fontFamily: COND, fontWeight: 800, fontSize: 22, letterSpacing: 2, color: DIM })),
      ...top.map((l: LineFacts) =>
        h(
          "div",
          { alignItems: "baseline", gap: 12 },
          text(String(l.points), { width: 54, fontFamily: COND, fontWeight: 800, fontSize: 38, color: team.id === c.winner.id ? c.accent : TEXT }),
          text(l.name, { flex: 1, fontSize: 24, fontWeight: 600, color: TEXT, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" })
        )
      )
    );
  };
  return h("div", { gap: 28 }, col(c.f.home), col(c.f.away));
}

function numbersBody(story: Extract<Story, { angle: "numbers" }>, c: Ctx) {
  return [
    sectionTitle(c.t.labels.topScorers),
    topScorers(c, 2),
    story.data.tape.length > 0 ? h("div", { flexDirection: "column", marginTop: 24 }, sectionTitle(c.t.labels.tape), tapeRows(c, story.data.tape.slice(0, 4), null, true)) : null,
  ];
}

// --- card -------------------------------------------------------------------

function headlineParts(headline: string): [string, string] {
  const m = /^([+\-–]?\d[\d–\-]*%?)\s+(.*)$/.exec(headline);
  return m ? [m[1], m[2]] : ["", headline];
}

function keyStrip(c: Ctx) {
  const k = c.t.key;
  if (!k) return null;
  const ink = inkOn(c.accent);
  return h(
    "div",
    { alignItems: "center", gap: 30, backgroundColor: c.accent, borderRadius: 28, padding: "24px 34px", marginTop: 22, flexShrink: 0 },
    text(k.big, { fontFamily: COND, fontWeight: 800, fontSize: k.big.length > 5 ? 82 : 100, lineHeight: 1, color: ink, letterSpacing: -1 }),
    h(
      "div",
      { flexDirection: "column", flex: 1, gap: 4, paddingLeft: 28, borderLeft: `3px solid ${ink === "#FFFFFF" ? "rgba(255,255,255,0.35)" : "rgba(11,12,15,0.25)"}` },
      text(k.label, { fontFamily: COND, fontWeight: 800, fontSize: 20, letterSpacing: 4, color: ink, opacity: 0.7 }),
      text(k.title, { fontFamily: COND, fontWeight: 800, fontSize: 32, lineHeight: 1.05, letterSpacing: 1, color: ink }),
      text(k.sentence, { fontSize: 24, lineHeight: 1.25, color: ink, marginTop: 4 })
    )
  );
}

export async function renderStoryPng(story: Story, f: GameFacts, t: StoryText): Promise<Buffer> {
  const [homeLogo, awayLogo] = await Promise.all([logoDataUri(f.home.logoUrl), logoDataUri(f.away.logoUrl)]);
  try {
    return await renderWith(story, f, t, homeLogo, awayLogo);
  } catch (err) {
    if (!homeLogo && !awayLogo) throw err;
    // A logo satori can't decode after all: forget both, draw circles.
    forgetLogo(f.home.logoUrl);
    forgetLogo(f.away.logoUrl);
    return renderWith(story, f, t, null, null);
  }
}

async function renderWith(story: Story, f: GameFacts, t: StoryText, homeLogo: string | null, awayLogo: string | null): Promise<Buffer> {
  const winner = winnerOf(f);
  const c: Ctx = {
    f,
    t,
    accent: accentOnDark(winner),
    winner,
    loser: loserOf(f),
    logos: new Map([[f.home.id, homeLogo], [f.away.id, awayLogo]]),
  };
  const [num, word] = headlineParts(t.headline);
  const heroSize = Math.max(80, Math.min(116, Math.round(1900 / Math.max(12, t.headline.length))));

  const body =
    story.angle === "edge" ? edgeBody(story, c)
    : story.angle === "lineup" ? lineupBody(story, c)
    : story.angle === "explosion" ? explosionBody(story, c)
    : story.angle === "comeback" ? comebackBody(story, c)
    : story.angle === "clutch" ? clutchBody(story, c)
    : numbersBody(story, c);

  const card = h(
    "div",
    {
      width: W,
      height: H,
      flexDirection: "column",
      backgroundColor: GROUND,
      backgroundImage: `radial-gradient(circle at 50% 0%, ${c.accent}40 0%, ${GROUND}00 60%)`,
      fontFamily: BODY,
      color: TEXT,
      padding: `36px ${PAD}px 0`,
    },
    // Top line: brand, competition, round, date.
    h(
      "div",
      { justifyContent: "space-between", alignItems: "center", flexShrink: 0 },
      img(clutchLogo(), 72, 58),
      text(upper(t.context, "en"), { fontFamily: COND, fontWeight: 800, fontSize: 22, letterSpacing: 3, color: DIM }),
      text(upper(f.overtime ? t.labels.finalOt : t.labels.final), { fontFamily: COND, fontWeight: 800, fontSize: 22, letterSpacing: 3, color: TEXT, border: `2px solid ${FAINT}`, borderRadius: 999, padding: "6px 16px" })
    ),
    // Scoreboard.
    h("div", { flexDirection: "column", marginTop: 18, flexShrink: 0 }, scoreboard(c)),
    // Angle + headline + lede.
    h(
      "div",
      { flexDirection: "column", marginTop: 18, flexShrink: 0 },
      tag(t.label, c.accent),
      h(
        "div",
        { alignItems: "baseline", flexWrap: "wrap", columnGap: 22, marginTop: 10 },
        num ? text(num, { fontFamily: COND, fontWeight: 800, fontSize: heroSize, lineHeight: 0.95, color: c.accent, letterSpacing: -1 }) : null,
        text(word, { fontFamily: COND, fontWeight: 800, fontSize: Math.round(heroSize * (num ? 0.62 : 0.8)), lineHeight: 0.95, color: TEXT })
      ),
      text(t.lede, { fontSize: 28, lineHeight: 1.25, color: TEXT, opacity: 0.82, marginTop: 10 })
    ),
    // Body.
    h(
      "div",
      { flexDirection: "column", backgroundColor: PANEL, border: `2px solid ${LINE}`, borderRadius: 28, padding: "24px 32px", marginTop: 20, flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: "hidden" },
      ...body.filter((b): b is El => !!b).map((b) => h("div", { flexDirection: "column", flexShrink: 0 }, b))
    ),
    // What won it.
    keyStrip(c),
    // Footer.
    h(
      "div",
      { justifyContent: "space-between", alignItems: "center", padding: "18px 0 26px", flexShrink: 0, gap: 30 },
      t.footnote
        ? text(t.footnote, { fontSize: 17, lineHeight: 1.3, color: DIM, maxWidth: 640 })
        : text(t.matchup, { fontSize: 20, color: DIM, maxWidth: 680, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }),
      text("getclutchapp.com", { fontFamily: COND, fontWeight: 800, fontSize: 32, letterSpacing: 1, color: TEXT })
    )
  );

  const svg = await satori(card as never, { width: W, height: H, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng());
}
