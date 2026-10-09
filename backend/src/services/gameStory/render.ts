// Game story cards (2026-10-09): the 1080x1350 PNG. A satori element tree
// (plain objects, no JSX) rendered by resvg, with the app's own Sofia Sans
// bundled in assets/fonts (OFL) so Greek renders and the look matches the
// app. Layout follows the spec's "Card layout" sections 1-7.
import fs from "node:fs";
import path from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { winnerOf } from "./angles.js";
import { upper, type StoryText } from "./copy.js";
import type { ClutchPlay, GameFacts, LineFacts, LineupTypeRow, MarginPoint, Story, TeamFacts } from "./types.js";

const W = 1080;
const H = 1350;
const PAD = 56;
const INK = "#111418";
const MUTED = "#6B6F76";
const PANEL = "#F4F4F2";
const RULE = "#E4E4E0";
const ORANGE = "#FF6B35";
const BODY = "Sofia Sans";
const COND = "Sofia Sans Condensed";

type El = { type: string; props: Record<string, unknown> };
type Child = El | string | null | false;

function h(type: string, style: Record<string, unknown>, ...children: Child[]): El {
  const kids = children.filter((c): c is El | string => c !== null && c !== false);
  return { type, props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids } };
}
const text = (s: string, style: Record<string, unknown> = {}) => h("div", style, s);

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
  logoMark ??= `data:image/svg+xml;base64,${fs.readFileSync(path.join(ASSETS, "brand/clutch-compact.svg")).toString("base64")}`;
  return logoMark;
}

