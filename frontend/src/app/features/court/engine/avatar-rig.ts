// Procedural player: an articulated body (no model files) posed every frame
// by two-bone IK, with a run cycle, dribble, and a shooting motion (gather,
// rise to the set point, release with a small hop, follow-through, land).
//
// Look: tapered, rounded limb segments (no visible ball joints), a tank-top
// jersey, basketball shorts with a separate opening per leg, crew socks,
// sneakers, an oval head with short hair and a nose so the face reads.
//
// Draw calls: every player's body parts go through one shared AvatarBatch of
// InstancedMeshes (per-instance colours): 13 calls for all eight players,
// plus their jersey lettering and shadows.
import {
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { BALL_RADIUS } from "../../../../../../shared/court/constants";
import type { EmoteId } from "../../../../../../shared/court/protocol";
import { JerseyText, createBlobShadow, createLettering } from "./avatar-factory";
import { disposeObject } from "./scene-builder";

/** How long each emote animation plays (0 = icon only, no pose). */
const EMOTE_SECONDS: Record<EmoteId, number> = { shush: 1.7, flex: 1.8, cheer: 1.5, shrug: 1.4, laugh: 1.8, fire: 0 };

// ---- body dimensions (metres; avatar space: feet at y = 0, facing +z, right = -x) ----
const PELVIS_HEIGHT = 0.95;
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const THIGH = 0.45;
const SHIN = 0.43;
const ANKLE_HEIGHT = 0.08;
const SHOULDER_HALF = 0.24;
const HIP_HALF = 0.1;
/** Jersey lettering wraps a cylinder of this radius / height around the torso centre. */
const TORSO_RADIUS = 0.2;
const TORSO_LENGTH = 0.36;
const TORSO_SCALE = new Vector3(1.12, 1, 0.78);
/** Torso centre / shoulders / neck / head along the spine from the pelvis. */
const SPINE_TORSO = 0.3;
const SPINE_SHOULDER = 0.55;
const SPINE_NECK = 0.62;
const SPINE_HEAD = 0.8;
const HEAD_SCALE = new Vector3(0.106, 0.124, 0.116);

const SKIN_TONES = ["#f1c9a5", "#ddaa82", "#b97f55", "#8a5a3b", "#5e3b27"].map((c) => new Color(c));
const HAIR_COLORS = ["#1a1310", "#2e2016", "#4b3221", "#0e0e0e", "#6e4b2a", "#3a2a1e"].map((c) => new Color(c));
const SOCK_COLOR = new Color("#f2f2f2");

/** A limb segment: a tapered tube with rounded ends, along +Y from y=-len/2 (rStart) to +len/2 (rEnd). */
function limbGeometry(len: number, rStart: number, rEnd: number): BufferGeometry {
  const pts: Vector2[] = [];
  const caps = 5;
  for (let i = 0; i <= caps; i++) {
    const a = -Math.PI / 2 + (i / caps) * (Math.PI / 2);
    pts.push(new Vector2(rStart * Math.cos(a) + 1e-4, -len / 2 + rStart * Math.sin(a)));
  }
  for (let i = 0; i <= caps; i++) {
    const a = (i / caps) * (Math.PI / 2);
    pts.push(new Vector2(rEnd * Math.cos(a) + 1e-4, len / 2 + rEnd * Math.sin(a)));
  }
  return new LatheGeometry(pts, 14);
}

/** Tank-top jersey: closed lathe, slightly fuller at the chest, sloped shoulders. */
function torsoGeometry(): BufferGeometry {
  const profile: [number, number][] = [
    [0, -0.205],
    [0.182, -0.205],
    [0.19, -0.17],
    [0.197, -0.08],
    [0.203, 0.02],
    [0.205, 0.1],
    [0.2, 0.17],
    [0.18, 0.23],
    [0.135, 0.28],
    [0.075, 0.305],
    [0, 0.31],
  ];
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    20
  );
}

/** Sneaker: a capsule lying along +z. */
function shoeGeometry(): BufferGeometry {
  return new CapsuleGeometry(0.052, 0.16, 4, 12).rotateX(Math.PI / 2);
}

