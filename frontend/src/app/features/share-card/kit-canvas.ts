import { STAT_LABELS, StatKey, StatLine, formatValue, winner } from "./share-card.logic";

export interface KitPlayer {
  first: string;
  last: string;
  jersey: number | null;
  teamCode: string;
  primary: string;
  secondary: string;
  photoUrl: string | null;
  line: StatLine;
}

export interface KitCardOptions {
  size: "post" | "story";
  mode: "player" | "h2h";
  players: KitPlayer[];
  stats: StatKey[];
  periodLabel: string;
}

/**
 * The "Kit" share card drawn straight onto a canvas (2026-10-07). Replaces an
 * html-to-image export, which renders through an SVG <foreignObject>: phone
 * browsers (Safari above all) often drop web fonts and images on that path,
 * so shared cards came out in a fallback font with no photo. A canvas uses
 * the page's loaded fonts directly and exports with toBlob. The same drawing
 * backs the on-screen preview, so preview and image always match.
 */

const W = 1080;
const BODY = "'Sofia Sans', system-ui, sans-serif";
const COND = "'Sofia Sans Condensed', 'Sofia Sans', system-ui, sans-serif";

export function cardHeight(size: "post" | "story"): number {
  return size === "story" ? 1920 : 1350;
}

function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const font = (weight: number, px: number, family: string) => `${weight} ${px}px ${family}`;

/** Loads exactly the font faces and unicode subsets (Greek included) this card's text needs. */
async function loadFonts(texts: string[]): Promise<void> {
  const sample = texts.join(" ") + " 0123456789.%–";
  const faces: [number, string][] = [
    [600, BODY],
    [900, COND],
    [850, COND],
  ];
  await Promise.all(faces.map(([w, f]) => document.fonts.load(font(w, 40, f), sample).catch(() => [])));
}

const photoCache = new Map<string, Promise<HTMLImageElement | null>>();

/** CORS-enabled photo, or null when it can't load (the card is drawn without it). */
function loadPhoto(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let p = photoCache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    photoCache.set(url, p);
  }
  return p;
}

function fitSize(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, max: number, min: number, maxWidth: number): number {
  for (let px = max; px > min; px -= 2) {
    ctx.font = font(weight, px, family);
    if (ctx.measureText(text).width <= maxWidth) return px;
  }
  return min;
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
}

/** object-fit: cover, anchored top-centre, faded out over its bottom 30%. */
function drawPhoto(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const o = off.getContext("2d")!;
  o.drawImage(img, sx, 0, sw, sh, 0, 0, w, h);
  o.globalCompositeOperation = "destination-in";
  const fade = o.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0.7, "#000");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  o.fillStyle = fade;
  o.fillRect(0, 0, w, h);
  ctx.drawImage(off, x, y);
}

