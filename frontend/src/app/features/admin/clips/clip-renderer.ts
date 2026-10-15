import type { ClipTeam, RoundClipData } from "../../../core/models";
import { clipText, roundLabelFor, type ClipLang } from "./clip-text";
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

const body = (weight: 400 | 600) => (px: number) => `${weight} ${px}px "Sofia Sans", system-ui, sans-serif`;
const display = (px: number) => `800 ${px}px "Sofia Sans Condensed", "Sofia Sans", system-ui, sans-serif`;

/** Decodes every data-URI image in the clip; one that fails to decode is just absent (initials are drawn instead). */
export async function loadClipImages(data: RoundClipData): Promise<ClipImages> {
  const teams = data.results.flatMap((r) => [r.home, r.away]);
  const uris = new Set([...teams.map((t) => t.logo), data.pull?.photo].filter((u): u is string => !!u));
  const images: ClipImages = new Map();
  await Promise.all(
    [...uris].map(async (uri) => {
      const img = new Image();
      img.src = uri;
      try {
        await img.decode();
        images.set(uri, img);
      } catch {
        // drawn as a badge instead
      }
    })
  );
  return images;
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
  text(ctx, team.code, cx, cy + size * 0.12, { font: display, px: Math.round(size * 0.36), maxWidth: size * 0.9 });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
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

function drawHook(ctx: CanvasRenderingContext2D, data: RoundClipData, scene: Scene, local: number, time: number, lang: ClipLang): void {
  if (scene.variant === "upset" && data.hook) {
    const h = data.hook;
    const first = h.pickedLoserPct === null ? clipText("hookUpsetNoPct", lang) : clipText("hookSaid", lang, { pct: h.pickedLoserPct });
    statLines(ctx, local, [first, h.loser.name[lang].toUpperCase(), clipText("hookLost", lang, { score: h.score })], [ORANGE, RED]);
  } else if (data.boldCall) {
    const b = data.boldCall;
    statLines(
      ctx,
      local,
      [clipText("boldOnly", lang, { pct: b.correctPct }), b.winner.name[lang].toUpperCase(), clipText("boldWon", lang, { score: b.score })],
      [GREEN, WHITE]
    );
  }
  faceDownCard(ctx, CLIP_W / 2, 420, 180, time);
  text(ctx, clipText("teaser", lang), CLIP_W / 2, 1820, { font: body(600), px: 34, color: MUTED });
}

function drawResults(ctx: CanvasRenderingContext2D, data: RoundClipData, images: ClipImages, local: number, lang: ClipLang): void {
  text(ctx, roundLabelFor(data.round, lang).toUpperCase(), CLIP_W / 2, 260, { font: display, px: 70, alpha: progress(local, 0, 0.3) });
  data.results.slice(0, 10).forEach((r, i) => {
    const p = easeOutCubic(progress(local, 0.2 + i * 0.25, 0.4));
    if (p <= 0) return;
    const y = 420 + i * 120;
    ctx.save();
    ctx.globalAlpha = p;
    ctx.translate((1 - p) * 500, 0);
    const homeWon = r.homeScore > r.awayScore;
    teamMark(ctx, r.home, images, 150, y, 72);
    text(ctx, r.home.code, 270, y + 18, { font: display, px: 50, maxWidth: 140, color: homeWon ? WHITE : MUTED });
    text(ctx, `${r.homeScore}–${r.awayScore}`, CLIP_W / 2, y + 22, { font: display, px: 70, maxWidth: 300 });
    text(ctx, r.away.code, 810, y + 18, { font: display, px: 50, maxWidth: 140, color: homeWon ? MUTED : WHITE });
    teamMark(ctx, r.away, images, 930, y, 72);
    ctx.restore();
  });
}

function drawTopPredictor(ctx: CanvasRenderingContext2D, data: RoundClipData, local: number, lang: ClipLang): void {
  const t = data.topPredictor!;
  const p = easeOutCubic(progress(local, 0, 0.4));
  ctx.save();
  ctx.globalAlpha = p;
  ctx.translate(CLIP_W / 2, CLIP_H / 2);
  ctx.scale(0.9 + 0.1 * p, 0.9 + 0.1 * p);
  ctx.translate(-CLIP_W / 2, -CLIP_H / 2);
  text(ctx, clipText("topPredictor", lang), CLIP_W / 2, 700, { font: body(600), px: 44, color: MUTED });
  text(ctx, t.alias[lang].toUpperCase(), CLIP_W / 2, 820, { font: display, px: 96, color: ORANGE });
  text(ctx, `${t.correct}/${t.total}`, CLIP_W / 2, 1100, { font: display, px: 260 });
  text(ctx, clipText("pts", lang, { n: t.points }), CLIP_W / 2, 1260, { font: body(600), px: 44, color: MUTED });
  ctx.restore();
}

function drawBoldCall(ctx: CanvasRenderingContext2D, data: RoundClipData, local: number, lang: ClipLang): void {
  const b = data.boldCall!;
  statLines(
    ctx,
    local,
    [clipText("boldOnly", lang, { pct: b.correctPct }), b.winner.name[lang].toUpperCase(), clipText("boldWon", lang, { score: b.score })],
    [GREEN, WHITE]
  );
  text(ctx, b.alias[lang], CLIP_W / 2, 1400, { font: display, px: 64, color: ORANGE, alpha: progress(local, 1.3, 0.4) });
}

/** The pulled card's face: photo, tier colours, tier label and name. */
function cardFace(ctx: CanvasRenderingContext2D, data: RoundClipData, images: ClipImages, w: number, h: number, time: number, lang: ClipLang): void {
  const pull = data.pull;
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  if (!pull || pull.tier === "legendary") {
    g.addColorStop(0, "#ffd36b");
    g.addColorStop(0.55, ORANGE);
    g.addColorStop(1, "#7a2a00");
  } else {
    g.addColorStop(0, "#f2f4f7");
    g.addColorStop(0.55, "#a9b2bd");
    g.addColorStop(1, "#4b525b");
  }
  roundedRect(ctx, -w / 2, -h / 2, w, h, w * 0.06);
  ctx.fillStyle = g;
  ctx.fill();

  if (!pull) {
    text(ctx, "CLUTCH", 0, -40, { font: display, px: 140, color: "#1a0d00", maxWidth: w * 0.85 });
    text(ctx, clipText("packsFree", lang), 0, 60, { font: body(600), px: 40, color: "#1a0d00", maxWidth: w * 0.85 });
    return;
  }

  // Photo window, cover-fitted.
  const px = -w / 2 + 30;
  const py = -h / 2 + 30;
  const pw = w - 60;
  const ph = h * 0.68;
  ctx.save();
  roundedRect(ctx, px, py, pw, ph, 24);
  ctx.clip();
  ctx.fillStyle = "#1a0d00";
  ctx.fillRect(px, py, pw, ph);
  const img = pull.photo ? images.get(pull.photo) : undefined;
  if (img) {
    const scale = Math.max(pw / img.naturalWidth, ph / img.naturalHeight);
    const iw = img.naturalWidth * scale;
    const ih = img.naturalHeight * scale;
    ctx.drawImage(img, px + (pw - iw) / 2, py, iw, ih);
  } else {
    text(ctx, initials(pull.name), 0, py + ph / 2 + 60, { font: display, px: 180, color: ORANGE });
  }
  ctx.restore();

  if (pull.foil) {
    // A sheen band sweeping across the card.
    const x = ((time * 0.8) % 1.6) * w - w;
    const sheen = ctx.createLinearGradient(x - 120, -h / 2, x + 120, h / 2);
    sheen.addColorStop(0, "rgba(255,255,255,0)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0.45)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    roundedRect(ctx, -w / 2, -h / 2, w, h, w * 0.06);
    ctx.fillStyle = sheen;
    ctx.fill();
  }

  const label = pull.foil ? "foil" : pull.tier === "legendary" ? "legendary" : "rare";
  text(ctx, clipText(label, lang), 0, py + ph + 70, { font: body(600), px: 34, color: "#1a0d00", maxWidth: w * 0.85 });
  text(ctx, pull.name.toUpperCase(), 0, py + ph + 150, { font: display, px: 76, color: "#1a0d00", maxWidth: w * 0.85 });
}

function drawPayoff(ctx: CanvasRenderingContext2D, data: RoundClipData, images: ClipImages, local: number, time: number, lang: ClipLang): void {
  const w = 600;
  const h = 840;
  const flip = progress(local, 0, 0.6);
  const sx = Math.abs(Math.cos(flip * Math.PI));
  ctx.save();
  ctx.translate(CLIP_W / 2, 860);
  ctx.scale(Math.max(sx, 0.001), 1);
  if (flip < 0.5) {
    faceDownCard(ctx, 0, 0, w, 0);
  } else {
    ctx.shadowColor = data.pull?.tier === "rare" ? "#c9d1db" : "#ffcc55";
    ctx.shadowBlur = 60;
    cardFace(ctx, data, images, w, h, time, lang);
  }
  ctx.restore();

  // Light burst as the card lands face up.
  const burst = progress(local, 0.6, 0.6);
  if (burst > 0 && burst < 1) {
    ctx.save();
    ctx.globalAlpha = 1 - burst;
    ctx.lineWidth = 18 * (1 - burst) + 2;
    ctx.strokeStyle = "#ffd36b";
    ctx.beginPath();
    ctx.arc(CLIP_W / 2, 860, 300 + burst * 500, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (data.pull) {
    const a = progress(local, 0.8, 0.4);
    text(ctx, clipText("pulledBy", lang), CLIP_W / 2, 1420, { font: body(600), px: 40, color: MUTED, alpha: a });
    text(ctx, data.pull.alias[lang], CLIP_W / 2, 1500, { font: display, px: 72, color: ORANGE, alpha: a });
  }
}

function drawCta(ctx: CanvasRenderingContext2D, data: RoundClipData, local: number, lang: ClipLang): void {
  const a = easeOutCubic(progress(local, 0, 0.5));
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
  text(ctx, clipText("ctaFree", lang), CLIP_W / 2, 1280, { font: body(400), px: 40, color: MUTED, alpha: a });
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
      drawHook(ctx, data, scene, local, time, lang);
      return; // the hook draws its own big card
    case "results":
      drawResults(ctx, data, images, local, lang);
      break;
    case "topPredictor":
      drawTopPredictor(ctx, data, local, lang);
      break;
    case "boldCall":
      drawBoldCall(ctx, data, local, lang);
      break;
    case "payoff":
      drawPayoff(ctx, data, images, local, time, lang);
      return;
    case "cta":
      drawCta(ctx, data, local, lang);
      return;
  }
  // Until the payoff, the small face-down card keeps its promise in the corner.
  faceDownCard(ctx, 930, 1700, 120, time);
}
