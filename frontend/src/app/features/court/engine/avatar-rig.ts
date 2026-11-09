// Procedural player: an articulated body (no model files) posed every frame
// by two-bone IK, with a run cycle, dribble, and a shooting motion (gather,
// rise to the set point, release with a small hop, follow-through, land).
//
// Draw calls: every player's limbs, joints, torso, shorts, trim and shoes go
// through one shared AvatarBatch of InstancedMeshes (per-instance colours), so
// eight players cost ~6 calls plus their jersey lettering and shadows.
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from "three";
import { BALL_RADIUS } from "../../../../../../shared/court/constants";
import { JerseyText, createBlobShadow, createLettering } from "./avatar-factory";
import { disposeObject } from "./scene-builder";

// ---- body dimensions (metres; avatar space: feet at y = 0, facing +z, right = -x) ----
const PELVIS_HEIGHT = 0.95;
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const THIGH = 0.45;
const SHIN = 0.43;
const ANKLE_HEIGHT = 0.08;
const SHOULDER_HALF = 0.24;
const HIP_HALF = 0.1;
const TORSO_RADIUS = 0.2;
const TORSO_LENGTH = 0.36;
const TORSO_SCALE = new Vector3(1.12, 1, 0.78);
/** Torso centre / shoulders / neck / head along the spine from the pelvis. */
const SPINE_TORSO = 0.3;
const SPINE_SHOULDER = 0.55;
const SPINE_NECK = 0.62;
const SPINE_HEAD = 0.8;
const HEAD_RADIUS = 0.115;

const SKIN_TONES = ["#f1c9a5", "#ddaa82", "#b97f55", "#8a5a3b", "#5e3b27"].map((c) => new Color(c));

// Per-avatar instance counts in each batch mesh.
const LIMBS = 9; // 2 upper arms, 2 forearms, 2 thighs, 2 shins, neck
const BALLS = 9; // 2 shoulders, 2 elbows, 2 knees, 2 hands, head
const TRIMS = 2; // headband, waistband
const SHOES = 2;

export type RigMode = "idle" | "run" | "charge" | "release";

function ease(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
}

/** Shared instanced meshes for all players on court. */
export class AvatarBatch {
  readonly limbs: InstancedMesh;
  readonly balls: InstancedMesh;
  readonly torsos: InstancedMesh;
  readonly shorts: InstancedMesh;
  readonly trims: InstancedMesh;
  readonly shoes: InstancedMesh;
  private readonly free: number[] = [];

  constructor(scene: Scene, readonly capacity: number) {
    const mat = () => new MeshStandardMaterial({ color: "#ffffff", roughness: 0.75 });
    this.limbs = new InstancedMesh(new CylinderGeometry(1, 1, 1, 8), mat(), capacity * LIMBS);
    this.balls = new InstancedMesh(new SphereGeometry(1, 12, 8), mat(), capacity * BALLS);
    this.torsos = new InstancedMesh(new CapsuleGeometry(TORSO_RADIUS, TORSO_LENGTH, 4, 14), mat(), capacity);
    this.shorts = new InstancedMesh(new CylinderGeometry(0.205, 0.235, 0.3, 14), mat(), capacity);
    this.trims = new InstancedMesh(new CylinderGeometry(1, 1, 1, 14), mat(), capacity * TRIMS);
    this.shoes = new InstancedMesh(new BoxGeometry(1, 1, 1), mat(), capacity * SHOES);
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (const m of this.meshes()) {
      for (let i = 0; i < m.count; i++) {
        m.setMatrixAt(i, zero);
        m.setColorAt(i, new Color("#ffffff"));
      }
      m.frustumCulled = false; // instances move all over; bounds would go stale
      scene.add(m);
    }
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
  }

  meshes(): InstancedMesh[] {
    return [this.limbs, this.balls, this.torsos, this.shorts, this.trims, this.shoes];
  }

  alloc(): number | null {
    return this.free.pop() ?? null;
  }

