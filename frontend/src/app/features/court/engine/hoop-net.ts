// A cord net hanging from the rim: a tapered tube with an alpha-cut diamond
// mesh texture, deformed per vertex. Two things move it:
//  - the ball itself: any ball inside the net pushes the cords out around it
//    (so you see it squeeze through the narrow bottom), and drags them down;
//  - events: a make plays the swish (the net is pulled down with the ball,
//    then snaps back, flips up at the bottom and sways out in the shot's
//    direction); a rim hit gives a smaller shake.
// One draw call per hoop; the vertex loop only runs while something is moving.
import {
  BufferAttribute,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from "three";
import { BALL_RADIUS } from "../../../../../../shared/court/constants";

const COLS = 24;
const ROWS = 10;
/** Clearance kept between a ball's surface and the cords. */
const CORD_GAP = 0.012;
/** Seconds an event keeps moving the net. */
const SWISH_LIFE = 1.8;
const SHAKE_LIFE = 1.1;

interface NetEvent {
  at: number;
  kind: "swish" | "shake";
  amp: number;
  dirX: number;
  dirZ: number;
}

let netTexture: CanvasTexture | null = null;

function cordTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.lineWidth = 7;
  // One diamond per tile: two crossing diagonals, with knots where they meet the tile edges.
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, size);
  ctx.moveTo(size, 0);
  ctx.lineTo(0, size);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size], [size / 2, size / 2]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class HoopNet {
  readonly mesh: Mesh;
  private readonly base: Float32Array;
  private readonly pos: BufferAttribute;
  private readonly events: NetEvent[] = [];
  private dirty = false;
  private readonly local = new Vector3();

  constructor(
    rimX: number,
    rimY: number,
    rimZ: number,
    private readonly topRadius: number,
    private readonly height: number,
    bottomRadius: number
  ) {
    const geo = new CylinderGeometry(topRadius, topRadius, height, COLS, ROWS, true);
    geo.translate(0, -height / 2, 0); // pivot at the rim
    // A real net flares at the rim and narrows quickly, then hangs nearly straight.
    const p = geo.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const depth = -p.getY(i) / height;
      const r = bottomRadius + (topRadius - bottomRadius) * Math.pow(1 - depth, 1.7);
      const s = r / topRadius;
      p.setXYZ(i, p.getX(i) * s, p.getY(i), p.getZ(i) * s);
    }
    p.setUsage(DynamicDrawUsage);
    this.pos = p;
    this.base = new Float32Array(p.array as Float32Array);

    netTexture ??= cordTexture();
    const map = netTexture.clone();
    map.repeat.set(COLS / 2, ROWS / 2 + 1);
    map.needsUpdate = true;
    const mat = new MeshLambertMaterial({ color: "#f3f5f7", map, alphaTest: 0.4, side: DoubleSide });
    this.mesh = new Mesh(geo, mat);
    this.mesh.position.set(rimX, rimY, rimZ);
  }

  /** A make: `dirX/dirZ` is the ball's horizontal travel (any length; zero = straight down). */
  swish(now: number, dirX = 0, dirZ = 0, amp = 1): void {
    this.push({ at: now, kind: "swish", amp, dirX, dirZ });
  }

  /** Rim contact: a quick shake scaled by the impact (m/s). */
  shake(now: number, strength: number): void {
    const a = Math.random() * Math.PI * 2;
    this.push({ at: now, kind: "shake", amp: Math.min(1, 0.25 + strength * 0.12), dirX: Math.cos(a), dirZ: Math.sin(a) });
  }

  private push(e: NetEvent): void {
    const len = Math.hypot(e.dirX, e.dirZ);
    if (len > 1e-4) {
      e.dirX /= len;
      e.dirZ /= len;
    }
    this.events.push(e);
    if (this.events.length > 4) this.events.shift();
  }

  /** Deform for this frame. `balls` are world positions of every ball on court. */
  update(now: number, balls: readonly Vector3[]): void {
    // Event-driven motion: vertical stretch (+ = pulled down), radial squeeze, lateral sway.
    let stretch = 0;
    let squeeze = 0;
    let flare = 0;
    let swayX = 0;
    let swayZ = 0;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]!;
      const t = (now - e.at) / 1000;
      const life = e.kind === "swish" ? SWISH_LIFE : SHAKE_LIFE;
      if (t > life) {
        this.events.splice(i, 1);
        continue;
      }
      if (t < 0) continue;
      if (e.kind === "swish") {
        // Pulled down with the ball for ~0.13 s, then a damped spring: the
        // overshoot (negative) is the bottom snapping up and flaring.
        const pull = t < 0.13 ? Math.sin((t / 0.13) * (Math.PI / 2)) : Math.exp(-5.5 * (t - 0.13)) * Math.cos(15 * (t - 0.13));
        stretch += 0.16 * pull * e.amp;
        squeeze += 0.18 * Math.max(0, pull) * e.amp;
        flare += 0.07 * Math.max(0, -pull) * e.amp;
        const sway = t < 0.08 ? 0 : 0.07 * Math.exp(-2.6 * (t - 0.08)) * Math.sin(9 * (t - 0.08)) * e.amp;
        swayX += sway * e.dirX;
        swayZ += sway * e.dirZ;
      } else {
        const s = 0.045 * e.amp * Math.exp(-4.5 * t) * Math.sin(17 * t);
        swayX += s * e.dirX;
        swayZ += s * e.dirZ;
        stretch += 0.02 * e.amp * Math.exp(-6 * t) * Math.sin(21 * t);
      }
    }

    // Balls inside (or just above/below) the net, in net space.
    const reach = BALL_RADIUS + CORD_GAP;
    const near: Vector3[] = [];
    for (const b of balls) {
      const l = this.local.copy(b).sub(this.mesh.position);
      if (l.y > reach || l.y < -this.height - reach) continue;
      if (l.x * l.x + l.z * l.z > (this.topRadius + reach) ** 2) continue;
      near.push(l.clone());
    }

    const moving = this.events.length > 0 || near.length > 0;
    if (!moving) {
      if (this.dirty) {
        (this.pos.array as Float32Array).set(this.base);
        this.pos.needsUpdate = true;
        this.dirty = false;
      }
      return;
    }

    const base = this.base;
    const arr = this.pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const bx = base[i]!;
      const by = base[i + 1]!;
      const bz = base[i + 2]!;
      const depth = -by / this.height; // 0 at the rim, 1 at the bottom
      const radialScale = 1 - squeeze * depth + flare * depth * depth * 4;
      let x = bx * radialScale + swayX * Math.pow(depth, 1.5);
      let z = bz * radialScale + swayZ * Math.pow(depth, 1.5);
      let y = by - stretch * depth * this.height * 2.2 + flare * depth * depth * 0.6;
      // Cords give way around each ball and get dragged down a little.
      for (const b of near) {
        const dy = y - b.y;
        if (dy * dy >= reach * reach) continue;
        const clear = Math.sqrt(reach * reach - dy * dy);
        const hx = x - b.x;
        const hz = z - b.z;
        const h = Math.hypot(hx, hz);
        if (h >= clear) continue;
        const push = clear - h;
        if (h > 1e-5) {
          x += (hx / h) * push;
          z += (hz / h) * push;
        } else {
          x += (bx / Math.max(1e-5, Math.hypot(bx, bz))) * push;
          z += (bz / Math.max(1e-5, Math.hypot(bx, bz))) * push;
        }
        y -= push * 0.35 * depth;
      }
      arr[i] = x;
      arr[i + 1] = y;
      arr[i + 2] = z;
    }
    this.pos.needsUpdate = true;
    this.dirty = true;
  }
}

export function releaseNetTexture(): void {
  netTexture?.dispose();
  netTexture = null;
}