// Per-avatar instance counts.
const PER = {
  upperArm: 2,
  forearm: 2,
  thigh: 2,
  shin: 2,
  neck: 1,
  /** 2 hands, head, nose */
  skinBits: 4,
  hair: 1,
  torso: 1,
  hips: 1,
  shortLeg: 2,
  /** headband, waistband */
  trim: 2,
  shoe: 2,
  sock: 2,
} as const;
type Part = keyof typeof PER;

export type RigMode = "idle" | "run" | "charge" | "release";

function ease(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

/** Shared instanced meshes for all players on court. */
export class AvatarBatch {
  readonly parts: Record<Part, InstancedMesh>;
  private readonly free: number[] = [];

  constructor(scene: Scene, readonly capacity: number) {
    const skin = () => new MeshStandardMaterial({ color: "#ffffff", roughness: 0.62 });
    const cloth = () => new MeshStandardMaterial({ color: "#ffffff", roughness: 0.85 });
    const mk = (part: Part, geo: BufferGeometry, mat: MeshStandardMaterial) => new InstancedMesh(geo, mat, capacity * PER[part]);
    const shortsMat = cloth();
    shortsMat.side = DoubleSide; // open leg tubes: the inside shows at the hem
    this.parts = {
      upperArm: mk("upperArm", limbGeometry(UPPER_ARM, 0.058, 0.042), skin()),
      forearm: mk("forearm", limbGeometry(FOREARM, 0.044, 0.033), skin()),
      thigh: mk("thigh", limbGeometry(THIGH, 0.084, 0.058), skin()),
      shin: mk("shin", limbGeometry(SHIN, 0.06, 0.037), skin()),
      neck: mk("neck", limbGeometry(SPINE_HEAD - SPINE_NECK, 0.054, 0.048), skin()),
      skinBits: mk("skinBits", new SphereGeometry(1, 18, 12), skin()),
      hair: mk("hair", new SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.52), cloth()),
      torso: mk("torso", torsoGeometry(), cloth()),
      hips: mk("hips", new CylinderGeometry(0.205, 0.215, 0.22, 18), cloth()),
      // Leg openings: top (+Y, toward the knee) is the hem, slightly narrower.
      shortLeg: mk("shortLeg", new CylinderGeometry(0.104, 0.118, 0.3, 16, 1, true), shortsMat),
      trim: mk("trim", new CylinderGeometry(1, 1, 1, 18), cloth()),
      shoe: mk("shoe", shoeGeometry(), cloth()),
      sock: mk("sock", new CylinderGeometry(0.046, 0.043, 0.13, 12), cloth()),
    };
    const zero = new Matrix4().makeScale(0, 0, 0);
    const white = new Color("#ffffff");
    for (const m of this.meshes()) {
      for (let i = 0; i < m.count; i++) {
        m.setMatrixAt(i, zero);
        m.setColorAt(i, white);
      }
      m.frustumCulled = false; // instances move all over; bounds would go stale
      scene.add(m);
    }
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
  }

  meshes(): InstancedMesh[] {
    return Object.values(this.parts);
  }

  alloc(): number | null {
    return this.free.pop() ?? null;
  }

  /** Colour every instance of one part for a player. */
  color(part: Part, slot: number, c: Color): void {
    const m = this.parts[part];
    for (let k = 0; k < PER[part]; k++) m.setColorAt(slot * PER[part] + k, c);
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  release(slot: number): void {
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (const part of Object.keys(PER) as Part[]) {
      const m = this.parts[part];
      for (let k = 0; k < PER[part]; k++) m.setMatrixAt(slot * PER[part] + k, zero);
      m.instanceMatrix.needsUpdate = true;
    }
    this.free.push(slot);
  }

  /** Call once per frame after all rigs have written their instances. */
  commit(): void {
    for (const m of this.meshes()) m.instanceMatrix.needsUpdate = true;
  }
}

/** Per-frame input to a rig. */
export interface RigInput {
  moving: boolean;
  /** Seconds since the shoot button went down (charge mode). */
  chargeSeconds: number;
  /** True while the shoot button is held. */
  charging: boolean;
  /** Dribble cycle phase (radians), advanced by the caller while running. */
  dribblePhase: number;
  /** Ground speed, m/s (drives stride length and cadence). */
  speed: number;
  /** The charge is a layup gather, not a jump shot. */
  layup?: boolean;
}

// ---- running gait ----
/** Fraction of a leg's cycle spent on the ground. */
const STANCE = 0.32;

/**
 * Foot target for one leg at cycle phase p in [0, 1), relative to its hip.
 * Stance: the planted foot travels back at ground speed (no skating).
 * Swing: the heel kicks up behind, then the knee drives the foot forward.
 */
function footAt(p: number, stride: number, out: { z: number; lift: number }): void {
  if (p < STANCE) {
    out.z = stride * (0.4 - p / STANCE);
    out.lift = 0;
    return;
  }
  const s = (p - STANCE) / (1 - STANCE);
  const arc = Math.sin(Math.PI * s);
  out.z = stride * (-0.6 + ease(s)) - stride * 0.25 * arc * (1 - s);
  out.lift = 0.34 * Math.pow(arc, 1.3) * Math.min(1, stride / 0.5);
}

const footTmp = { z: 0, lift: 0 };

// Scratch objects (rigs update one at a time).
const tA = new Vector3();
const tB = new Vector3();
const tC = new Vector3();
const tD = new Vector3();
const tQ = new Quaternion();
const tM = new Matrix4();
const tS = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Two-bone IK: the mid joint (elbow/knee) for a root, target and pole direction. */
function solveMid(root: Vector3, target: Vector3, l1: number, l2: number, pole: Vector3, out: Vector3): Vector3 {
  const d = tA.subVectors(target, root);
  const len = Math.max(1e-4, d.length());
  const dist = Math.min(len, l1 + l2 - 1e-3);
  d.divideScalar(len);
  const p = tB.copy(pole).addScaledVector(d, -pole.dot(d));
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1);
  p.normalize();
  const a = (l1 * l1 + dist * dist - l2 * l2) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return out.copy(root).addScaledVector(d, a).addScaledVector(p, h);
}

