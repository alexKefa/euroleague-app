// A cord net hanging from the rim, simulated as a small cloth: every knot is
// a Verlet particle, the top ring is tied to the rim, and the knots are joined
// by diagonal cords that can't stretch (only go slack), like a real diamond
// mesh. Because the cords are diagonal the net can lengthen by narrowing, so
// a ball dropping through grabs the cords (contact + friction), pulls the net
// down around itself, and when it drops out the bottom the net snaps back up,
// overshoots and sways. A weak pull toward the hanging shape stands in for
// cord stiffness so it settles instead of swinging forever.
//
// One draw call per hoop. The sim sleeps when nothing touches the net and it
// has stopped moving, so idle hoops cost nothing.
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

/** Knots around the rim and rows of knots down the net. */
const COLS = 16;
const ROWS = 8;
const SUBSTEPS = 3;
const ITERATIONS = 5;
/** Lighter than real gravity: stands in for the cords' own stiffness. */
const GRAVITY = 5;
/** Per-substep velocity retention. */
const DAMPING = 0.982;
/** Pull back toward the hanging shape, 1/s. */
const SHAPE_PULL = 3.5;
/** Vertical links may stretch this far before they bite (the diamonds narrow first). */
const VERTICAL_SLACK = 1.3;
/** How much of the ball's motion a touching cord picks up. */
const FRICTION = 0.7;
const CORD_GAP = 0.008;
/** Asleep after this long with no contact and almost no motion. */
const SLEEP_AFTER = 0.6;
const SLEEP_SPEED = 0.05;

let netTexture: CanvasTexture | null = null;

