import type { ClipPerson, ClipTeam, RoundClipData } from "../../../core/models";
import { clipCode, clipText, clipUpper, personLines, roundLabelFor, type ClipLang } from "./clip-text";
import { fitFontSize } from "./clip-fit";
import { easeOutBack, easeOutCubic, progress, sceneAt, type Scene } from "./clip-timeline";

// Draws one instant of a round clip on a 1080×1920 canvas
// (docs/superpowers/specs/2026-10-15-round-clip-design.md). The preview and
// the export both call drawClipFrame, so what plays on the page is what gets
// recorded. Every frame is drawn from scratch from (data, time, lang).

export const CLIP_W = 1080;
export const CLIP_H = 1920;

export type ClipImages = Map<string, HTMLImageElement>;

const BG = "#0d0d10";
const ORANGE = "#f0761c";
const RED = "#ff4d4d";
const GREEN = "#3ddc84";
const WHITE = "#ffffff";
const MUTED = "rgba(255,255,255,0.72)";

/** Clutch's handle, the same on TikTok and Instagram. */
const SOCIAL_HANDLE = "@clutch_app_euroleague";

const body = (weight: 400 | 600) => (px: number) => `${weight} ${px}px "Sofia Sans", system-ui, sans-serif`;
const display = (px: number) => `800 ${px}px "Sofia Sans Condensed", "Sofia Sans", system-ui, sans-serif`;

/** Decodes every data-URI image in the clip; one that fails to decode is just absent (initials are drawn instead). */
export async function loadClipImages(data: RoundClipData): Promise<ClipImages> {
  const teams = [
    ...data.results.flatMap((r) => [r.home, r.away]),
    ...[data.hook, data.boldCall].flatMap((g) => (g ? [g.winner, g.loser] : [])),
  ];
  const uris = new Set([...teams.map((t) => t.logo), ...data.pulls.map((p) => p.photo)].filter((u): u is string => !!u));
  const images: ClipImages = new Map();
  await Promise.all([
    loadLogo().then((img) => img && images.set(LOGO_KEY, img)),
    ...[...uris].map(async (uri) => {
      const img = new Image();
      img.src = uri;
      try {
        await img.decode();
        images.set(uri, img);
      } catch {
        // drawn as a badge instead
      }
    }),
  ]);
  return images;
}

/** The images map key for the Clutch logo (not a data URI, so it can't clash with one). */
const LOGO_KEY = "clutch-logo";
/** The light-on-dark logo the app's dark theme uses; its viewBox is 1466 × 1179. */
const LOGO_URL = "/brand/clutch-compact-dark.svg";
const LOGO_RATIO = 1466 / 1179;

/**
 * The SVG has a viewBox but no width/height, which canvases draw at a
 * default 300 × 150 (or not at all), so the size is written in first.
 * Null if it can't load: the clip then just has no logo.
 */