  release(slot: number): void {
    const zero = new Matrix4().makeScale(0, 0, 0);
    const clear = (m: InstancedMesh, per: number) => {
      for (let k = 0; k < per; k++) m.setMatrixAt(slot * per + k, zero);
      m.instanceMatrix.needsUpdate = true;
    };
    clear(this.limbs, LIMBS);
    clear(this.balls, BALLS);
    clear(this.torsos, 1);
    clear(this.shorts, 1);
    clear(this.trims, TRIMS);
    clear(this.shoes, SHOES);
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
    const skin = SKIN_TONES[(jersey?.number ?? 3) % SKIN_TONES.length]!;
    for (let k = 0; k < LIMBS; k++) batch.limbs.setColorAt(slot * LIMBS + k, skin);
    for (let k = 0; k < BALLS; k++) batch.balls.setColorAt(slot * BALLS + k, skin);
    const kit = new Color(primary);
    const trim = new Color(secondary);
    batch.torsos.setColorAt(slot, kit);
    batch.shorts.setColorAt(slot, kit);
    for (let k = 0; k < TRIMS; k++) batch.trims.setColorAt(slot * TRIMS + k, trim);
    for (let k = 0; k < SHOES; k++) batch.shoes.setColorAt(slot * SHOES + k, trim);
    for (const m of batch.meshes()) if (m.instanceColor) m.instanceColor.needsUpdate = true;

    this.lettering = jersey ? createLettering(jersey, primary, secondary, TORSO_RADIUS + 0.006, TORSO_LENGTH) : [];
    for (const m of this.lettering) {
      m.matrixAutoUpdate = false;
      scene.add(m);
    }
    this.shadow = createBlobShadow(0.85);
    scene.add(this.shadow);
  }