/** One mesh cell: an X of two cords with knots at the corners. */
function cordTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, size);
  ctx.moveTo(size, 0);
  ctx.lineTo(0, size);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size], [size / 2, size / 2]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
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
  private readonly count = COLS * (ROWS + 1);
  private readonly rest: Float32Array;
  private readonly pos: Float32Array;
  private readonly prev: Float32Array;
  /** Links: particle pairs, rest lengths, max-stretch factors. */
  private readonly linkA: Int32Array;
  private readonly linkB: Int32Array;
  private readonly linkLen: Float32Array;
  private readonly linkMax: Float32Array;
  private readonly geoPos: BufferAttribute;
  /** Each ball's position last frame, keyed by its (stable) Vector3. */
  private readonly lastBall = new Map<Vector3, Vector3>();
  private lastNow: number | null = null;
  private awake = false;
  private quietFor = 0;
  private readonly local = new Vector3();

  constructor(
    rimX: number,
    rimY: number,
    rimZ: number,
    private readonly topRadius: number,
    private readonly height: number,
    bottomRadius: number
  ) {
    // Hanging shape: wide at the rim, narrowing quickly, then nearly straight.
    this.rest = new Float32Array(this.count * 3);
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS;
      const rad = bottomRadius + (topRadius - bottomRadius) * Math.pow(1 - t, 1.7);
      for (let c = 0; c < COLS; c++) {
        const a = (c / COLS) * Math.PI * 2;
        const i = (r * COLS + c) * 3;
        this.rest[i] = rad * Math.sin(a);
        this.rest[i + 1] = -t * height;
        this.rest[i + 2] = rad * Math.cos(a);
      }
    }
    this.pos = new Float32Array(this.rest);
    this.prev = new Float32Array(this.rest);

    // Diagonal cords (inextensible) + vertical links with slack (keep the two
    // diagonal lattices from drifting apart).
    const a: number[] = [];
    const b: number[] = [];
    const max: number[] = [];
    const idx = (r: number, c: number) => r * COLS + ((c + COLS) % COLS);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        a.push(idx(r, c), idx(r, c));
        b.push(idx(r + 1, c + 1), idx(r + 1, c - 1));
        max.push(1, 1);
        a.push(idx(r, c));
        b.push(idx(r + 1, c));
        max.push(VERTICAL_SLACK);
      }
    }
    this.linkA = Int32Array.from(a);
    this.linkB = Int32Array.from(b);
    this.linkMax = Float32Array.from(max);
    this.linkLen = new Float32Array(a.length);
    for (let k = 0; k < a.length; k++) {
      const i = a[k]! * 3;
      const j = b[k]! * 3;
      this.linkLen[k] = Math.hypot(this.rest[j]! - this.rest[i]!, this.rest[j + 1]! - this.rest[i + 1]!, this.rest[j + 2]! - this.rest[i + 2]!);
    }

    // Render mesh: an open cylinder grid whose vertices are the knots (plus the seam column).
    const geo = new CylinderGeometry(topRadius, topRadius, height, COLS, ROWS, true);
    this.geoPos = geo.getAttribute("position") as BufferAttribute;
    this.geoPos.setUsage(DynamicDrawUsage);

    netTexture ??= cordTexture();
    const map = netTexture.clone();
    map.repeat.set(COLS, ROWS);
    map.needsUpdate = true;
    // Blended, not alpha-tested: from a distance the mipmapped cords average
    // out to a soft white haze (how a real net reads) instead of vanishing
    // below an alpha cutoff. A little self-light keeps it white in shade and at night.
    const mat = new MeshLambertMaterial({
      color: "#ffffff",
      map,
      transparent: true,
      alphaTest: 0.03,
      depthWrite: false,
      side: DoubleSide,
      emissive: "#ffffff",
      emissiveMap: map,
      emissiveIntensity: 0.35,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.position.set(rimX, rimY, rimZ);
    this.mesh.frustumCulled = false; // the cloth leaves its original bounds
    this.writeGeometry();
  }

  /** A make. The ball does the work; this just makes sure the net is awake. */
  swish(_now: number, _dirX = 0, _dirZ = 0, _amp = 1): void {
    this.wake();
  }

  /** Rim contact: knock the cords sideways, scaled by the impact (m/s). */
  shake(_now: number, strength: number): void {
    const ang = Math.random() * Math.PI * 2;
    const v = Math.min(0.9, 0.2 + strength * 0.1);
    const dx = Math.cos(ang) * v;
    const dz = Math.sin(ang) * v;
    for (let r = 1; r <= ROWS; r++) {
      const k = (r / ROWS) * (1 / 60);
      for (let c = 0; c < COLS; c++) {
        const i = (r * COLS + c) * 3;
        this.prev[i]! -= dx * k;
        this.prev[i + 2]! -= dz * k;
      }
    }
    this.wake();
  }

  private wake(): void {
    this.awake = true;
    this.quietFor = 0;
  }

  /** Step the cloth. `balls` are world positions of every ball on court (stable objects). */
  update(now: number, balls: readonly Vector3[]): void {
    const dt = this.lastNow === null ? 0 : Math.min(1 / 30, (now - this.lastNow) / 1000);
    this.lastNow = now;

    // Balls near the net this frame, in net space, with where they were last frame.
    const reach = BALL_RADIUS + CORD_GAP;
    const near: { from: Vector3; to: Vector3 }[] = [];
    for (const ball of balls) {
      const to = this.local.copy(ball).sub(this.mesh.position).clone();
      let from = this.lastBall.get(ball);
      if (!from) {
        from = to.clone();
        this.lastBall.set(ball, from);
      }
      // A teleport (new shot, ball handed back) isn't motion.
      if (from.distanceToSquared(to) > 1) from.copy(to);
      const inRange = (p: Vector3) =>
        p.y < reach + 0.05 && p.y > -this.height * 1.6 - reach && p.x * p.x + p.z * p.z < (this.topRadius + reach + 0.05) ** 2;
      if (inRange(to) || inRange(from)) near.push({ from: from.clone(), to: to.clone() });
      from.copy(to);
    }
    if (near.length) this.wake();
    if (!this.awake || dt <= 0) return;

    const h = dt / SUBSTEPS;
    const g = GRAVITY * h * h;
    const pull = Math.min(1, SHAPE_PULL * h);
    const P = this.pos;
    const Q = this.prev;
    const R = this.rest;
    const ball = new Vector3();
    const step = new Vector3();
    let maxSpeed = 0;

    for (let s = 0; s < SUBSTEPS; s++) {
      // Integrate (row 0 is tied to the rim).
      for (let i = COLS * 3; i < P.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const p = P[i + k]!;
          const v = (p - Q[i + k]!) * DAMPING;
          Q[i + k] = p;
          P[i + k] = p + v + (R[i + k]! - p) * pull - (k === 1 ? g : 0);
        }
      }
      // Cords: never longer than their length (vertical links get some slack).
      for (let it = 0; it < ITERATIONS; it++) {
        for (let k = 0; k < this.linkA.length; k++) {
          const ia = this.linkA[k]!;
          const ib = this.linkB[k]!;
          const i = ia * 3;
          const j = ib * 3;
          const dx = P[j]! - P[i]!;
          const dy = P[j + 1]! - P[i + 1]!;
          const dz = P[j + 2]! - P[i + 2]!;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const limit = this.linkLen[k]! * this.linkMax[k]!;
          if (d <= limit || d < 1e-6) continue;
          const pinnedA = ia < COLS;
          const wa = pinnedA ? 0 : 0.5;
          const wb = pinnedA ? 1 : 0.5;
          const f = (d - limit) / d;
          P[i]! += dx * f * wa;
          P[i + 1]! += dy * f * wa;
          P[i + 2]! += dz * f * wa;
          P[j]! -= dx * f * wb;
          P[j + 1]! -= dy * f * wb;
          P[j + 2]! -= dz * f * wb;
        }
        // Balls: push knots out to the surface and drag them along with the ball.
        for (const n of near) {
          const u = (s + 1) / SUBSTEPS;
          ball.lerpVectors(n.from, n.to, u);
          step.subVectors(n.to, n.from).divideScalar(SUBSTEPS);
          for (let i = COLS * 3; i < P.length; i += 3) {
            const dx = P[i]! - ball.x;
            const dy = P[i + 1]! - ball.y;
            const dz = P[i + 2]! - ball.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= reach * reach) continue;
            const d = Math.max(1e-5, Math.sqrt(d2));
            const nx = dx / d;
            const ny = dy / d;
            const nz = dz / d;
            const push = reach - d;
            P[i]! += nx * push;
            P[i + 1]! += ny * push;
            P[i + 2]! += nz * push;
            if (it === 0) {
              // Friction: the tangential part of the ball's motion carries the cord with it.
              const sn = step.x * nx + step.y * ny + step.z * nz;
              P[i]! += (step.x - sn * nx) * FRICTION;
              P[i + 1]! += (step.y - sn * ny) * FRICTION;
              P[i + 2]! += (step.z - sn * nz) * FRICTION;
            }
          }
        }
      }
    }

    for (let i = COLS * 3; i < P.length; i += 3) {
      const v = Math.hypot(P[i]! - Q[i]!, P[i + 1]! - Q[i + 1]!, P[i + 2]! - Q[i + 2]!) / h;
      if (v > maxSpeed) maxSpeed = v;
    }
    this.writeGeometry();

    if (near.length === 0 && maxSpeed < SLEEP_SPEED) {
      this.quietFor += dt;
      if (this.quietFor > SLEEP_AFTER) this.awake = false;
    } else {
      this.quietFor = 0;
    }
  }

  private writeGeometry(): void {
    const out = this.geoPos.array as Float32Array;
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        const src = (r * COLS + (c % COLS)) * 3;
        const dst = (r * (COLS + 1) + c) * 3;
        out[dst] = this.pos[src]!;
        out[dst + 1] = this.pos[src + 1]!;
        out[dst + 2] = this.pos[src + 2]!;
      }
    }
    this.geoPos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

export function releaseNetTexture(): void {
  netTexture?.dispose();
  netTexture = null;
}