export class AvatarRig {
  /** Avatar-space ball position while held (dribble / set point). */
  private readonly ballLocal = new Vector3(-0.3, 1.0, 0.2);
  private readonly handR = new Vector3(-0.3, 1.08, 0.16);
  private readonly handL = new Vector3(0.29, 0.88, 0.05);
  private crouch = 0.03;
  private jump = 0;
  private lean = 0.08;
  /** Running cycle phase in [0, 1) (left foot touches down at 0). */
  private gait = 0;
  private gaitBlend = 0;
  /** Smoothed ground speed, m/s. */
  private runSpeed = 0;
  private stride = 0;
  private releaseAt: number | null = null;
  /** The last release was a layup (longer hang, arm up at the rim). */
  private releaseLayup = false;
  /** 0..1: how far the left knee is driven up (layup takeoff). */
  private kneeDrive = 0;
  private time = 0;
  private readonly root = new Matrix4();
  private readonly shadow: Mesh;
  private readonly lettering: Mesh[];
  private readonly x = { x: 0, z: 0, rotY: 0 };
  readonly slot: number;

  constructor(
    private readonly batch: AvatarBatch,
    private readonly scene: Scene,
    slot: number,
    primary: string,
    secondary: string,
    jersey: JerseyText | null
  ) {
    this.slot = slot;
    const n = jersey?.number ?? 3;
    const skin = SKIN_TONES[n % SKIN_TONES.length]!;
    const kit = new Color(primary);
    const trim = new Color(secondary);
    for (const part of ["upperArm", "forearm", "thigh", "shin", "neck", "skinBits"] as const) batch.color(part, slot, skin);
    batch.color("hair", slot, HAIR_COLORS[(n * 7 + 3) % HAIR_COLORS.length]!);
    for (const part of ["torso", "hips", "shortLeg"] as const) batch.color(part, slot, kit);
    batch.color("trim", slot, trim);
    batch.color("shoe", slot, trim);
    batch.color("sock", slot, SOCK_COLOR);

    this.lettering = jersey ? createLettering(jersey, primary, secondary, TORSO_RADIUS + 0.006, TORSO_LENGTH) : [];
    for (const m of this.lettering) {
      m.matrixAutoUpdate = false;
      scene.add(m);
    }
    this.shadow = createBlobShadow(0.85);
    scene.add(this.shadow);
  }

