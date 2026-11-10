// Shot model (CLUTCH_COURT_SPEC.md §5). Pure: the client (practice mode) and
// the court server compute the exact same launch from the same inputs.
import {
  BALL_BACKSPIN,
  LAYUP_APEX_ABOVE_RIM,
  LAYUP_ERROR_SCALE,
  LAYUP_GATHER,
  LAYUP_MAX_DISTANCE,
  LAYUP_MIN_APPROACH,
  LAYUP_MIN_RELEASE_DISTANCE,
  LAYUP_RELEASE_HEIGHT,
  GRAVITY,
  METER_ERROR_SPAN,
  METER_FILL_SECONDS,
  METER_OVERHOLD_SECONDS,
  METER_SWEET_CENTER,
  PERFECT_TIMING,
  PHYSICS_STEP,
  RELEASE_HEIGHT,
  SHOT_MIN_DISTANCE,
  THREE_POINT_RADIUS,
} from "./constants.js";
import { rimCenter } from "./geometry.js";
import { createRng, gaussian } from "./rng.js";
import { HoopId, ShotKind, ShotLaunch, Vec3 } from "./types.js";

// Error tuning. Effective error is 0 inside the green window, so a perfect
// release only carries the small seeded noise below.
/** Fractional speed error at |effective error| = 1 and distance factor 1. */
export const POWER_ERROR = 0.08;
/** Left/right aim error (radians) at |effective error| = 1 and distance factor 1. */
export const ANGLE_ERROR = (3.2 * Math.PI) / 180;
/** Seeded noise (1 sigma), scaled by noiseFactor(distance). */
export const NOISE_POWER = 0.0052;
export const NOISE_ANGLE = (0.42 * Math.PI) / 180;

/** Apex height above the rim: 1.0 m for layups rising to 1.5 m from deep. */
export function apexAboveRim(distance: number): number {
  return 1.0 + 0.5 * Math.min(1, Math.max(0, distance / 8));
}

/**
 * Launch velocity that carries the ball from `origin` through `target`
 * (descending), peaking `apexAboveRim(distance)` above the target.
 */
export function idealVelocity(origin: Vec3, target: Vec3, apexAbove?: number): Vec3 {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const distance = Math.hypot(dx, dz);
  const apexY = Math.max(target.y + (apexAbove ?? apexAboveRim(distance)), origin.y + 0.3);
  const vy = Math.sqrt(2 * GRAVITY * (apexY - origin.y));
  const tUp = vy / GRAVITY;
  const tDown = Math.sqrt((2 * (apexY - target.y)) / GRAVITY);
  const t = tUp + tDown;
  // The physics step is semi-implicit Euler, which drops the ball an extra
  // g·dt·t/2 below the analytic arc. Adding g·dt/2 to vy makes the stepped
  // positions land exactly on the analytic curve.
  return { x: dx / t, y: vy + (GRAVITY * PHYSICS_STEP) / 2, z: dz / t };
}

/** Distance difficulty factor: ~0.5 at the rim, 1.5 at the 3-point line. */
export function distanceFactor(distance: number): number {
  return 0.5 + distance / THREE_POINT_RADIUS;
}

export function clampTiming(timingError: number): number {
  if (!Number.isFinite(timingError)) return 1;
  return Math.max(-1, Math.min(1, timingError));
}

/** Timing error with the green window removed, rescaled back to [-1, 1]. */
export function effectiveTiming(timingError: number): number {
  const e = clampTiming(timingError);
  const over = Math.max(0, Math.abs(e) - PERFECT_TIMING) / (1 - PERFECT_TIMING);
  return Math.sign(e) * over;
}

/** Release point for a player standing at (x, z) shooting at `hoopId`. */
export function releasePoint(x: number, z: number, hoopId: HoopId): Vec3 {
  const rim = rimCenter(hoopId);
  let dx = x - rim.x;
  let dz = z - rim.z;
  const d = Math.hypot(dx, dz);
  if (d >= SHOT_MIN_DISTANCE) return { x, y: RELEASE_HEIGHT, z };
  // Too close (under the rim): pull the release back towards midcourt.
  if (d < 1e-3) {
    dx = 0;
    dz = -Math.sign(rim.z) || 1;
  } else {
    dx /= d;
    dz /= d;
  }
  return { x: rim.x + dx * SHOT_MIN_DISTANCE, y: RELEASE_HEIGHT, z: rim.z + dz * SHOT_MIN_DISTANCE };
}