// Team logos: fetched once per URL, 3 s timeout; null = draw a colour circle.
const logoCache = new Map<string, string | null>();
async function logoDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (logoCache.has(url)) return logoCache.get(url)!;
  let uri: string | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && /^image\/(png|jpe?g|svg\+xml)/.test(type)) {
      uri = `data:${type.split(";")[0]};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    }
  } catch {
    uri = null;
  }
  logoCache.set(url, uri);
  return uri;
}

// --- colour -----------------------------------------------------------------

function luma(hex: string | null): number | null {
  const m = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/** The winner's colour, readable on white: too light or too dark falls back. */
export function accentFor(team: TeamFacts): string {
  const ok = (c: string | null) => {
    const l = luma(c);
    return l !== null && l >= 35 && l <= 200;
  };
  if (ok(team.primaryColor)) return team.primaryColor!;
  if (ok(team.secondaryColor)) return team.secondaryColor!;
  return ORANGE;
}

// --- pieces -----------------------------------------------------------------

const sign = (n: number) => `${n > 0 ? "+" : ""}${n}`;
const mins = (seconds: number) => (seconds / 60).toFixed(1);

function teamRow(team: TeamFacts, logo: string | null, won: boolean) {
  return h(
    "div",
    { alignItems: "center", gap: 14, width: 400 },
    logo
      ? { type: "img", props: { src: logo, width: 44, height: 44, style: { objectFit: "contain" } } }
      : h("div", { width: 40, height: 40, borderRadius: 20, backgroundColor: team.primaryColor ?? MUTED }),
    text(team.name, {
      flex: 1,
      fontFamily: COND,
      fontWeight: 800,
      fontSize: 26,
      lineHeight: 1.05,
      color: won ? INK : MUTED,
    }),
    text(String(team.score), { fontFamily: COND, fontWeight: 800, fontSize: 52, color: won ? INK : MUTED })
  );
}

function sectionTitle(s: string) {
  return text(upper(s), { fontFamily: COND, fontWeight: 800, fontSize: 28, letterSpacing: 1, color: INK, marginBottom: 8 });
}

function table(headers: string[], rows: string[][], accentCol: number | null, accent: string) {
  const col = (i: number) => (i === 0 ? { flex: 2 } : { flex: 1, justifyContent: "flex-end" });
  return h(
    "div",
    { flexDirection: "column", backgroundColor: "#FFFFFF", borderRadius: 12 },
    h(
      "div",
      { padding: "10px 18px", backgroundColor: "#ECECE8", borderRadius: "12px 12px 0 0" },
      ...headers.map((t, i) => text(upper(t), { ...col(i), fontSize: 20, fontWeight: 600, color: MUTED, letterSpacing: 1 }))
    ),
    ...rows.map((r, ri) =>
      h(
        "div",
        { padding: "7px 18px", borderTop: ri === 0 ? "none" : `1px solid ${RULE}` },
        ...r.map((c, i) =>
          text(c, {
            ...col(i),
            fontSize: i === 0 ? 24 : 30,
            fontFamily: i === 0 ? BODY : COND,
            fontWeight: i === 0 ? 400 : 800,
            color: i === accentCol && c.startsWith("+") ? accent : INK,
          })
        )
      )
    )
  );
}

function byTypeTable(rows: LineupTypeRow[], t: StoryText, accent: string) {
  if (rows.length === 0) return null;
  return h(
    "div",
    { flexDirection: "column", marginTop: 14 },
    sectionTitle(t.labels.byLineupType),
    table(
      [t.labels.startersOnCourt, t.labels.min, t.labels.score, t.labels.pm],
      rows.map((r) => [r.label.replace("-", "–"), mins(r.seconds), `${r.ptsFor}–${r.ptsAgainst}`, sign(r.ptsFor - r.ptsAgainst)]),
      3,
      accent
    )
  );
}

function noteFor(l: LineFacts, t: StoryText): string {
  const bits: string[] = [];
  if (l.plusMinus !== null) bits.push(sign(l.plusMinus));
  if (l.rebounds >= 6) bits.push(`${l.rebounds} ${t.labels.reb}`);
  if (l.assists >= 5) bits.push(`${l.assists} ${t.labels.ast}`);
  if (l.steals >= 2) bits.push(`${l.steals} ${t.labels.stl}`);
  if (l.blocks >= 2) bits.push(`${l.blocks} ${t.labels.blk}`);
  return bits.join(" · ");
}

// --- bodies -----------------------------------------------------------------

function benchBody(story: Extract<Story, { angle: "bench" }>, t: StoryText, accent: string) {
  const d = story.data;
  const pct = Math.round(d.share * 100);
  return [
    sectionTitle(t.labels.pointsSplit),
    h(
      "div",
      { justifyContent: "space-between", alignItems: "baseline", fontSize: 26, color: INK },
      h("div", { alignItems: "baseline", gap: 10 }, text(t.labels.bench), text(String(d.benchPoints), { fontFamily: COND, fontWeight: 800, fontSize: 48, color: accent }), text(`(${pct}%)`, { color: MUTED })),
      h("div", { alignItems: "baseline", gap: 10 }, text(t.labels.starters), text(String(d.starterPoints), { fontFamily: COND, fontWeight: 800, fontSize: 48 }), text(`(${100 - pct}%)`, { color: MUTED }))
    ),
    h("div", { height: 16, borderRadius: 8, backgroundColor: "#D6D6D2", marginTop: 6, marginBottom: 14 }, h("div", { width: `${pct}%`, height: 16, borderRadius: 8, backgroundColor: accent })),
    sectionTitle(t.labels.benchScorers),
    h(
      "div",
      { flexDirection: "column", backgroundColor: "#FFFFFF", borderRadius: 12, padding: "4px 18px" },
      ...d.scorers.slice(0, d.byType.length > 0 ? 5 : 7).map((l, i) =>
        h(
          "div",
          { alignItems: "center", padding: "6px 0", borderTop: i === 0 ? "none" : `1px solid ${RULE}` },
          text(l.name, { width: 330, fontFamily: COND, fontWeight: 800, fontSize: 28, color: INK, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }),
          h("div", { width: 130, alignItems: "baseline", gap: 6 }, text(String(l.points), { fontFamily: COND, fontWeight: 800, fontSize: 34, color: accent }), text(t.labels.pts, { fontSize: 20, color: accent })),
          text(noteFor(l, t), { flex: 1, fontSize: 22, color: MUTED })
        )
      )
    ),
    byTypeTable(d.byType, t, accent),
  ];
}

function lineupBody(story: Extract<Story, { angle: "lineup" }>, t: StoryText, accent: string) {
  const l = story.data.lineup;
  const stat = (big: string, small: string, color = INK) =>
    h("div", { flexDirection: "column" }, text(big, { fontFamily: COND, fontWeight: 800, fontSize: 52, color }), text(small, { fontSize: 20, color: MUTED }));
  return [
    h(
      "div",
      { flexDirection: "column", backgroundColor: "#FFFFFF", borderRadius: 12, padding: "20px 22px", borderTop: `6px solid ${accent}` },
      h("div", { justifyContent: "space-between", alignItems: "center" }, sectionTitle(t.labels.bestLineup), l.startersOnCourt === 0 ? text(upper(t.labels.noStarters), { fontFamily: COND, fontWeight: 800, fontSize: 22, color: accent, backgroundColor: "#FFF1EA", padding: "6px 12px", borderRadius: 8 }) : null),
      text(l.names.map((n) => n.split(" ").slice(-1)[0]).join(" · "), { fontFamily: COND, fontWeight: 800, fontSize: 34, color: INK, marginBottom: 16 }),
      h(
        "div",
        { justifyContent: "space-between" },
        stat(mins(l.seconds), t.labels.min),
        stat(`${l.ptsFor}–${l.ptsAgainst}`, t.labels.score),
        stat(sign(l.plusMinus), t.labels.pm),
        stat(l.netRating !== null ? sign(Math.round(l.netRating)) : "—", `${t.labels.netRating} · ≈${l.possessions} ${t.labels.possessions}`, accent)
      )
    ),
    byTypeTable(story.data.byType, t, accent),
  ];
}

function explosionBody(story: Extract<Story, { angle: "explosion" }>, t: StoryText, accent: string) {
  const l = story.data.line;
  const box = (v: string, k: string, hot: boolean) =>
    h("div", { flexDirection: "column", alignItems: "center", flex: 1, backgroundColor: "#FFFFFF", borderRadius: 12, padding: "16px 0" }, text(v, { fontFamily: COND, fontWeight: 800, fontSize: 64, color: hot ? accent : INK }), text(k, { fontSize: 20, color: MUTED, letterSpacing: 1 }));
  const max = Math.max(1, ...l.last5Points);
  return [
    h("div", { alignItems: "center", gap: 14, marginBottom: 16 }, text(l.name, { fontFamily: COND, fontWeight: 800, fontSize: 40, color: INK }), story.data.careerHigh ? text(upper(t.labels.careerHigh), { fontFamily: COND, fontWeight: 800, fontSize: 22, color: "#FFFFFF", backgroundColor: accent, padding: "6px 12px", borderRadius: 8 }) : null),
    h("div", { gap: 14 }, box(String(l.points), t.labels.colPts, story.data.stat === "points"), box(String(l.rebounds), t.labels.colReb, false), box(String(l.assists), t.labels.colAst, false), box(String(l.pir), "PIR", story.data.stat === "pir")),
    h("div", { flexDirection: "column", marginTop: 22 }, sectionTitle(t.labels.shooting), text(`2P ${l.fg2m}/${l.fg2a} · 3P ${l.fg3m}/${l.fg3a} · FT ${l.ftm}/${l.fta}`, { fontSize: 30, color: INK })),
    h(
      "div",
      { flexDirection: "column", marginTop: 22 },
      sectionTitle(t.labels.last5),
      h("div", { alignItems: "flex-end", gap: 16, height: 260 }, ...l.last5Points.map((p, i) => h("div", { flexDirection: "column", alignItems: "center", flex: 1, justifyContent: "flex-end" }, text(String(p), { fontFamily: COND, fontWeight: 800, fontSize: 26, color: i === l.last5Points.length - 1 ? accent : INK }), h("div", { width: "100%", height: Math.max(6, Math.round((p / max) * 210)), borderRadius: 6, backgroundColor: i === l.last5Points.length - 1 ? accent : "#CFCFCA" }))))
    ),
  ];
}

function marginChart(margins: MarginPoint[], lowAt: number, accent: string): string {
  const cw = 880;
  const ch = 520;
  const maxT = Math.max(2400, ...margins.map((m) => m.t));
  const maxAbs = Math.max(5, ...margins.map((m) => Math.abs(m.margin)));
  const x = (t: number) => (t / maxT) * cw;
  const y = (m: number) => ch / 2 - (m / maxAbs) * (ch / 2 - 10);
  const pts = margins.map((m) => `${x(m.t).toFixed(1)},${y(m.margin).toFixed(1)}`).join(" ");
  const low = margins.find((m) => m.t === lowAt) ?? margins[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${cw} ${ch}">
    <line x1="0" y1="${ch / 2}" x2="${cw}" y2="${ch / 2}" stroke="#BDBDB8" stroke-width="2" stroke-dasharray="6 6"/>
    ${[600, 1200, 1800].map((q) => `<line x1="${x(q)}" y1="0" x2="${x(q)}" y2="${ch}" stroke="#E2E2DE" stroke-width="2"/>`).join("")}
    <polyline points="${pts}" fill="none" stroke="${accent}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(low.t)}" cy="${y(low.margin)}" r="11" fill="${accent}" stroke="#fff" stroke-width="4"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function comebackBody(story: Extract<Story, { angle: "comeback" }>, t: StoryText, accent: string) {
  return [
    sectionTitle(t.labels.margin),
    h("div", { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 20 }, { type: "img", props: { src: marginChart(story.data.margins, story.data.lowAt, accent), width: 880, height: 520 } }),
    h("div", { fontSize: 22, color: MUTED, marginTop: 8, padding: "0 20px" }, ...["Q1", "Q2", "Q3", "Q4"].map((q) => text(q, { flex: 1, justifyContent: "center" }))),
  ];
}

function clockLabel(p: ClutchPlay): string {
  const m = Math.floor(p.clock / 60);
  const s = String(p.clock % 60).padStart(2, "0");
  return `${p.period > 4 ? `OT${p.period > 5 ? p.period - 4 : ""}` : `Q${p.period}`} ${m}:${s}`;
}

function clutchBody(story: Extract<Story, { angle: "clutch" }>, t: StoryText, accent: string, f: GameFacts) {
  const playLabel = (p: string) => (p === "3FGM" ? "3PT" : p === "2FGM" ? "2PT" : p === "FTM" ? "FT" : p);
  return [
    sectionTitle(t.labels.keyPlays),
    story.data.plays.length > 0
      ? table(
          ["", t.labels.score],
          story.data.plays.map((p) => [`${clockLabel(p)} · ${p.playerName ?? ""} · ${playLabel(p.playType)}`, `${p.homeScore}–${p.awayScore}`]),
          null,
          accent
        )
      : text(`${f.home.name} ${f.home.score}–${f.away.score} ${f.away.name}`, { fontSize: 30, color: INK }),
    story.data.hero
      ? h(
          "div",
          { alignItems: "center", gap: 24, marginTop: 22, backgroundColor: "#FFFFFF", borderRadius: 12, padding: "20px 24px", borderLeft: `6px solid ${accent}` },
          text(String(story.data.hero.points), { fontFamily: COND, fontWeight: 800, fontSize: 96, color: accent }),
          h("div", { flexDirection: "column" }, text(story.data.hero.playerName, { fontFamily: COND, fontWeight: 800, fontSize: 36, color: INK }), text(t.labels.clutchPts, { fontSize: 24, color: MUTED }))
        )
      : null,
  ];
}

function numbersBody(story: Extract<Story, { angle: "numbers" }>, t: StoryText, accent: string, f: GameFacts) {
  const d = story.data;
  // Each team's top three by points, as a small box score.
  const teamBlock = (team: TeamFacts) => {
    const top = f.lines.filter((l) => l.teamId === team.id).sort((a, b) => b.points - a.points).slice(0, 3);
    if (top.length === 0) return null;
    return h(
      "div",
      { flexDirection: "column", marginBottom: 16 },
      text(upper(team.name), { fontFamily: COND, fontWeight: 800, fontSize: 24, letterSpacing: 1, color: MUTED, marginBottom: 6 }),
      table(["", t.labels.colPts, t.labels.colReb, t.labels.colAst, "PIR"], top.map((l) => [l.name, String(l.points), String(l.rebounds), String(l.assists), String(l.pir)]), null, accent)
    );
  };
  return [
    sectionTitle(t.labels.topScorers),
    teamBlock(f.home),
    teamBlock(f.away),
    d.bestLineup ? h("div", { flexDirection: "column", marginTop: 6 }, sectionTitle(t.labels.bestLineup), text(`${d.bestLineup.names.map((n) => n.split(" ").slice(-1)[0]).join(" · ")}  ${sign(d.bestLineup.plusMinus)}`, { fontFamily: COND, fontWeight: 800, fontSize: 30, color: INK })) : null,
  ];
}

// --- card -------------------------------------------------------------------

function headlineParts(headline: string): [string, string] {
  const m = /^([+\-–]?\d[\d–\-]*)\s+(.*)$/.exec(headline);
  return m ? [m[1], m[2]] : ["", headline];
}

export async function renderStoryPng(story: Story, f: GameFacts, t: StoryText): Promise<Buffer> {
  const w = winnerOf(f);
  const accent = accentFor(w);
  const [homeLogo, awayLogo] = await Promise.all([logoDataUri(f.home.logoUrl), logoDataUri(f.away.logoUrl)]);
  const [num, word] = headlineParts(t.headline);
  const heroSize = Math.max(76, Math.min(140, Math.round(1500 / Math.max(10, t.headline.length))));

  const body =
    story.angle === "bench" ? benchBody(story, t, accent)
    : story.angle === "lineup" ? lineupBody(story, t, accent)
    : story.angle === "explosion" ? explosionBody(story, t, accent)
    : story.angle === "comeback" ? comebackBody(story, t, accent)
    : story.angle === "clutch" ? clutchBody(story, t, accent, f)
    : numbersBody(story, t, accent, f);

  const card = h(
    "div",
    { width: W, height: H, flexDirection: "column", backgroundColor: "#FFFFFF", fontFamily: BODY, color: INK, padding: `${PAD - 12}px ${PAD}px 0`, position: "relative" },
    // 1. header
    h(
      "div",
      { justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 },
      h(
        "div",
        { flexDirection: "column", gap: 18 },
        h("div", { alignItems: "center", gap: 18 }, { type: "img", props: { src: clutchLogo(), width: 90, height: 72 } }, text(t.label, { fontFamily: COND, fontWeight: 800, fontSize: 30, letterSpacing: 3, color: MUTED })),
        // 2. hero
        h(
          "div",
          { alignItems: "baseline", gap: 18, maxWidth: 560, flexWrap: "wrap" },
          num ? text(num, { fontFamily: COND, fontWeight: 800, fontSize: heroSize, lineHeight: 0.95, color: accent }) : null,
          text(word, { fontFamily: COND, fontWeight: 800, fontSize: heroSize * (num ? 0.62 : 0.72), lineHeight: 0.95, color: INK })
        )
      ),
      h("div", { flexDirection: "column", gap: 14, paddingLeft: 26, borderLeft: `2px solid ${RULE}`, marginTop: 6 }, teamRow(f.home, homeLogo, w.id === f.home.id), teamRow(f.away, awayLogo, w.id === f.away.id))
    ),
    // 3. context
    h("div", { flexDirection: "column", marginTop: 14, flexShrink: 0 }, text(t.matchup, { fontSize: 26, color: INK }), text(t.context, { fontSize: 24, color: MUTED, marginTop: 2 })),
    h("div", { height: 6, flexShrink: 0, backgroundColor: accent, marginTop: 18, marginBottom: 18 }),
    // 4. lede
    text(t.lede, { fontFamily: COND, fontWeight: 800, fontSize: 38, lineHeight: 1.1, color: INK, marginBottom: 16, flexShrink: 0 }),
    // 5. body
    h("div", { flexDirection: "column", backgroundColor: PANEL, borderRadius: 16, padding: "20px 24px", flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: "hidden" }, ...body),
    // 6. takeaway
    h(
      "div",
      { flexDirection: "column", borderLeft: `6px solid ${accent}`, padding: "4px 0 4px 20px", marginTop: 16, flexShrink: 0 },
      text(upper(t.labels.keyTakeaway), { fontFamily: COND, fontWeight: 800, fontSize: 24, letterSpacing: 2, color: accent }),
      text(t.takeaway, { fontSize: 26, lineHeight: 1.3, color: INK, marginTop: 4 })
    ),
    // 7. footer
    h(
      "div",
      { justifyContent: "space-between", alignItems: "flex-end", borderTop: `1px solid ${RULE}`, marginTop: 14, padding: "12px 0 22px", flexShrink: 0 },
      text(t.footnote ?? "", { fontSize: 18, lineHeight: 1.35, color: MUTED, maxWidth: 640 }),
      text("getclutchapp.com", { fontFamily: COND, fontWeight: 800, fontSize: 34, color: INK })
    ),
    h("div", { position: "absolute", left: 0, right: 0, bottom: 0, height: 10, backgroundColor: accent })
  );

  const svg = await satori(card as never, { width: W, height: H, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng());
}