  /** Play an emote pose (idle only: moving or shooting cancels it). */
  emote(id: EmoteId, now: number): void {
    if (EMOTE_SECONDS[id] <= 0) return;
    this.emoteId = id;
    this.emoteAt = now;
  }
  private emoteId: EmoteId | null = null;
  private emoteAt = 0;

  /** The shot left the hand: play the release and follow-through. */
  release(now: number, layup = false): void {
    this.releaseAt = now;
    this.releaseLayup = layup;
  }

  get mode(): RigMode {
    return this.currentMode;
  }
  private currentMode: RigMode = "idle";

  /** World position of the held ball. */
  ballWorld(out: Vector3): Vector3 {
    return out.copy(this.ballLocal).applyMatrix4(this.root);
  }

  dispose(): void {
    this.batch.release(this.slot);
    for (const m of this.lettering) {
      this.scene.remove(m);
      disposeObject(m);
    }
    this.scene.remove(this.shadow);
    disposeObject(this.shadow);
  }

  update(now: number, dt: number, x: number, z: number, rotY: number, input: RigInput): void {
    this.time += dt;
    this.x.x = x;
    this.x.z = z;
    this.x.rotY = rotY;
    this.root.makeRotationY(rotY).setPosition(x, 0, z);
    this.shadow.position.set(x, 0.012, z);

    // ---- pick the mode and its target pose ----
    const sinceRelease = this.releaseAt === null ? Infinity : (now - this.releaseAt) / 1000;
    let mode: RigMode;
    // A layup plays out in full (you land, then run); a jumper can be cut short by moving.
    const releaseDur = this.releaseLayup ? 0.85 : 0.6;
    if (input.charging) mode = "charge";
    else if (sinceRelease < releaseDur && (this.releaseLayup || !(input.moving && sinceRelease > 0.3))) mode = "release";
    else mode = input.moving ? "run" : "idle";
    if (mode !== "release" && sinceRelease >= releaseDur) this.releaseAt = null;
    this.currentMode = mode;
    const emoteT = (now - this.emoteAt) / 1000;
    if (this.emoteId && (mode !== "idle" || emoteT > EMOTE_SECONDS[this.emoteId])) this.emoteId = null;

    let crouch = 0.03;
    let jump = 0;
    let lean = 0.08;
    let rate = 14;
    let knee = 0;
    const ball = tC;
    const hr = tD;
    const hl = tS;

    if (mode === "charge" && input.layup) {
      // Layup gather: ball tucked to the chest, then the takeoff off the right
      // foot with the left knee driving up and the ball carried up to the rim.
      const t = input.chargeSeconds;
      const gather = ease(t / 0.18);
      const rise = ease((t - 0.16) / 0.32);
      crouch = 0.13 * gather * (1 - rise);
      jump = 0.3 * rise;
      lean = 0.16 - 0.08 * rise;
      knee = rise;
      ball.set(-0.1 - 0.02 * rise, 1.22 + 1.05 * rise + jump - crouch, 0.3 + 0.22 * rise);
      hr.set(ball.x - 0.03, ball.y - 0.1, ball.z - 0.06);
      hl.set(ball.x + 0.13 + 0.17 * rise, ball.y - 0.02 - 0.55 * rise, ball.z - 0.02 - 0.1 * rise);
      rate = 24;
    } else if (mode === "release" && this.releaseLayup) {
      // Lay it up: arm fully extended at the rim, hang, then land softly.
      const t = sinceRelease;
      jump = t < 0.22 ? 0.32 : t < 0.52 ? 0.32 * (1 - ease((t - 0.22) / 0.3)) : 0;
      crouch = t >= 0.52 && t < 0.72 ? 0.09 * Math.sin((Math.PI * (t - 0.52)) / 0.2) : 0;
      lean = 0.06;
      knee = t < 0.28 ? 1 : 1 - ease((t - 0.28) / 0.24);
      hr.set(-0.1, 2.45 + jump, 0.48);
      hl.set(0.32, 1.55 + jump, 0.18);
      ball.copy(hr);
      rate = t < 0.1 ? 30 : 13;
    } else if (mode === "charge") {
      const t = input.chargeSeconds;
      const gather = ease(t / 0.28);
      const rise = ease((t - 0.28) / 0.42);
      crouch = 0.17 * gather * (1 - rise);
      jump = 0.06 * rise;
      lean = 0.12 - 0.1 * rise;
      const lift = jump - crouch;
      // Chest (gather) -> set point above the forehead (rise).
      ball.set(-0.02 - 0.02 * rise, 1.28 + 0.7 * rise + lift, 0.3 - 0.12 * rise);
      hr.set(ball.x - 0.06, ball.y - 0.09 - 0.03 * rise, ball.z - 0.07);
      hl.set(ball.x + 0.11, ball.y + 0.01, ball.z + 0.01 * rise);
      rate = 22;
    } else if (mode === "release") {
      const t = sinceRelease;
      const air = t < 0.35 ? 0.06 * (1 - t / 0.35) + 0.09 * Math.sin((Math.PI * t) / 0.35) : 0;
      jump = air;
      crouch = t >= 0.35 && t < 0.5 ? 0.07 * Math.sin((Math.PI * (t - 0.35)) / 0.15) : 0;
      lean = 0.02;
      // Shooting arm fully extended with the wrist flicked through; guide hand peels off.
      hr.set(-0.06, 2.2 + air, 0.34);
      hl.set(0.22, 1.86 + air, 0.22);
      ball.copy(hr);
      rate = t < 0.12 ? 30 : 12;
    } else if (mode === "run") {
      const sp = this.runSpeed;
      lean = 0.08 + 0.025 * sp;
      crouch = 0.03 + 0.007 * sp;
      const u = this.gait;
      const pump = Math.cos(2 * Math.PI * u); // +1 when the left foot is forward
      // Free (left) arm pumps opposite the left leg, elbow bent.
      const fwd = Math.max(0, -pump);
      hl.set(0.27 - 0.07 * fwd, 0.98 + 0.24 * fwd + 0.04 * Math.max(0, pump), 0.05 - 0.26 * pump * Math.min(1, sp / 2.5));
      // Dribble: one bounce per stride cycle, out in front of the right foot.
      const bounce = Math.abs(Math.cos(Math.PI * (u - 0.25)));
      const top = 0.9 + 0.05 * bounce;
      ball.set(-0.33, BALL_RADIUS + bounce * (top - BALL_RADIUS - 0.08), 0.42 + 0.03 * sp);
      hr.set(-0.32, top + 0.02, ball.z - 0.04);
      rate = 26;
    } else if (this.emoteId) {
      // Emotes (right hand is -x, forward is +z, local metres). The ball goes
      // down by the feet unless a hand is free to hold it.
      const t = emoteT;
      const fade = Math.min(1, (EMOTE_SECONDS[this.emoteId] - t) / 0.25); // ease back out at the end
      ball.set(0.3, BALL_RADIUS, 0.45);
      rate = 16;
      switch (this.emoteId) {
        case "shush":
          // Finger to the lips, ball on the hip, leaning in.
          hr.set(-0.03, 1.66 - 0.02 * (1 - fade), 0.18);
          ball.set(0.31, 1.0, 0.24);
          hl.set(0.33, 1.06, 0.2);
          lean = 0.12;
          break;
        case "flex": {
          // Double biceps, with a little pump.
          const pump = 0.03 * Math.sin(t * 10) * fade;
          hr.set(-0.4, 1.7 + pump, 0.02);
          hl.set(0.4, 1.7 + pump, 0.02);
          lean = -0.03;
          break;
        }
        case "cheer": {
          const hop = t < 1.26 ? 0.1 * Math.abs(Math.sin((Math.PI * t) / 0.42)) : 0;
          jump = hop;
          hr.set(-0.36, 2.12 + hop, 0.08);
          hl.set(0.36, 2.12 + hop, 0.08);
          rate = 18;
          break;
        }
        case "shrug":
          hr.set(-0.42, 1.08, 0.24);
          hl.set(0.42, 1.08, 0.24);
          lean = 0;
          break;
        case "laugh":
          lean = -0.06 + 0.03 * Math.sin(t * 18);
          crouch = 0.04;
          hr.set(-0.17, 1.1, 0.24);
          hl.set(0.17, 1.1, 0.24);
          break;
        case "fire":
          break;
      }
    } else {
      const breathe = Math.sin(this.time * 2.2) * 0.008;
      ball.set(-0.3, 1.0 + breathe, 0.22);
      hr.set(-0.3, 1.08 + breathe, 0.17);
      hl.set(0.29, 0.88 + breathe, 0.04);
    }

    const k = 1 - Math.exp(-rate * dt);
    this.crouch += (crouch - this.crouch) * k;
    this.jump += (jump - this.jump) * Math.min(1, k * 1.5);
    this.lean += (lean - this.lean) * k;
    this.kneeDrive += (knee - this.kneeDrive) * Math.min(1, k * 1.4);
    this.ballLocal.lerp(ball, mode === "run" ? 1 : k);
    this.handR.lerp(hr, k);
    this.handL.lerp(hl, k);

    // ---- gait ----
    const running = mode === "run";
    this.gaitBlend += ((running ? 1 : 0) - this.gaitBlend) * (1 - Math.exp(-10 * dt));
    this.runSpeed += ((running ? input.speed : 0) - this.runSpeed) * (1 - Math.exp(-8 * dt));
    if (running || this.gaitBlend > 0.05) {
      // Cadence rises with speed; the stride is what the planted foot covers
      // at this speed during stance, capped by leg reach.
      const cadence = 1.5 + 0.12 * this.runSpeed; // cycles per second
      this.stride = Math.min(0.72, (this.runSpeed * STANCE) / cadence);
      this.gait = (this.gait + dt * cadence) % 1;
    }

    this.writeInstances();
  }

