// Shot simulation (CLUTCH_COURT_SPEC.md §5.5). Builds the static court in a
// Rapier world and resolves make/miss for a launch. Rapier is passed in
// (structurally typed below) so this folder stays dependency-free: the
// client passes `@dimforge/rapier3d-compat` after `init()`, and so will the
// court server.
import {
  BALL_MASS,
  BALL_RADIUS,
  FENCE_HALF_LENGTH,
  FENCE_HALF_WIDTH,
  FENCE_HEIGHT,
  GRAVITY,
  PHYSICS_STEP,
  RESTITUTION_BOARD,
  RESTITUTION_FENCE,
  RESTITUTION_GROUND,
  RESTITUTION_POLE,
  RESTITUTION_RIM,
  RIM_INNER_RADIUS,
  RIM_TUBE_RADIUS,
  SHOT_AFTER_MAKE_SECONDS,
  SHOT_KEYFRAME_HZ,
  SHOT_MAX_SIM_SECONDS,
} from "./constants.js";
import { BoxShape, HOOP_IDS, RIM_RING_RADIUS, hoopLayout } from "./geometry.js";
import { ShotEvent, ShotEventKind, ShotLaunch, ShotResult, Vec3 } from "./types.js";

// ---- Minimal structural view of the Rapier API used here ----
interface RQuat {
  x: number;
  y: number;
  z: number;
  w: number;
}
interface RColliderDesc {
  setTranslation(x: number, y: number, z: number): RColliderDesc;
  setRotation(q: RQuat): RColliderDesc;
  setRestitution(r: number): RColliderDesc;
  setFriction(f: number): RColliderDesc;
  setRestitutionCombineRule(rule: number): RColliderDesc;
  setMass(m: number): RColliderDesc;
}
interface RBodyDesc {
  setTranslation(x: number, y: number, z: number): RBodyDesc;
  setLinvel(x: number, y: number, z: number): RBodyDesc;
  setAngvel(v: Vec3): RBodyDesc;
  setCcdEnabled(enabled: boolean): RBodyDesc;
  setAngularDamping(d: number): RBodyDesc;
}
interface RBody {
  translation(): Vec3;
  linvel(): Vec3;
}
interface RWorld {
  timestep: number;
  createRigidBody(desc: RBodyDesc): RBody;
  createCollider(desc: RColliderDesc, parent?: RBody): unknown;
  removeRigidBody(body: RBody): void;
  step(): void;
  free(): void;
}
export interface RapierApi {
  World: new (gravity: Vec3) => RWorld;
  RigidBodyDesc: { dynamic(): RBodyDesc; fixed(): RBodyDesc };
  ColliderDesc: {
    ball(radius: number): RColliderDesc;
    cuboid(hx: number, hy: number, hz: number): RColliderDesc;
    cylinder(halfHeight: number, radius: number): RColliderDesc;
    capsule(halfHeight: number, radius: number): RColliderDesc;
  };
  CoefficientCombineRule: { Max: number };
}

const RIM_SEGMENTS = 24;
const BOUNCE_DV = 0.7;
const SAME_EVENT_GAP_MS = 80;

export class CourtPhysics {
  private readonly world: RWorld;

  constructor(private readonly R: RapierApi) {
    this.world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = PHYSICS_STEP;
    this.buildStatics();
  }

  dispose(): void {
    this.world.free();
  }

  private fixed(desc: RColliderDesc, restitution: number, friction = 0.6): void {
    desc.setRestitution(restitution).setFriction(friction).setRestitutionCombineRule(this.R.CoefficientCombineRule.Max);
    this.world.createCollider(desc);
  }

  private box(b: BoxShape, restitution: number): void {
    this.fixed(this.R.ColliderDesc.cuboid(b.half.x, b.half.y, b.half.z).setTranslation(b.center.x, b.center.y, b.center.z), restitution);
  }