async function loadLogo(): Promise<HTMLImageElement | null> {
  try {
    const svg = await (await fetch(LOGO_URL)).text();
    const sized = svg.replace(/<svg/, '<svg width="1466" height="1179"');
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** Waits for both families (incl. Greek glyphs) so no fallback font gets drawn into a frame. */
export async function ensureClipFonts(): Promise<void> {
  await Promise.all(
    ['400 40px "Sofia Sans"', '600 40px "Sofia Sans"', '800 80px "Sofia Sans Condensed"'].map((f) => document.fonts.load(f, "Aα"))
  );
}

interface TextOpts {
  font: (px: number) => string;
  px: number;
  min?: number;
  color?: string;
  maxWidth?: number;
  alpha?: number;
}

/** A centred line at (x, y) baseline, shrunk to fit its box. */
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts): void {
  const maxWidth = o.maxWidth ?? 960;
  const px = fitFontSize(
    (p) => {
      ctx.font = o.font(p);
      return ctx.measureText(s).width;
    },
    maxWidth,
    o.px,
    o.min ?? Math.round(o.px * 0.4)
  );
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.font = o.font(px);
  ctx.fillStyle = o.color ?? WHITE;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(s, x, y, maxWidth);
  ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

type Paint = string | CanvasGradient;
/** A paint, or one built for a chip of width w drawn around the origin (gradients that follow the chip). */
type ChipPaint = Paint | ((w: number, h: number) => Paint);

interface ChipStyle {
  font: (px: number) => string;
  px: number;
  fill: ChipPaint;
  ink: ChipPaint;
  stroke?: ChipPaint;
  maxWidth?: number;
}

function chipSize(ctx: CanvasRenderingContext2D, s: string, st: ChipStyle): { w: number; h: number } {
  ctx.font = st.font(st.px);
  const padX = st.px * 0.75;
  const w = Math.min(ctx.measureText(s).width + padX * 2, st.maxWidth ?? 980);
  return { w, h: st.px * 1.7 };
}

/** A pill with centred text, centred on (cx, cy). */
function chip(ctx: CanvasRenderingContext2D, s: string, cx: number, cy: number, st: ChipStyle, alpha = 1): void {
  if (alpha <= 0) return;
  const { w, h } = chipSize(ctx, s, st);
  const paint = (p: ChipPaint) => (typeof p === "function" ? p(w, h) : p);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  roundedRect(ctx, -w / 2, -h / 2, w, h, h / 2);
  ctx.fillStyle = paint(st.fill);
  ctx.fill();
  if (st.stroke) {
    ctx.lineWidth = Math.max(2, st.px * 0.07);
    ctx.strokeStyle = paint(st.stroke);
    ctx.stroke();
  }
  ctx.font = st.font(st.px);
  ctx.fillStyle = paint(st.ink);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s, 0, st.px * 0.06, w - st.px * 1.5);
  ctx.restore();
}

/** Chips laid out in centred rows from cy, wrapping when a row runs out of width. */
function chipRows(ctx: CanvasRenderingContext2D, labels: string[], cy: number, st: ChipStyle, alphas: number[], gap = 20): void {
  const sizes = labels.map((s) => chipSize(ctx, s, st));
  const rows: number[][] = [];
  let width = Infinity;
  sizes.forEach((sz, i) => {
    if (width + gap + sz.w > 980) {
      rows.push([]);
      width = -gap;
    }
    rows[rows.length - 1].push(i);
    width += gap + sz.w;
  });
  rows.forEach((row, r) => {
    const total = row.reduce((sum, i) => sum + sizes[i].w, 0) + gap * (row.length - 1);
    let x = (CLIP_W - total) / 2;
    for (const i of row) {
      chip(ctx, labels[i], x + sizes[i].w / 2, cy + r * (sizes[i].h + gap), st, alphas[i] ?? 1);
      x += sizes[i].w + gap;
    }
  });
}

const PERSON_CHIP = { fill: "rgba(240,118,28,0.16)", stroke: ORANGE, ink: WHITE };

/** A team colour bright enough to glow on the dark ground, else the brand orange. */
function glowColor(hex: string | null): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return ORANGE;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.12 ? ORANGE : hex;
}