  private writeInstances(): void {
    const b = this.batch;
    const slot = this.slot;
    const gb = this.gaitBlend;
    const u = this.gait;
    // Lowest at mid-stance of either foot, highest in the flight phase.
    const half = (u * 2) % 1;
    const bob = -0.032 * Math.cos(2 * Math.PI * (half - STANCE / 2)) * gb * Math.min(1, this.stride / 0.4);
    const pelvisY = PELVIS_HEIGHT - this.crouch + this.jump + bob;
    const pelvis = new Vector3(0, pelvisY, 0.03 * gb);
    const spine = new Vector3(0, Math.cos(this.lean), Math.sin(this.lean));
    // Hips turn with the forward leg; shoulders counter-rotate.
    const swingAmt = gb * Math.min(1, this.stride / 0.45);
    const hipYaw = -0.12 * Math.cos(2 * Math.PI * u) * swingAmt;
    const shoulderYaw = 0.17 * Math.cos(2 * Math.PI * u) * swingAmt;
    const shoulderTurn = new Quaternion().setFromAxisAngle(UP, shoulderYaw);
    const hipTurn = new Quaternion().setFromAxisAngle(UP, hipYaw);

    const at = (s: number) => pelvis.clone().addScaledVector(spine, s);
    const torsoCenter = at(SPINE_TORSO);
    const shoulderC = at(SPINE_SHOULDER);
    const shoulderR = shoulderC.clone().add(new Vector3(-SHOULDER_HALF, 0, 0).applyQuaternion(shoulderTurn));
    const shoulderL = shoulderC.clone().add(new Vector3(SHOULDER_HALF, 0, 0).applyQuaternion(shoulderTurn));
    const neck = at(SPINE_NECK);
    const head = at(SPINE_HEAD);

    // ---- jersey, shorts, trims (rigid parts) ----
    const P = b.parts;
    const torsoQ = shoulderTurn.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), this.lean));
    const torsoM = new Matrix4().compose(torsoCenter, torsoQ, TORSO_SCALE).premultiply(this.root);
    P.torso.setMatrixAt(slot, torsoM);
    for (const m of this.lettering) m.matrix.copy(torsoM);
    for (const m of this.lettering) m.matrixWorldNeedsUpdate = true;

    const setRigid = (mesh: InstancedMesh, index: number, pos: Vector3, q: Quaternion, scale: Vector3) => {
      tM.compose(pos, q, scale).premultiply(this.root);
      mesh.setMatrixAt(index, tM);
    };
    // Shorts body (waist to crotch) with the waistband peeking under the jersey hem.
    setRigid(P.hips, slot, pelvis.clone().add(new Vector3(0, -0.02, 0)), hipTurn, new Vector3(1, 1, 0.8));
    setRigid(P.trim, slot * PER.trim + 1, pelvis.clone().add(new Vector3(0, 0.075, 0)), hipTurn, new Vector3(0.212, 0.03, 0.172));

    // ---- limbs: tapered segments from joint a to joint c ----
    const segment = (mesh: InstancedMesh, index: number, a: Vector3, c: Vector3, nominal: number) => {
      const dir = tA.subVectors(c, a);
      const len = dir.length();
      tQ.setFromUnitVectors(UP, dir.divideScalar(Math.max(len, 1e-5)));
      tM.compose(tB.addVectors(a, c).multiplyScalar(0.5), tQ, new Vector3(1, len / nominal, 1)).premultiply(this.root);
      mesh.setMatrixAt(index, tM);
    };
    /** Something along the a->c bone: centred `from` + `along` metres from a. */
    const alongBone = (mesh: InstancedMesh, index: number, a: Vector3, c: Vector3, along: number, scale: Vector3) => {
      const dir = tC.subVectors(c, a).normalize();
      tQ.setFromUnitVectors(UP, dir);
      tM.compose(a.clone().addScaledVector(dir, along), tQ, scale).premultiply(this.root);
      mesh.setMatrixAt(index, tM);
    };
    const ONE = new Vector3(1, 1, 1);

    // Arms (elbows point out, down and back).
    const elbowR = solveMid(shoulderR, this.handR, UPPER_ARM, FOREARM, new Vector3(-0.7, -0.5, -0.5), new Vector3());
    const elbowL = solveMid(shoulderL, this.handL, UPPER_ARM, FOREARM, new Vector3(0.7, -0.5, -0.5), new Vector3());
    const handR = this.reach(shoulderR, elbowR, this.handR, FOREARM);
    const handL = this.reach(shoulderL, elbowL, this.handL, FOREARM);
    segment(P.upperArm, slot * 2, shoulderR, elbowR, UPPER_ARM);
    segment(P.upperArm, slot * 2 + 1, shoulderL, elbowL, UPPER_ARM);
    segment(P.forearm, slot * 2, elbowR, handR, FOREARM);
    segment(P.forearm, slot * 2 + 1, elbowL, handL, FOREARM);
    // Hands: flattened mitts continuing the forearm.
    const handScale = new Vector3(0.043, 0.062, 0.029);
    alongBone(P.skinBits, slot * PER.skinBits, elbowR, handR, FOREARM + 0.03, handScale);
    alongBone(P.skinBits, slot * PER.skinBits + 1, elbowL, handL, FOREARM + 0.03, handScale);

    // Legs (knees point forward): planted under the hips at rest; while
    // running each foot follows the stance/swing path from footAt().
    const hipL = new Vector3(HIP_HALF, 0, 0).applyQuaternion(hipTurn).add(new Vector3(0, pelvisY - 0.06, pelvis.z));
    const hipR = new Vector3(-HIP_HALF, 0, 0).applyQuaternion(hipTurn).add(new Vector3(0, pelvisY - 0.06, pelvis.z));
    const footY = ANKLE_HEIGHT + this.jump;
    const stride = this.stride * gb;
    footAt(u, stride, footTmp);
    // Layup takeoff: the left knee drives up and forward.
    const liftL = footTmp.lift * gb + 0.42 * this.kneeDrive;
    const footL = new Vector3(HIP_HALF + 0.015, footY + liftL, hipL.z + footTmp.z + 0.12 * this.kneeDrive);
    footAt((u + 0.5) % 1, stride, footTmp);
    const liftR = footTmp.lift * gb;
    const footR = new Vector3(-HIP_HALF - 0.015, footY + liftR, hipR.z + footTmp.z);
    const kneeL = solveMid(hipL, footL, THIGH, SHIN, new Vector3(0, 0, 1), new Vector3());
    const kneeR = solveMid(hipR, footR, THIGH, SHIN, new Vector3(0, 0, 1), new Vector3());
    const ankleL = this.reach(hipL, kneeL, footL, SHIN);
    const ankleR = this.reach(hipR, kneeR, footR, SHIN);
    segment(P.thigh, slot * 2, hipL, kneeL, THIGH);
    segment(P.thigh, slot * 2 + 1, hipR, kneeR, THIGH);
    segment(P.shin, slot * 2, kneeL, ankleL, SHIN);
    segment(P.shin, slot * 2 + 1, kneeR, ankleR, SHIN);
    // Shorts legs: from just above the hip joint down ~2/3 of the thigh, so
    // each leg has its own opening (no skirt) and they swing with the stride.
    alongBone(P.shortLeg, slot * 2, hipL, kneeL, 0.13, ONE);
    alongBone(P.shortLeg, slot * 2 + 1, hipR, kneeR, 0.13, ONE);
    // Crew socks over the ankle.
    alongBone(P.sock, slot * 2, ankleL, kneeL, 0.075, ONE);
    alongBone(P.sock, slot * 2 + 1, ankleR, kneeR, 0.075, ONE);

    // ---- neck and head ----
    segment(P.neck, slot, neck, head, SPINE_HEAD - SPINE_NECK);
    setRigid(P.skinBits, slot * PER.skinBits + 2, head, torsoQ, HEAD_SCALE);
    // Nose: the one feature that tells you which way a player faces.
    const fwd = new Vector3(0, 0, 1).applyQuaternion(torsoQ);
    setRigid(P.skinBits, slot * PER.skinBits + 3, head.clone().addScaledVector(fwd, 0.112).addScaledVector(spine, -0.012), torsoQ, new Vector3(0.017, 0.024, 0.02));
    // Short hair: a cap tilted back so the forehead shows.
    const hairQ = torsoQ.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.32));
    setRigid(P.hair, slot, head.clone().addScaledVector(spine, 0.004).addScaledVector(fwd, -0.006), hairQ, HEAD_SCALE.clone().multiplyScalar(1.05));
    // Headband over the hairline.
    setRigid(P.trim, slot * PER.trim, head.clone().addScaledVector(spine, 0.035), torsoQ, new Vector3(0.112, 0.028, 0.122));

    // Sneakers: toe forward, flat when planted, toes down while the foot is in the air.
    const shoeScale = new Vector3(1.1, 0.78, 1);
    const shoe = (index: number, ankle: Vector3, lift: number) => {
      const pitch = Math.min(0.9, lift * 3.2);
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch);
      const offset = new Vector3(0, -0.04, 0.05).applyQuaternion(q);
      setRigid(P.shoe, index, ankle.clone().add(offset), q, shoeScale);
    };
    shoe(slot * 2, ankleL, liftL);
    shoe(slot * 2 + 1, ankleR, liftR);

    // Shadow follows the hips and fades when airborne.
    const s = 1 - Math.min(0.3, this.jump * 2);
    this.shadow.scale.set(s, s, s);
  }

  /** The end effector actually reached (the IK clamps an out-of-range target). */
  private reach(root: Vector3, mid: Vector3, target: Vector3, l2: number): Vector3 {
    const dir = new Vector3().subVectors(target, mid);
    const len = dir.length();
    if (len <= l2 + 1e-4) return target.clone();
    return mid.clone().addScaledVector(dir.divideScalar(len), l2);
  }
}
