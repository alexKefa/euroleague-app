// Player kit painting (the jersey texture: pattern, collar, armholes, name
// and number), the ball, and the shared blob shadow. The body itself is the
// procedural rig in avatar-rig.ts.
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  SphereGeometry,
} from "three";
import { BALL_RADIUS } from "../../../../../../shared/court/constants";
import type { Kit } from "./kit-styles";

export interface JerseyText {
  /** Back: player name (the Clutch username). Empty = number only. */
  name: string;
  number: number;
  /** Chest: the club's display code, e.g. "OLY". Empty = blank chest. */
  chest: string;
}

export const JERSEY_FONT = '"Sofia Sans Condensed", "Arial Narrow", sans-serif';

// ---- jersey texture ----
// Layout (matches the torso UVs in avatar-rig.ts): x runs once around the
// body starting at the right side: 0 = right side, W/4 = chest, W/2 = left
// side, 3W/4 = back. y runs from the collar (0) down to the hem (H).
const JW = 1024;
const JH = 512;
const CHEST_X = JW / 4;
const BACK_X = (3 * JW) / 4;
/** Text is drawn narrower so it isn't stretched by the wide chest (u covers more metres there). */
const TEXT_SQUEEZE = 0.73;

/** Fit `text` into maxWidth by shrinking from `size` px. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number): number {
  let s = size;
  ctx.font = `800 ${s}px ${JERSEY_FONT}`;
  while (s > 16 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `800 ${s}px ${JERSEY_FONT}`;
  }
  return s;
}

/** Outlined, horizontally squeezed text centred on (x, y). */
function kitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, stroke: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(TEXT_SQUEEZE, 1);
  ctx.lineWidth = stroke;
  ctx.strokeText(text, 0, 0);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function paintPattern(ctx: CanvasRenderingContext2D, kit: Kit): void {
  ctx.fillStyle = kit.patternColor;
  switch (kit.pattern) {
    case "stripes": {
      // 12 stripe pairs around the body (a whole number, so the seam matches), one centred on the chest.
      const period = JW / 12;
      for (let x = CHEST_X - period / 4 - period * 3; x < JW; x += period) ctx.fillRect(x, 0, period / 2, JH);
      break;
    }
    case "pinstripes": {
      const period = JW / 32;
      for (let x = CHEST_X - 3 - period * 8; x < JW; x += period) ctx.fillRect(x, 0, 6, JH);
      break;
    }
    case "diagonal": {
      // A flat cut through the body, unrolled: a sine wave, high at the left
      // shoulder (x = JW/2) and low at the right hip (x = 0 / JW).
      ctx.beginPath();
      ctx.moveTo(0, JH);
      for (let x = 0; x <= JW; x += 16) ctx.lineTo(x, JH * 0.55 + JH * 0.4 * Math.cos((2 * Math.PI * x) / JW));
      ctx.lineTo(JW, JH);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "panels":
      for (const x of [0, JW / 2, JW]) ctx.fillRect(x - 46, 150, 92, JH);
      break;
  }
}

/**
 * The whole jersey as one texture: body colour and pattern, a V-neck and
 * tank-top armholes (skin shows through, piped in the trim colour), a fine
 * mesh-fabric grain, and the name and number on the back plus club code and
 * number on the chest.
 */
export function jerseyTexture(kit: Kit, jersey: JerseyText | null, skin: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = JW;
  canvas.height = JH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = kit.body;
  ctx.fillRect(0, 0, JW, JH);
  paintPattern(ctx, kit);

  // Fabric: a faint mesh grain and a little shading where the jersey tucks in.
  const grain = document.createElement("canvas");
  grain.width = 4;
  grain.height = 8;
  const g = grain.getContext("2d")!;
  g.fillStyle = "rgba(0,0,0,0.07)";
  g.fillRect(0, 0, 1.5, 1.5);
  g.fillRect(2, 4, 1.5, 1.5);
  ctx.fillStyle = ctx.createPattern(grain, "repeat") ?? "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, JW, JH);
  const tuck = ctx.createLinearGradient(0, JH * 0.82, 0, JH);
  tuck.addColorStop(0, "rgba(0,0,0,0)");
  tuck.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = tuck;
  ctx.fillRect(0, JH * 0.82, JW, JH * 0.18);

  // Armholes on both sides (x = 0 wraps to JW), then the neckline: piping first, skin inside.
  const armholes = (rx: number, ry: number) => {
    ctx.beginPath();
    for (const x of [0, JW / 2, JW]) {
      ctx.moveTo(x + rx, -12);
      ctx.ellipse(x, -12, rx, ry, 0, 0, Math.PI * 2);
    }
  };
  const vNeck = (inset: number) => {
    ctx.beginPath();
    ctx.moveTo(CHEST_X - 92 + inset, -4);
    ctx.lineTo(CHEST_X, 104 - inset * 1.4);
    ctx.lineTo(CHEST_X + 92 - inset, -4);
    ctx.closePath();
  };
  ctx.fillStyle = kit.trim;
  armholes(104, 200);
  ctx.fill();
  vNeck(0);
  ctx.fill();
  ctx.fillRect(0, 0, JW, 22);
  ctx.fillStyle = skin;
  armholes(92, 188);
  ctx.fill();
  vNeck(13);
  ctx.fill();
  ctx.fillRect(0, 0, JW, 11);

  if (jersey) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.fillStyle = kit.ink;
    ctx.strokeStyle = kit.outline;
    const num = String(jersey.number);
    // Back: name over a big number.
    const name = jersey.name.toUpperCase();
    if (name) {
      fitFont(ctx, name, 66, 300 / TEXT_SQUEEZE);
      kitText(ctx, name, BACK_X, 82, 9);
    }
    ctx.font = `800 ${name ? 250 : 280}px ${JERSEY_FONT}`;
    kitText(ctx, num, BACK_X, name ? 270 : 250, 16);
    // Chest: club code, number underneath.
    const club = jersey.chest.toUpperCase();
    if (club) {
      fitFont(ctx, club, 86, 210 / TEXT_SQUEEZE);
      kitText(ctx, club, CHEST_X, 160, 9);
    }
    ctx.font = `800 ${club ? 140 : 190}px ${JERSEY_FONT}`;
    kitText(ctx, num, CHEST_X, club ? 280 : 250, 11);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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