  /** The shot left the hand: play the release and follow-through. */
  release(now: number): void {
    this.releaseAt = now;
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
    if (input.charging) mode = "charge";
    else if (sinceRelease < 0.6 && !(input.moving && sinceRelease > 0.3)) mode = "release";
    else mode = input.moving ? "run" : "idle";
    if (mode !== "release" && sinceRelease >= 0.6) this.releaseAt = null;
    this.currentMode = mode;

    let crouch = 0.03;
    let jump = 0;
    let lean = 0.08;
    let rate = 14;
    const ball = tC;
    const hr = tD;
    const hl = tS;

    if (mode === "charge") {
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

    // ---- torso, shorts, trims (rigid parts) ----
    const torsoQ = shoulderTurn.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), this.lean));
    const torsoM = new Matrix4().compose(torsoCenter, torsoQ, TORSO_SCALE).premultiply(this.root);
    b.torsos.setMatrixAt(slot, torsoM);
    for (const m of this.lettering) m.matrix.copy(torsoM);
    for (const m of this.lettering) m.matrixWorldNeedsUpdate = true;

    const shortsM = new Matrix4().compose(pelvis.clone().add(new Vector3(0, -0.03, 0)), hipTurn, new Vector3(1.08, 1, 0.82)).premultiply(this.root);
    b.shorts.setMatrixAt(slot, shortsM);

    const setRigid = (mesh: InstancedMesh, index: number, pos: Vector3, q: Quaternion, scale: Vector3) => {
      tM.compose(pos, q, scale).premultiply(this.root);
      mesh.setMatrixAt(index, tM);
    };
    const headUp = head.clone().addScaledVector(spine, 0.045);
    setRigid(b.trims, slot * TRIMS, headUp, torsoQ, new Vector3(HEAD_RADIUS + 0.004, 0.035, HEAD_RADIUS + 0.004));
    setRigid(b.trims, slot * TRIMS + 1, pelvis.clone().add(new Vector3(0, 0.13, 0)), hipTurn, new Vector3(0.232, 0.045, 0.19));

    // ---- joints and limbs ----
    let li = slot * LIMBS;
    let bi = slot * BALLS;
    const limb = (a: Vector3, c: Vector3, r: number) => {
      const dir = tA.subVectors(c, a);
      const len = dir.length();
      tQ.setFromUnitVectors(UP, dir.divideScalar(Math.max(len, 1e-5)));
      tM.compose(tB.addVectors(a, c).multiplyScalar(0.5), tQ, new Vector3(r, len, r)).premultiply(this.root);
      b.limbs.setMatrixAt(li++, tM);
    };
    const joint = (p: Vector3, r: number) => {
      tM.compose(p, tQ.identity(), new Vector3(r, r, r)).premultiply(this.root);
      b.balls.setMatrixAt(bi++, tM);
    };

    // Arms (elbows point out, down and back).
    const elbowR = solveMid(shoulderR, this.handR, UPPER_ARM, FOREARM, new Vector3(-0.7, -0.5, -0.5), new Vector3());
    const elbowL = solveMid(shoulderL, this.handL, UPPER_ARM, FOREARM, new Vector3(0.7, -0.5, -0.5), new Vector3());
    const handR = this.reach(shoulderR, elbowR, this.handR, FOREARM);
    const handL = this.reach(shoulderL, elbowL, this.handL, FOREARM);
    limb(shoulderR, elbowR, 0.056);
    limb(elbowR, handR, 0.048);
    limb(shoulderL, elbowL, 0.056);
    limb(elbowL, handL, 0.048);

    // Legs (knees point forward): planted under the hips at rest; while
    // running each foot follows the stance/swing path from footAt().
    const hipL = new Vector3(HIP_HALF, 0, 0).applyQuaternion(hipTurn).add(new Vector3(0, pelvisY - 0.06, pelvis.z));
    const hipR = new Vector3(-HIP_HALF, 0, 0).applyQuaternion(hipTurn).add(new Vector3(0, pelvisY - 0.06, pelvis.z));
    const footY = ANKLE_HEIGHT + this.jump;
    const stride = this.stride * gb;
    footAt(u, stride, footTmp);
    const liftL = footTmp.lift * gb;
    const footL = new Vector3(HIP_HALF + 0.015, footY + liftL, hipL.z + footTmp.z);
    footAt((u + 0.5) % 1, stride, footTmp);
    const liftR = footTmp.lift * gb;
    const footR = new Vector3(-HIP_HALF - 0.015, footY + liftR, hipR.z + footTmp.z);
    const kneeL = solveMid(hipL, footL, THIGH, SHIN, new Vector3(0, 0, 1), new Vector3());
    const kneeR = solveMid(hipR, footR, THIGH, SHIN, new Vector3(0, 0, 1), new Vector3());
    const ankleL = this.reach(hipL, kneeL, footL, SHIN);
    const ankleR = this.reach(hipR, kneeR, footR, SHIN);
    limb(hipL, kneeL, 0.088);
    limb(kneeL, ankleL, 0.066);
    limb(hipR, kneeR, 0.088);
    limb(kneeR, ankleR, 0.066);
    limb(neck, head, 0.055);

    joint(shoulderR, 0.075);
    joint(shoulderL, 0.075);
    joint(elbowR, 0.05);
    joint(elbowL, 0.05);
    joint(kneeL, 0.07);
    joint(kneeR, 0.07);
    joint(handR, 0.056);
    joint(handL, 0.056);
    joint(head, HEAD_RADIUS);

    // Shoes: toe pointing forward, flat on the ankle.
    // Toes point down while the foot is in the air (heel kick), flat when planted.
    const shoeScale = new Vector3(0.115, 0.085, 0.27);
    const shoe = (index: number, ankle: Vector3, lift: number) => {
      const pitch = Math.min(0.9, lift * 3.2);
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch);
      const offset = new Vector3(0, -0.035, 0.05).applyQuaternion(q);
      setRigid(b.shoes, index, ankle.clone().add(offset), q, shoeScale);
    };
    shoe(slot * SHOES, ankleL, liftL);
    shoe(slot * SHOES + 1, ankleR, liftR);

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
