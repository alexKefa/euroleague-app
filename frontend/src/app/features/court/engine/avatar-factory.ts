// Player kit helpers (jersey lettering, kit contrast), the ball, and the
// shared blob shadow. The body itself is the procedural rig in avatar-rig.ts.
import {
  CanvasTexture,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  SphereGeometry,
} from "three";
import { BALL_RADIUS } from "../../../../../../shared/court/constants";

export interface JerseyText {
  /** Back: player name (the Clutch username). Empty = number only. */
  name: string;
  number: number;
  /** Chest: the club's display code, e.g. "OLY". Empty = blank chest. */
  chest: string;
}

export const JERSEY_FONT = '"Sofia Sans Condensed", "Arial Narrow", sans-serif';

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Lettering colour: the trim colour when it clearly reads on the jersey, else white/black. */
function letteringColor(primary: string, secondary: string): string {
  if (contrast(primary, secondary) >= 3) return secondary;
  return contrast(primary, "#ffffff") >= contrast(primary, "#111111") ? "#ffffff" : "#111111";
}

/** Outline: whichever of the jersey/trim/black/white contrasts most with the lettering. */
function outlineColor(ink: string, primary: string, secondary: string): string {
  const options = [primary, secondary, "#111111", "#ffffff"].filter((c) => c.toLowerCase() !== ink.toLowerCase());
  return options.reduce((best, c) => (contrast(ink, c) > contrast(ink, best) ? c : best), options[0]!);
}

/** Fit `text` into maxWidth by shrinking from `size` px. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number): void {
  let s = size;
  ctx.font = `800 ${s}px ${JERSEY_FONT}`;
  while (s > 16 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `800 ${s}px ${JERSEY_FONT}`;
  }
}

/** Outlined text: the stroke goes under the fill so letters keep their full weight. */
function outlinedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, stroke: number): void {
  ctx.lineWidth = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

const LETTER_TEX = 512;

function letteringTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = LETTER_TEX;
  canvas.height = LETTER_TEX;
  const ctx = canvas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  draw(ctx, LETTER_TEX, LETTER_TEX);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A curved patch around the torso's own origin, centred on yaw `facing` (0 = chest, PI = back). */
function letteringPatch(tex: CanvasTexture, facing: number, radius: number, height: number): Mesh {
  const arc = 1.9;
  const geo = new CylinderGeometry(radius, radius, height, 20, 1, true, facing - arc / 2, arc);
  // A little self-illumination keeps the lettering readable on the shaded side.
  const mat = new MeshStandardMaterial({
    map: tex,
    emissive: "#ffffff",
    emissiveMap: tex,
    emissiveIntensity: 0.35,
    transparent: true,
    roughness: 0.8,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Jersey lettering patches (back: name + number, chest: club code + number),
 * in torso space. The rig sets their matrix to the torso's every frame.
 */
export function createLettering(jersey: JerseyText, primary: string, secondary: string, radius: number, height: number): Mesh[] {
  const out: Mesh[] = [];
  const ink = letteringColor(primary, secondary);
  const outline = outlineColor(ink, primary, secondary);

  const back = letteringTexture((ctx, w, h) => {
    ctx.fillStyle = ink;
    ctx.strokeStyle = outline;
    const name = jersey.name.toUpperCase();
    if (name) {
      fitFont(ctx, name, 96, w * 0.92);
      outlinedText(ctx, name, w / 2, h * 0.15, 12);
    }
    ctx.font = `800 ${name ? 300 : 340}px ${JERSEY_FONT}`;
    outlinedText(ctx, String(jersey.number), w / 2, h * (name ? 0.6 : 0.52), 22);
  });
  out.push(letteringPatch(back, Math.PI, radius, height));

  if (jersey.chest) {
    const chest = letteringTexture((ctx, w, h) => {
      ctx.fillStyle = ink;
      ctx.strokeStyle = outline;
      const club = jersey.chest.toUpperCase();
      fitFont(ctx, club, 150, w * 0.78);
      outlinedText(ctx, club, w / 2, h * 0.3, 14);
      // Number under the club code, like a real kit.
      ctx.font = `800 150px ${JERSEY_FONT}`;
      outlinedText(ctx, String(jersey.number), w / 2, h * 0.64, 14);
    });
    out.push(letteringPatch(chest, 0, radius, height));
  }
  return out;
}


let ballTexture: CanvasTexture | null = null;

function basketballTexture(): CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#d9622b";
  ctx.fillRect(0, 0, w, h);
  // Pebble grain.
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  for (let i = 0; i < 900; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  ctx.strokeStyle = "#1c1410";
  ctx.lineWidth = 3;
  // Equator and two meridians.
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  for (const x of [0, w / 4, w / 2, (3 * w) / 4]) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
  // Curved side seams.
  for (const cx of [w / 4, (3 * w) / 4]) {
    ctx.beginPath();
    for (let y = 0; y <= h; y += 4) {
      const x = cx + Math.cos((y / h) * Math.PI * 2) * (w / 9);
      if (y === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function createBall(): Mesh {
  ballTexture ??= basketballTexture();
  // Each ball gets its own texture clone so disposeObject() on one ball never
  // kills the shared texture under another.
  const mat = new MeshStandardMaterial({ map: ballTexture.clone(), roughness: 0.75 });
  mat.map!.needsUpdate = true;
  return new Mesh(new SphereGeometry(BALL_RADIUS, 24, 16), mat);
}

export function releaseBallTexture(): void {
  ballTexture?.dispose();
  ballTexture = null;
}

let shadowTexture: CanvasTexture | null = null;

/** Soft round shadow on the floor; scale it to fade with height. */
export function createBlobShadow(size: number): Mesh {
  if (!shadowTexture) {
    const s = 64;
    const canvas = document.createElement("canvas");
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(0,0,0,0.45)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    shadowTexture = new CanvasTexture(canvas);
  }
  const mat = new MeshBasicMaterial({ map: shadowTexture.clone(), transparent: true, depthWrite: false });
  mat.map!.needsUpdate = true;
  const mesh = new Mesh(new PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.012;
  mesh.renderOrder = 1;
  return mesh;
}

export function releaseShadowTexture(): void {
  shadowTexture?.dispose();
  shadowTexture = null;
}