function footerMark(ctx: CanvasRenderingContext2D, x: number, baseline: number, color: string, withDot: boolean): void {
  ctx.font = font(850, 54, COND);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Clutch", x, baseline);
  if (withDot) {
    const w = ctx.measureText("Clutch").width;
    ctx.beginPath();
    ctx.arc(x + w + 12, baseline - 7, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, o: KitCardOptions, photo: HTMLImageElement | null): void {
  const p = o.players[0];
  const story = o.size === "story";
  const H = cardHeight(o.size);
  const sec = p.secondary;

  ctx.fillStyle = p.primary;
  ctx.fillRect(0, 0, W, H);

  // Shirt number (or team code) watermark, top right.
  ctx.fillStyle = rgba(sec, 0.12);
  ctx.font = font(900, 756, COND);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(String(p.jersey ?? p.teamCode), W + 40, story ? 60 : -60);

  if (photo) {
    const w = story ? 970 : 690;
    const h = story ? 1080 : 780;
    const right = story ? -100 : 0;
    drawPhoto(ctx, photo, W - right - w, story ? 430 : 86, w, h);
  }

  // Name block.
  let y = story ? 150 : 76;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  if (p.first) {
    ctx.fillStyle = rgba(sec, 0.85);
    ctx.font = font(600, 48, BODY);
    ctx.fillText(p.first, 65, y);
    y += 58;
  }
  const last = p.last.toUpperCase();
  const lastPx = fitSize(ctx, last, 900, COND, 140, 56, 620);
  ctx.fillStyle = sec;
  ctx.font = font(900, lastPx, COND);
  ctx.fillText(last, 65, y);
  y += lastPx * 0.95 + 26;

  ctx.font = font(600, 36, BODY);
  const pw = ctx.measureText(o.periodLabel).width + 56;
  pill(ctx, 65, y, pw, 60, rgba(sec, 0.16));
  ctx.fillStyle = sec;
  ctx.textBaseline = "middle";
  ctx.fillText(o.periodLabel, 93, y + 31);

  // Stat strip.
  const n = o.stats.length;
  const valuePx = n > 4 ? 100 : 119;
  const stripH = 43 * 2 + valuePx * 0.9 + 12 + 42;
  const stripY = H - (story ? 195 : 140) - stripH;
  ctx.fillStyle = rgba(sec, 0.14);
  ctx.fillRect(0, stripY, W, stripH);
  const cellW = (W - 86) / n;
  o.stats.forEach((key, i) => {
    const cx = 43 + cellW * (i + 0.5);
    if (i > 0) {
      ctx.fillStyle = rgba(sec, 0.25);
      ctx.fillRect(43 + cellW * i - 1, stripY + 43, 2, stripH - 86);
    }
    const value = formatValue(key, p.line.values[key], p.line.single);
    const px = fitSize(ctx, value, 850, COND, valuePx, 48, cellW - 20);
    ctx.fillStyle = sec;
    ctx.font = font(850, px, COND);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(value, cx, stripY + 43);
    ctx.fillStyle = rgba(sec, 0.8);
    ctx.font = font(600, 35, BODY);
    ctx.fillText(STAT_LABELS[key], cx, stripY + 43 + valuePx * 0.9 + 12);
  });

  // Footer.
  footerMark(ctx, 65, H - 49, sec, true);
  ctx.font = font(600, 37, BODY);
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = sec;
  ctx.fillText("getclutchapp.com", W - 65, H - 52);
}

function drawH2H(ctx: CanvasRenderingContext2D, o: KitCardOptions, photos: (HTMLImageElement | null)[]): void {
  const [a, b] = o.players;
  const story = o.size === "story";
  const H = cardHeight(o.size);

  ctx.fillStyle = a.primary;
  ctx.fillRect(0, 0, W / 2, H);
  ctx.fillStyle = b.primary;
  ctx.fillRect(W / 2, 0, W / 2, H);
  // Names, VS.
  const top = story ? 150 : 65;

  // Each player's photo in their own half, under the name, fading into the stat lines.
  const photoY = top + 150;
  const photoH = story ? 640 : 420;
  const photoW = story ? 480 : 400;
  if (photos[0]) drawPhoto(ctx, photos[0], W / 4 - photoW / 2, photoY, photoW, photoH);
  if (photos[1]) drawPhoto(ctx, photos[1], (3 * W) / 4 - photoW / 2, photoY, photoW, photoH);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(W / 2 - 2, 0, 4, H);

  const nameW = 360;
  const aPx = fitSize(ctx, a.last, 850, COND, 80, 40, nameW);
  const bPx = fitSize(ctx, b.last, 850, COND, 80, 40, nameW);
  ctx.textBaseline = "top";
  ctx.font = font(850, aPx, COND);
  ctx.fillStyle = a.secondary;
  ctx.textAlign = "left";
  ctx.fillText(a.last, 54, top);
  ctx.font = font(850, bPx, COND);
  ctx.fillStyle = b.secondary;
  ctx.textAlign = "right";
  ctx.fillText(b.last, W - 54, top);
  ctx.font = font(600, 35, BODY);
  ctx.fillStyle = rgba(a.secondary, 0.8);
  ctx.textAlign = "left";
  ctx.fillText(a.teamCode, 54, top + 90);
  ctx.fillStyle = rgba(b.secondary, 0.8);
  ctx.textAlign = "right";
  ctx.fillText(b.teamCode, W - 54, top + 90);

  ctx.font = font(900, 54, COND);
  const vsW = ctx.measureText("VS").width + 48;
  pill(ctx, W / 2 - vsW / 2, top + 20, vsW, 76, "rgba(0,0,0,0.45)");
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VS", W / 2, top + 60);

  // Stat lines, spread evenly below the photos (slightly smaller with 5 stats).
  const regionTop = photoY + photoH * 0.8;
  const regionBottom = H - (story ? 260 : 150);
  const n = o.stats.length;
  const lineH = n > 4 && !story ? 92 : 108;
  const gap = (regionBottom - regionTop - n * lineH) / (n + 1);
  o.stats.forEach((key, i) => {
    const y = regionTop + gap * (i + 1) + lineH * i;
    const win = winner(key, a.line.values[key], b.line.values[key]);
    const av = formatValue(key, a.line.values[key], a.line.single);
    const bv = formatValue(key, b.line.values[key], b.line.single);
    ctx.textBaseline = "top";

    ctx.font = font(850, lineH, COND);
    ctx.fillStyle = a.secondary;
    ctx.textAlign = "left";
    ctx.fillText(av, 54, y);
    if (win === "a") ctx.fillRect(54, y + lineH, ctx.measureText(av).width * 0.6, 10);

    ctx.fillStyle = b.secondary;
    ctx.textAlign = "right";
    ctx.fillText(bv, W - 54, y);
    if (win === "b") {
      const bw = ctx.measureText(bv).width * 0.6;
      ctx.fillRect(W - 54 - bw, y + lineH, bw, 10);
    }

    ctx.font = font(600, 34, BODY);
    const label = STAT_LABELS[key];
    const lw = ctx.measureText(label).width + 36;
    pill(ctx, W / 2 - lw / 2, y + lineH / 2 - 27, lw, 54, "rgba(0,0,0,0.45)");
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, W / 2, y + lineH / 2);
  });

  // Footer.
  footerMark(ctx, 54, H - 49, a.secondary, false);
  ctx.font = font(600, 37, BODY);
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = b.secondary;
  ctx.fillText(o.periodLabel, W - 54, H - 52);
}

/**
 * Draws the card onto `canvas` at full export size. Resolves once fonts and
 * the photo are ready and the drawing is complete. `withPhoto: false` skips
 * the photo (used if a photo ever taints the canvas and blocks export).
 */
export async function drawKitCard(canvas: HTMLCanvasElement, o: KitCardOptions, withPhoto = true): Promise<void> {
  const texts = [o.periodLabel, ...o.players.flatMap((p) => [p.first, p.last, p.last.toUpperCase(), p.teamCode])];
  const [, ...photos] = await Promise.all([
    loadFonts(texts),
    ...o.players.slice(0, o.mode === "h2h" ? 2 : 1).map((p) => (withPhoto ? loadPhoto(p.photoUrl) : Promise.resolve(null))),
  ]);
  canvas.width = W;
  canvas.height = cardHeight(o.size);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (o.mode === "h2h" && o.players.length > 1) drawH2H(ctx, o, photos);
  else drawPlayer(ctx, o, photos[0] ?? null);
}
