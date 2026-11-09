// Placeholder capsule avatars (rigged models arrive in M5), the ball, and a
// shared blob shadow. Jersey = team primary, trim = team secondary.
import {
  CanvasTexture,
  CapsuleGeometry,
  CylinderGeometry,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  SphereGeometry,
} from "three";
import { BALL_RADIUS } from "../../../../../../shared/court/constants";

export interface Avatar {
  root: Group;
  /** Scaled for the squat/stretch of the shooting motion. */
  body: Group;
}

export function createAvatar(primary: string, secondary: string): Avatar {
  const root = new Group();
  const body = new Group();
  root.add(body);

  const jersey = new MeshStandardMaterial({ color: primary, roughness: 0.7 });
  const trim = new MeshStandardMaterial({ color: secondary, roughness: 0.7 });
  const skin = new MeshStandardMaterial({ color: "#c99a78", roughness: 0.8 });

  const torso = new Mesh(new CapsuleGeometry(0.27, 0.95, 4, 12), jersey);
  torso.position.y = 0.27 + 0.95 / 2 + 0.05;
  body.add(torso);
  const band = new Mesh(new CylinderGeometry(0.285, 0.285, 0.12, 14), trim);
  band.position.y = 0.72;
  body.add(band);
  const head = new Mesh(new SphereGeometry(0.15, 14, 10), skin);
  head.position.y = 1.72;
  body.add(head);
  // Headband with a front tab, so facing is readable from any angle.
  const visor = new Mesh(new BoxGeometry(0.12, 0.05, 0.08), trim);
  visor.position.set(0, 1.76, 0.15);
  body.add(visor);

  root.add(createBlobShadow(0.85));
  return { root, body };
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