function background(ctx: CanvasRenderingContext2D, glow: string): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CLIP_W, CLIP_H);
  const g = ctx.createRadialGradient(CLIP_W / 2, 0, 0, CLIP_W / 2, 0, CLIP_H * 0.75);
  g.addColorStop(0, `${glow}55`);
  g.addColorStop(1, `${glow}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CLIP_W, CLIP_H);
}

/** The face-down card that promises the pull: orange edge, "?", a constant wobble. */
function faceDownCard(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, time: number): void {
  const h = w * 1.4;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.sin(time * 9) * 0.05);
  ctx.shadowColor = ORANGE;
  ctx.shadowBlur = w * 0.25;
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, "#3a2a1a");
  g.addColorStop(1, "#120c08");
  roundedRect(ctx, -w / 2, -h / 2, w, h, w * 0.08);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(3, w * 0.025);
  ctx.strokeStyle = ORANGE;
  ctx.stroke();
  ctx.font = display(Math.round(w * 0.5));
  ctx.fillStyle = ORANGE;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", 0, 0);
  ctx.restore();
}

/** The team's logo, or a coloured disc with its code when the logo is missing. */
function teamMark(ctx: CanvasRenderingContext2D, team: ClipTeam, images: ClipImages, cx: number, cy: number, size: number): void {
  const img = team.logo ? images.get(team.logo) : undefined;
  if (img) {
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = team.color ?? "#3a3a3c";
  ctx.fill();
  text(ctx, clipCode(team.code), cx, cy + size * 0.12, { font: display, px: Math.round(size * 0.36), maxWidth: size * 0.9 });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A featured person on a chip centred at cy: "@nikos_23" (as typed) with their
 * title in small capitals underneath, or their alias in capitals when there's no username.
 */
function drawPerson(ctx: CanvasRenderingContext2D, p: ClipPerson, cy: number, px: number, lang: ClipLang, alpha = 1): void {
  const { name, title } = personLines(p, lang);
  chip(ctx, title ? name : clipUpper(name, lang), CLIP_W / 2, cy, { font: display, px, ...PERSON_CHIP }, alpha);
  if (title) text(ctx, clipUpper(title, lang), CLIP_W / 2, cy + px * 0.85 + 46, { font: body(600), px: 34, color: MUTED, alpha });
}

/** The two clubs of the hook's game: badges pop in, and the loser's dims once the result lands. */
function matchup(ctx: CanvasRenderingContext2D, winner: ClipTeam, loser: ClipTeam, images: ClipImages, local: number, y: number): void {
  const appear = progress(local, 0.05, 0.25);
  if (appear <= 0) return;
  const pop = easeOutBack(progress(local, 0.05, 0.45));
  const dim = progress(local, 0.9, 0.3);
  const sides: [ClipTeam, number, number][] = [
    [winner, 300, 0],
    [loser, 780, dim],
  ];
  for (const [team, x, d] of sides) {
    const glow = glowColor(team.color);
    ctx.save();
    ctx.globalAlpha = appear * (1 - 0.6 * d);
    ctx.translate(x, y);
    ctx.scale(pop, pop);
    const g = ctx.createRadialGradient(0, 0, 60, 0, 0, 160);
    g.addColorStop(0, `${glow}66`);
    g.addColorStop(1, `${glow}00`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 160, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 100, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.stroke();
    teamMark(ctx, team, images, 0, 0, 128);
    ctx.restore();
  }
  text(ctx, "VS", CLIP_W / 2, y + 20, { font: display, px: 56, color: MUTED, alpha: appear });
}

/** Three stacked lines shared by the upset hook and the bold call. */
function statLines(ctx: CanvasRenderingContext2D, local: number, lines: [string, string, string], colors: [string, string]): void {
  const a = progress(local, 0, 0.3);
  text(ctx, lines[0], CLIP_W / 2, 860 + (1 - easeOutCubic(a)) * 20, { font: body(600), px: 44, alpha: a, color: MUTED });
  const b = progress(local, 0.15, 0.3);
  text(ctx, lines[1], CLIP_W / 2, 1040 + (1 - easeOutCubic(b)) * 20, { font: display, px: 150, alpha: b, color: colors[0] });
  const c = progress(local, 0.9, 0.3);
  if (c > 0) {
    const scale = 2.2 - 1.2 * easeOutBack(c);
    ctx.save();
    ctx.translate(CLIP_W / 2, 1230);
    ctx.scale(scale, scale);
    text(ctx, lines[2], 0, 0, { font: display, px: 110, alpha: Math.min(1, c * 2), color: colors[1], maxWidth: 960 / scale });
    ctx.restore();
  }
}

function drawHook(
  ctx: CanvasRenderingContext2D,
  data: RoundClipData,
  images: ClipImages,
  scene: Scene,
  local: number,
  time: number,
  lang: ClipLang
): void {
  if (scene.variant === "challenge" && data.topPredictor) {
    drawChallenge(ctx, data, local, time, lang);
  } else if (scene.variant === "upset" && data.hook) {
    const h = data.hook;
    matchup(ctx, h.winner, h.loser, images, local, 660);
    const first = h.pickedLoserPct === null ? clipText("hookUpsetNoPct", lang) : clipText("hookSaid", lang, { pct: h.pickedLoserPct });
    statLines(ctx, local, [first, clipUpper(h.loser.name[lang], lang), clipText("hookLost", lang, { score: h.score })], [ORANGE, RED]);
  } else if (data.boldCall) {
    const b = data.boldCall;
    matchup(ctx, b.winner, b.loser, images, local, 660);
    statLines(
      ctx,
      local,
      [clipText("boldOnly", lang, { pct: b.correctPct }), clipUpper(b.winner.name[lang], lang), clipText("boldWon", lang, { score: b.score })],
      [GREEN, WHITE]
    );
  }
}

function drawResults(ctx: CanvasRenderingContext2D, data: RoundClipData, images: ClipImages, local: number, lang: ClipLang): void {
  chip(ctx, clipUpper(roundLabelFor(data.round, lang), lang), CLIP_W / 2, 250, { font: display, px: 60, ...PERSON_CHIP }, progress(local, 0, 0.3));
  data.results.slice(0, 10).forEach((r, i) => {
    const p = easeOutCubic(progress(local, 0.2 + i * 0.25, 0.4));
    if (p <= 0) return;
    const y = 420 + i * 120;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate((1 - p) * 500, 0);
    const homeWon = r.homeScore > r.awayScore;
    roundedRect(ctx, 60, y - 52, 960, 104, 30);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    const side = (team: ClipTeam, won: boolean, markX: number, codeX: number, score: number, scoreX: number) => {
      ctx.save();
      ctx.globalAlpha *= won ? 1 : 0.45;
      teamMark(ctx, team, images, markX, y, 70);
      ctx.restore();
      text(ctx, clipCode(team.code), codeX, y + 18, { font: display, px: 50, maxWidth: 140, color: won ? WHITE : MUTED });
      text(ctx, String(score), scoreX, y + 22, { font: display, px: 66, maxWidth: 130, color: won ? WHITE : MUTED });
    };
    side(r.home, homeWon, 130, 255, r.homeScore, 445);
    side(r.away, !homeWon, 950, 825, r.awayScore, 635);
    text(ctx, "–", CLIP_W / 2, y + 18, { font: display, px: 56, color: MUTED });
    ctx.restore();
  });
}

/**
 * The challenge hook: the top predictor's score slams in counting up, with a
 * shockwave and a jolt as it lands, then their name, then the dare.
 */
function drawChallenge(ctx: CanvasRenderingContext2D, data: RoundClipData, local: number, time: number, lang: ClipLang): void {
  const t = data.topPredictor!;
  chip(ctx, clipUpper(roundLabelFor(data.round, lang), lang), CLIP_W / 2, 330, { font: display, px: 60, ...PERSON_CHIP }, progress(local, 0, 0.3));

  const slam = progress(local, 0.15, 0.45);
  const landed = progress(local, 0.6, 0.5);
  const cy = 860;
  if (slam > 0) {
    // Behind the score: a steady glow, and a ring that bursts out as it lands.
    const g = ctx.createRadialGradient(CLIP_W / 2, cy - 110, 40, CLIP_W / 2, cy - 110, 460);
    g.addColorStop(0, `${ORANGE}55`);
    g.addColorStop(1, `${ORANGE}00`);
    ctx.save();
    ctx.globalAlpha = slam;
    ctx.fillStyle = g;
    ctx.fillRect(0, cy - 600, CLIP_W, 1000);
    ctx.restore();
    if (landed > 0 && landed < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - landed;
      ctx.lineWidth = 14 * (1 - landed) + 2;
      ctx.strokeStyle = ORANGE;
      ctx.beginPath();
      ctx.arc(CLIP_W / 2, cy - 110, 220 + 380 * easeOutCubic(landed), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const shown = Math.round(t.correct * easeOutCubic(progress(local, 0.15, 0.75)));
    const shake = landed > 0 && landed < 0.4 ? Math.sin(time * 90) * 14 * (1 - landed / 0.4) : 0;
    const scale = 2.4 - 1.4 * easeOutBack(slam);
    ctx.save();
    // Scaled around the glyphs' middle, not the baseline, so it lands in place.
    ctx.translate(CLIP_W / 2 + shake, cy - 130);
    ctx.scale(scale, scale);
    text(ctx, `${shown}/${t.total}`, 0, 130, { font: display, px: 380, alpha: Math.min(1, slam * 2), maxWidth: 960 / scale });
    ctx.restore();
  }

  const who = easeOutCubic(progress(local, 0.85, 0.35));
  if (who > 0) {
    ctx.save();
    ctx.translate(0, (1 - who) * 30);
    drawPerson(ctx, t.person, 1060, 68, lang, who);
    ctx.restore();
  }
  const called = easeOutCubic(progress(local, 1.1, 0.35));
  const titled = personLines(t.person, lang).title !== null;
  text(ctx, clipText("challengeCalled", lang, { n: t.correct, total: t.total }), CLIP_W / 2, titled ? 1260 : 1200, {
    font: body(600),
    px: 48,
    color: MUTED,
    alpha: called,
  });

  // The dare lands last and keeps pulsing until the cut.
  const dare = progress(local, 1.7, 0.35);
  if (dare > 0) {
    const pulse = dare >= 1 ? 1 + 0.03 * Math.sin((local - 2.05) * 7) : 1;
    const scale = (2.2 - 1.2 * easeOutBack(dare)) * pulse;
    ctx.save();
    ctx.translate(CLIP_W / 2, 1560);
    ctx.scale(scale, scale);
    text(ctx, clipText("challengeBeat", lang), 0, 0, { font: display, px: 128, color: ORANGE, alpha: Math.min(1, dare * 2), maxWidth: 960 / scale });
    ctx.restore();
  }
}

function drawBoldCall(ctx: CanvasRenderingContext2D, data: RoundClipData, local: number, lang: ClipLang): void {
  const b = data.boldCall!;
  statLines(
    ctx,
    local,
    [clipText("boldOnly", lang, { pct: b.correctPct }), clipUpper(b.winner.name[lang], lang), clipText("boldWon", lang, { score: b.score })],
    [GREEN, WHITE]
  );
  drawPerson(ctx, b.person, 1410, 56, lang, progress(local, 1.3, 0.4));
}

type Pull = RoundClipData["pulls"][number];

/** The app's foil colours (packs.css / collectible-card.css), in order around the wheel. */
const RAINBOW = ["#ff5aa0", "#ffd25a", "#7dffb0", "#5ab4ff", "#c878ff"];

/** The app's tier art (collectible-card.ts computeStyle): metallic frame, dark face, badge, glow. */
const TIER = {
  legendary: {
    frame: ["#7a5b12", "#f4d675", "#fff6d8", "#caa53a", "#fff2c9", "#6e4e10"],
    face: "#4a3608",
    badge: ["#9c7415", "#f7dd85", "#fffbe8", "#e0ac36", "#855f10"],
    badgeInk: "#241804",
    name: "#FFF7E0",
    glow: "#ffcc55",
  },
  rare: {
    frame: ["#cfd6dc", "#f5f7f9", "#aab2ba", "#f5f7f9", "#cfd6dc"],
    face: "#2a343e",
    badge: ["#b9c1c8", "#eef1f3", "#9aa3ab"],
    badgeInk: "#1c2226",
    name: "#F5F7F6",
    glow: "#c9d1db",
  },
} as const;

const tierOf = (pull: Pull | null) => TIER[pull?.tier ?? "legendary"];
const cardGlow = (pull: Pull | null) => (pull?.foil ? "#c8a0ff" : tierOf(pull).glow);

function withStops<G extends CanvasGradient>(g: G, colors: readonly string[]): G {
  colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
  return g;
}

/** The diagonal shine that slides across a card face (the app's .holo-sweep; rainbow for a foil). */
function holoSweep(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number, foil: boolean): void {
  const s = (((time / (foil ? 1.6 : 2.4)) % 1) * 2 - 1) * w;
  const cx = x + w / 2 + s;
  const band = foil
    ? ["rgba(0,0,0,0)", ...RAINBOW.map((c) => `${c}66`), "rgba(0,0,0,0)"]
    : ["rgba(0,0,0,0)", "rgba(255,236,180,0.35)", "rgba(0,0,0,0)"];
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = withStops(ctx.createLinearGradient(cx - w * 0.55, y, cx + w * 0.55, y + h * 0.4), band);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** A horizontal rainbow that drifts over time, for foil text (the app's .foil-label). */
function rainbowFill(ctx: CanvasRenderingContext2D, width: number, time: number): CanvasGradient {
  const shift = (time * 0.45) % 1;
  const g = ctx.createLinearGradient(-width / 2 - shift * width, 0, width * 1.5 - shift * width, 0);
  return withStops(g, [...RAINBOW, RAINBOW[0], ...RAINBOW, RAINBOW[0]]);
}

/**
 * One pulled card, centred on the current origin, drawn like the app's
 * collectible card: metallic frame, full-bleed photo, tier badge in the
 * corner, the name on a dark banner along the bottom.
 */
function cardFace(ctx: CanvasRenderingContext2D, pull: Pull | null, images: ClipImages, w: number, h: number, time: number, lang: ClipLang): void {
  const t = tierOf(pull);
  roundedRect(ctx, -w / 2, -h / 2, w, h, w * 0.07);
  ctx.fillStyle = withStops(ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2), t.frame);
  ctx.fill();
  ctx.shadowBlur = 0; // the caller's glow is for the frame only

  const pad = w * 0.035;
  const fx = -w / 2 + pad;
  const fy = -h / 2 + pad;
  const fw = w - pad * 2;
  const fh = h - pad * 2;
  ctx.save();
  roundedRect(ctx, fx, fy, fw, fh, w * 0.05);
  ctx.clip();
  ctx.fillStyle = withStops(ctx.createRadialGradient(0, fy, 0, 0, fy, fh), [t.face, "#05070a"]);
  ctx.fillRect(fx, fy, fw, fh);

  if (!pull) {
    text(ctx, "CLUTCH", 0, Math.round(w * 0.08), { font: display, px: Math.round(w * 0.23), color: "#f4d675", maxWidth: fw * 0.85 });
    holoSweep(ctx, fx, fy, fw, fh, time, false);
    ctx.restore();
    return;
  }

  const img = pull.photo ? images.get(pull.photo) : undefined;
  if (img) {
    const scale = Math.max(fw / img.naturalWidth, fh / img.naturalHeight);
    const iw = img.naturalWidth * scale;
    ctx.drawImage(img, fx + (fw - iw) / 2, fy, iw, img.naturalHeight * scale);
  } else {
    text(ctx, initials(pull.name), 0, w * 0.05, { font: display, px: Math.round(w * 0.3), color: t.name, alpha: 0.5 });
  }
  holoSweep(ctx, fx, fy, fw, fh, time, pull.foil);

  // Bottom banner: a fade into a dark plate, the name on it.
  const bannerTop = fy + fh * 0.76;
  const fade = ctx.createLinearGradient(0, bannerTop - fh * 0.12, 0, bannerTop);
  fade.addColorStop(0, "rgba(5,7,10,0)");
  fade.addColorStop(1, "rgba(5,7,10,0.82)");
  ctx.fillStyle = fade;
  ctx.fillRect(fx, bannerTop - fh * 0.12, fw, fh * 0.12);
  ctx.fillStyle = "rgba(5,7,10,0.82)";
  ctx.fillRect(fx, bannerTop, fw, fy + fh - bannerTop);
  const nameColor = pull.foil ? rainbowFill(ctx, fw, time) : t.name;
  const namePx = fitFontSize((p) => ((ctx.font = display(p)), ctx.measureText(clipUpper(pull.name, lang)).width), fw * 0.86, Math.round(w * 0.12), Math.round(w * 0.06));
  ctx.font = display(namePx);
  ctx.fillStyle = nameColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(clipUpper(pull.name, lang), 0, (bannerTop + fy + fh) / 2 + namePx * 0.06);
  ctx.restore();

  // Tier badge, top right, like the app's corner pill ("✦ LEGENDARY" on a foil).
  const label = clipText(pull.foil ? "foil" : pull.tier === "legendary" ? "legendary" : "rare", lang);
  const badge: ChipStyle = {
    font: display,
    px: Math.round(w * 0.055),
    fill: (bw, bh) => withStops(ctx.createLinearGradient(-bw / 2, -bh / 2, bw / 2, bh / 2), t.badge),
    ink: t.badgeInk,
  };
  const { w: bw, h: bh } = chipSize(ctx, label, badge);
  chip(ctx, label, fx + fw - w * 0.035 - bw / 2, fy + w * 0.035 + bh / 2, badge);
}

/** A rotating rainbow halo behind a foil card (the app's .burst-glow--foil). */
function foilGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, time: number, alpha: number): void {
  if (alpha <= 0) return;
  const g = withStops(ctx.createConicGradient(time * 0.9, cx, cy), [...RAINBOW, RAINBOW[0]]);
  ctx.save();
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  // Soften the disc into a halo: fade its edge back to the ground colour.
  const fade = ctx.createRadialGradient(cx, cy, radius * 0.35, cx, cy, radius);
  fade.addColorStop(0, "rgba(13,13,16,0)");
  fade.addColorStop(1, "rgba(13,13,16,1)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = fade;
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const HERO = { x: CLIP_W / 2, y: 820, w: 600, h: 840 };
/** Where the second and third pulls fan out behind the hero card. */
/** Where the other pulls fan out behind the hero: two close in, then two further out and higher. */
const SIDES = [
  { x: 205, y: 910, rot: -0.21, from: -1, w: 360 },
  { x: 875, y: 910, rot: 0.21, from: 1, w: 360 },
  { x: 110, y: 700, rot: -0.4, from: -1, w: 290 },
  { x: 970, y: 700, rot: 0.4, from: 1, w: 290 },
];

function drawPayoff(ctx: CanvasRenderingContext2D, data: RoundClipData, images: ClipImages, local: number, time: number, lang: ClipLang): void {
  const [hero = null, ...others] = data.pulls;
  const flip = progress(local, 0, 0.6);

  if (hero?.foil) foilGlow(ctx, HERO.x, HERO.y, 640, time, progress(local, 0.3, 0.5));

  // The other pulls slide in from the sides once the hero has landed, behind it
  // (the outer pair drawn first, so the inner pair overlaps them).
  others.slice(0, SIDES.length).map((pull, i) => ({ pull, i })).reverse().forEach(({ pull, i }) => {
    const s = SIDES[i];
    const p = progress(local, 0.9 + i * 0.2, 0.5);
    if (p <= 0) return;
    const e = easeOutBack(p);
    ctx.save();
    ctx.globalAlpha = Math.min(1, p * 2);
    ctx.translate(s.x + s.from * (1 - e) * 420, s.y);
    ctx.rotate(s.rot + s.from * (1 - e) * 0.3);
    ctx.shadowColor = cardGlow(pull);
    ctx.shadowBlur = 40;
    cardFace(ctx, pull, images, s.w, s.w * 1.4, time, lang);
    ctx.restore();
  });

  ctx.save();
  ctx.translate(HERO.x, HERO.y);
  ctx.scale(Math.max(Math.abs(Math.cos(flip * Math.PI)), 0.001), 1);
  if (flip < 0.5) {
    faceDownCard(ctx, 0, 0, HERO.w, 0);
  } else {
    ctx.shadowColor = cardGlow(hero);
    ctx.shadowBlur = 60;
    cardFace(ctx, hero, images, HERO.w, HERO.h, time, lang);
  }
  ctx.restore();

  // Rings as the card lands face up: two rainbow ones for a foil, one gold otherwise.
  const rings = hero?.foil
    ? [
        { color: "rgba(120,220,255,0.85)", delay: 0 },
        { color: "rgba(255,130,220,0.75)", delay: 0.25 },
      ]
    : [{ color: "#ffd36b", delay: 0 }];
  for (const r of rings) {
    const burst = progress(local, 0.6 + r.delay, 0.7);
    if (burst <= 0 || burst >= 1) continue;
    ctx.save();
    ctx.globalAlpha = 1 - burst;
    ctx.lineWidth = 18 * (1 - burst) + 2;
    ctx.strokeStyle = r.color;
    ctx.beginPath();
    ctx.arc(HERO.x, HERO.y, 300 + burst * 520, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (!hero) return;
  const a = progress(local, 0.8, 0.4);
  const count = Math.max(data.legendaryCount, data.pulls.filter((p) => p.tier === "legendary").length);
  if (count <= 1) {
    text(ctx, clipText("pulledBy", lang), CLIP_W / 2, 1390, { font: body(600), px: 38, color: MUTED, alpha: a });
    drawPerson(ctx, hero.person, 1480, 60, lang, a);
    return;
  }
  // Several legendaries: the round's total on a chip, the hero's person, then everyone else shown on chips.
  const foil = data.pulls.some((p) => p.foil);
  const rainbow = (w: number) => rainbowFill(ctx, w, time);
  chip(
    ctx,
    clipText("pullsCount", lang, { n: count }),
    CLIP_W / 2,
    1380,
    { font: display, px: 44, fill: "rgba(20,16,31,0.9)", stroke: foil ? rainbow : "#f4d675", ink: foil ? rainbow : "#ffd36b" },
    a
  );
  drawPerson(ctx, hero.person, 1490, 56, lang, a);
  const label = (p: ClipPerson) => {
    const { name, title } = personLines(p, lang);
    return title ? name : clipUpper(name, lang);
  };
  const names = [...new Set(others.map((p) => label(p.person)))].filter((n) => n !== label(hero.person));
  chipRows(
    ctx,
    names,
    1680,
    { font: display, px: 42, fill: "rgba(255,255,255,0.08)", stroke: "rgba(255,255,255,0.28)", ink: WHITE },
    names.map((_, i) => progress(local, 1.4 + i * 0.15, 0.4))
  );
}

function drawCta(ctx: CanvasRenderingContext2D, data: RoundClipData, images: ClipImages, local: number, lang: ClipLang): void {
  const a = easeOutCubic(progress(local, 0, 0.5));
  const logoH = 230;
  drawLogo(ctx, images, (CLIP_W - logoH * LOGO_RATIO) / 2, 380, logoH, a);
  text(ctx, clipText("ctaQuestion", lang), CLIP_W / 2, 760, { font: display, px: 120, alpha: a });
  const pill = data.next?.picksOpen
    ? clipText("ctaOpen", lang, { round: roundLabelFor(data.next.round, lang) })
    : clipText("ctaPlay", lang);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = body(600)(44);
  const pw = Math.min(980, ctx.measureText(pill).width + 80);
  roundedRect(ctx, (CLIP_W - pw) / 2, 940, pw, 92, 46);
  ctx.fillStyle = ORANGE;
  ctx.fill();
  ctx.restore();
  text(ctx, pill, CLIP_W / 2, 1001, { font: body(600), px: 44, color: "#120c08", maxWidth: pw - 60, alpha: a });
  text(ctx, "getclutchapp.com", CLIP_W / 2, 1180, { font: display, px: 90, color: ORANGE, alpha: a });
  const icons = easeOutBack(progress(local, 0.3, 0.5));
  if (icons > 0) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(CLIP_W / 2, 1340);
    ctx.scale(icons, icons);
    tiktokIcon(ctx, -SOCIAL_ICON * 0.7, 0, SOCIAL_ICON);
    instagramIcon(ctx, SOCIAL_ICON * 0.7, 0, SOCIAL_ICON);
    ctx.restore();
  }
  text(ctx, SOCIAL_HANDLE, CLIP_W / 2, 1500, { font: display, px: 64, alpha: a });
}

const SOCIAL_ICON = 112;

/** Simple Icons' TikTok note (24×24 viewBox), built on first use (Path2D is browser-only). */
let tiktokNote: Path2D | null = null;
const TIKTOK_NOTE_D =
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";

/** TikTok's tile: a black rounded square, the note in white over cyan and red offsets. */
function tiktokIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  roundedRect(ctx, -size / 2, -size / 2, size, size, size * 0.24);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.stroke();
  const s = (size * 0.56) / 24;
  const off = size * 0.022;
  for (const [dx, dy, color] of [
    [-off, -off, "#25f4ee"],
    [off, off, "#fe2c55"],
    [0, 0, "#ffffff"],
  ] as const) {
    ctx.save();
    ctx.translate(dx - 12 * s, dy - 12 * s);
    ctx.scale(s, s);
    ctx.fillStyle = color;
    ctx.fill((tiktokNote ??= new Path2D(TIKTOK_NOTE_D)));
    ctx.restore();
  }
  ctx.restore();
}

/** Instagram's tile: the warm-to-purple gradient square with the white camera outline. */
function instagramIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  const h = size / 2;
  const g = ctx.createRadialGradient(-h * 0.6, h * 1.1, 0, -h * 0.6, h * 1.1, size * 1.3);
  withStops(g, ["#fdf497", "#fd5949", "#d6249f", "#285aeb"]);
  roundedRect(ctx, -h, -h, size, size, size * 0.24);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = size * 0.075;
  const inner = size * 0.62;
  roundedRect(ctx, -inner / 2, -inner / 2, inner, inner, inner * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(inner * 0.3, -inner * 0.3, size * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

/** The logo, h tall, its top-left at (x, y). */
function drawLogo(ctx: CanvasRenderingContext2D, images: ClipImages, x: number, y: number, h: number, alpha = 1): number {
  const img = images.get(LOGO_KEY);
  if (!img) return 0;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(img, x, y, h * LOGO_RATIO, h);
  ctx.restore();
  return h * LOGO_RATIO;
}

/**
 * The corner bug on every scene but the end card (2026-10-16): logo plus the
 * "Clutch" wordmark with its dot, like the app's header. Top-left, below
 * where TikTok / Reels put their own top bar.
 */
function watermark(ctx: CanvasRenderingContext2D, images: ClipImages): void {
  const h = 64;
  const x = 56;
  const y = 120;
  const w = drawLogo(ctx, images, x, y, h, 0.95);
  ctx.save();
  ctx.font = display(50);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = WHITE;
  ctx.globalAlpha = 0.95;
  const tx = x + (w ? w + 14 : 0);
  ctx.fillText("Clutch", tx, y + h / 2 + 2);
  const tw = ctx.measureText("Clutch").width;
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(tx + tw + 10, y + h / 2 + 12, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draws the whole 1080×1920 frame at `time` seconds. */
export function drawClipFrame(
  ctx: CanvasRenderingContext2D,
  data: RoundClipData,
  timeline: Scene[],
  images: ClipImages,
  time: number,
  lang: ClipLang
): void {
  const at = sceneAt(timeline, time);
  const glow = at?.scene.id === "hook" && at.scene.variant === "upset" && data.hook ? glowColor(data.hook.loser.color) : ORANGE;
  background(ctx, glow);
  if (!at) return;
  const { scene, local } = at;
  switch (scene.id) {
    case "hook":
      drawHook(ctx, data, images, scene, local, time, lang);
      break;
    case "results":
      drawResults(ctx, data, images, local, lang);
      break;
    case "boldCall":
      drawBoldCall(ctx, data, local, lang);
      break;
    case "payoff":
      drawPayoff(ctx, data, images, local, time, lang);
      break;
    case "cta":
      // The end card carries the big logo instead of the corner bug.
      return drawCta(ctx, data, images, local, lang);
  }
  watermark(ctx, images);
}