  private buildStatics(): void {
    const C = this.R.ColliderDesc;
    // Ground: a thick slab whose top is y = 0.
    this.fixed(C.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0), RESTITUTION_GROUND, 0.8);
    // Fence walls.
    const t = 0.05;
    const h = FENCE_HEIGHT / 2;
    for (const s of [-1, 1]) {
      this.fixed(C.cuboid(t, h, FENCE_HALF_LENGTH).setTranslation(s * (FENCE_HALF_WIDTH + t), h, 0), RESTITUTION_FENCE, 0.9);
      this.fixed(C.cuboid(FENCE_HALF_WIDTH, h, t).setTranslation(0, h, s * (FENCE_HALF_LENGTH + t)), RESTITUTION_FENCE, 0.9);
    }
    for (const id of HOOP_IDS) {
      const hoop = hoopLayout(id);
      this.box(hoop.board, RESTITUTION_BOARD);
      this.box(hoop.arm, RESTITUTION_POLE);
      const p = hoop.pole;
      this.fixed(C.cylinder(p.halfHeight, p.radius).setTranslation(p.center.x, p.center.y, p.center.z), RESTITUTION_POLE);
      // Rim: a ring of thin capsules tangent to the circle.
      const segLen = (2 * Math.PI * RIM_RING_RADIUS) / RIM_SEGMENTS;
      for (let i = 0; i < RIM_SEGMENTS; i++) {
        const a = ((i + 0.5) / RIM_SEGMENTS) * 2 * Math.PI;
        const cx = hoop.rim.x + Math.cos(a) * RIM_RING_RADIUS;
        const cz = hoop.rim.z + Math.sin(a) * RIM_RING_RADIUS;
        // Rotate the capsule's Y axis onto the tangent (-sin a, 0, cos a):
        // axis = y × t = (cos a, 0, sin a), angle 90°.
        const k = Math.SQRT1_2;
        const q = { x: Math.cos(a) * k, y: 0, z: Math.sin(a) * k, w: k };
        this.fixed(
          C.capsule(segLen / 2, RIM_TUBE_RADIUS).setTranslation(cx, hoop.rim.y, cz).setRotation(q),
          RESTITUTION_RIM,
          0.5
        );
      }
    }
  }

  /** Simulate a shot until it settles, leaves the court, or times out. */
  simulate(launch: ShotLaunch): ShotResult {
    const R = this.R;
    const o = launch.origin;
    const v = launch.velocity;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(o.x, o.y, o.z)
        .setLinvel(v.x, v.y, v.z)
        .setAngvel(launch.spin)
        .setCcdEnabled(true)
        .setAngularDamping(0.3)
    );
    this.world.createCollider(R.ColliderDesc.ball(BALL_RADIUS).setMass(BALL_MASS).setRestitution(0).setFriction(0.6), body);

    const rim = hoopLayout(launch.hoopId).rim;
    const stepsPerKey = Math.round(1 / PHYSICS_STEP / SHOT_KEYFRAME_HZ);
    const maxSteps = Math.round(SHOT_MAX_SIM_SECONDS / PHYSICS_STEP);
    const afterMakeSteps = Math.round(SHOT_AFTER_MAKE_SECONDS / PHYSICS_STEP);

    const keyframes: number[] = [];
    const events: ShotEvent[] = [];
    const lastEventAt: Partial<Record<ShotEventKind, number>> = {};
    const pushKey = (p: Vec3) => keyframes.push(Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.z * 100));
    const addEvent = (kind: ShotEventKind, t: number, strength: number) => {
      const last = lastEventAt[kind];
      if (last !== undefined && t - last < SAME_EVENT_GAP_MS) return;
      lastEventAt[kind] = t;
      events.push({ t: Math.round(t), kind, strength: Math.round(strength * 100) / 100 });
    };

    let prevPos = { ...o };
    let prevVel = { ...v };
    let made = false;
    let madeStep = -1;
    let settled = 0;
    let step = 0;
    pushKey(prevPos);

    while (step < maxSteps) {
      this.world.step();
      step++;
      const p = body.translation();
      const vel = body.linvel();
      const tMs = step * PHYSICS_STEP * 1000;

      // Make: ball centre passes downward through the target rim plane inside the rim.
      if (!made && prevPos.y >= rim.y && p.y < rim.y && vel.y < 0) {
        const f = (prevPos.y - rim.y) / (prevPos.y - p.y);
        const cx = prevPos.x + (p.x - prevPos.x) * f;
        const cz = prevPos.z + (p.z - prevPos.z) * f;
        if (Math.hypot(cx - rim.x, cz - rim.z) < RIM_INNER_RADIUS) {
          made = true;
          madeStep = step;
          addEvent("make", tMs, 0);
        }
      }

      // Bounces: a velocity change well beyond one step of gravity.
      const dv = Math.hypot(vel.x - prevVel.x, vel.y - prevVel.y + GRAVITY * PHYSICS_STEP, vel.z - prevVel.z);
      if (dv > BOUNCE_DV) addEvent(classifyContact(p), tMs, dv);

      if (step % stepsPerKey === 0) pushKey(p);
      prevPos = { x: p.x, y: p.y, z: p.z };
      prevVel = { x: vel.x, y: vel.y, z: vel.z };

      const speed = Math.hypot(vel.x, vel.y, vel.z);
      settled = speed < 0.25 && p.y < BALL_RADIUS + 0.03 ? settled + 1 : 0;
      if (settled >= 12) break;
      if (made && step - madeStep >= afterMakeSteps) break;
      if (Math.abs(p.x) > FENCE_HALF_WIDTH + 1 || Math.abs(p.z) > FENCE_HALF_LENGTH + 1 || p.y < -1) break;
    }
    if (step % stepsPerKey !== 0) pushKey(prevPos);

    this.world.removeRigidBody(body);
    return { made, keyframes, durationMs: Math.round(step * PHYSICS_STEP * 1000), events };
  }
}

function nearBox(p: Vec3, b: BoxShape, pad: number): boolean {
  return (
    Math.abs(p.x - b.center.x) <= b.half.x + pad &&
    Math.abs(p.y - b.center.y) <= b.half.y + pad &&
    Math.abs(p.z - b.center.z) <= b.half.z + pad
  );
}

function classifyContact(p: Vec3): ShotEventKind {
  const pad = BALL_RADIUS + 0.04;
  for (const id of HOOP_IDS) {
    const hoop = hoopLayout(id);
    const rho = Math.hypot(p.x - hoop.rim.x, p.z - hoop.rim.z);
    if (Math.hypot(rho - RIM_RING_RADIUS, p.y - hoop.rim.y) < pad + RIM_TUBE_RADIUS) return "rim";
    if (nearBox(p, hoop.board, pad)) return "board";
    if (nearBox(p, hoop.arm, pad) || Math.hypot(p.x - hoop.pole.center.x, p.z - hoop.pole.center.z) < hoop.pole.radius + pad) {
      return "pole";
    }
  }
  if (p.y < BALL_RADIUS + 0.06) return "ground";
  return "fence";
}