/**
 * Does a shot from (x, z) while moving at (vx, vz) m/s count as a layup?
 * Close to the rim and driving at it; standing, drifting or cutting across
 * is a jump shot.
 */
export function layupEligible(x: number, z: number, hoopId: HoopId, vx: number, vz: number, minApproach = LAYUP_MIN_APPROACH): boolean {
  if (![x, z, vx, vz].every(Number.isFinite)) return false;
  const rim = rimCenter(hoopId);
  const dx = rim.x - x;
  const dz = rim.z - z;
  const d = Math.hypot(dx, dz);
  if (d > LAYUP_MAX_DISTANCE || d < 1e-3) return false;
  const approach = (vx * dx + vz * dz) / d;
  return approach >= minApproach;
}

/** Layup release: a gather step towards the rim, up at full extension. */
export function layupReleasePoint(x: number, z: number, hoopId: HoopId): Vec3 {
  const rim = rimCenter(hoopId);
  let ux = x - rim.x;
  let uz = z - rim.z;
  const d = Math.hypot(ux, uz);
  if (d < 1e-3) {
    ux = 0;
    uz = -Math.sign(rim.z) || 1;
  } else {
    ux /= d;
    uz /= d;
  }
  const r = Math.max(LAYUP_MIN_RELEASE_DISTANCE, d - LAYUP_GATHER);
  return { x: rim.x + ux * r, y: LAYUP_RELEASE_HEIGHT, z: rim.z + uz * r };
}

/**
 * Full launch for a shot: ideal velocity, plus timing error (power + aim,
 * scaled by distance) and seeded noise. Early (negative) releases fall short,
 * late (positive) ones go long.
 */
export function computeShotLaunch(
  x: number,
  z: number,
  hoopId: HoopId,
  timingError: number,
  seed: number,
  kind: ShotKind = "jumper"
): ShotLaunch {
  const rng = createRng(seed);
  const rim = rimCenter(hoopId);
  const layup = kind === "layup";
  const origin = layup ? layupReleasePoint(x, z, hoopId) : releasePoint(x, z, hoopId);
  const ideal = idealVelocity(origin, rim, layup ? LAYUP_APEX_ABOVE_RIM : undefined);
  const distance = Math.hypot(rim.x - origin.x, rim.z - origin.z);
  const df = distanceFactor(distance) * (layup ? LAYUP_ERROR_SCALE : 1);
  const nf = noiseFactor(distance) * (layup ? 0.7 : 1);
  const eff = effectiveTiming(timingError);
  const perfect = eff === 0;

  const aimSide = rng() < 0.5 ? -1 : 1;
  const power = 1 + eff * POWER_ERROR * df + gaussian(rng) * NOISE_POWER * nf;
  const yawErr = Math.abs(eff) * ANGLE_ERROR * df * aimSide + gaussian(rng) * NOISE_ANGLE * nf;

  const cos = Math.cos(yawErr);
  const sin = Math.sin(yawErr);
  const hx = ideal.x * cos - ideal.z * sin;
  const hz = ideal.x * sin + ideal.z * cos;
  const velocity = { x: hx * power, y: ideal.y * power, z: hz * power };

  // Backspin: axis = forward x up, so the top of the ball turns back.
  const fLen = Math.hypot(hx, hz) || 1;
  const fx = hx / fLen;
  const fz = hz / fLen;
  const backspin = layup ? BALL_BACKSPIN * 0.5 : BALL_BACKSPIN;
  const spin = { x: -fz * backspin, y: 0, z: fx * backspin };

  return { kind, hoopId, origin, velocity, spin, distance, perfect };
}

/** Meter value (0..1+) after holding for `heldSeconds`. */
export function meterValue(heldSeconds: number, fillSeconds = METER_FILL_SECONDS): number {
  return Math.max(0, heldSeconds / fillSeconds);
}

/** Has the hold gone past the top long enough to auto-release? */
export function meterOverheld(heldSeconds: number, fillSeconds = METER_FILL_SECONDS): boolean {
  return heldSeconds >= fillSeconds + METER_OVERHOLD_SECONDS;
}

/** Map a meter value at release to timingError in [-1, 1] (0 = perfect). */
export function timingErrorFromMeter(value: number): number {
  return clampTiming((value - METER_SWEET_CENTER) / METER_ERROR_SPAN);
}

/** Noise grows more gently with distance than timing error does: 0.7 at the rim, 1.0 at the 3-point line. */
export function noiseFactor(distance: number): number {
  return 0.7 + (0.3 * distance) / THREE_POINT_RADIUS;
}
