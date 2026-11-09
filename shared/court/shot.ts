// Shot model (CLUTCH_COURT_SPEC.md §5). Pure: the client (practice mode) and
// the court server compute the exact same launch from the same inputs.
import {
  BALL_BACKSPIN,
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
import { HoopId, ShotLaunch, Vec3 } from "./types.js";

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
export function idealVelocity(origin: Vec3, target: Vec3): Vec3 {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const distance = Math.hypot(dx, dz);
  const apexY = Math.max(target.y + apexAboveRim(distance), origin.y + 0.3);
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
 * Full launch for a shot: ideal velocity, plus timing error (power + aim,
 * scaled by distance) and seeded noise. Early (negative) releases fall short,
 * late (positive) ones go long.
 */
export function computeShotLaunch(x: number, z: number, hoopId: HoopId, timingError: number, seed: number): ShotLaunch {
  const rng = createRng(seed);
  const rim = rimCenter(hoopId);
  const origin = releasePoint(x, z, hoopId);
  const ideal = idealVelocity(origin, rim);
  const distance = Math.hypot(rim.x - origin.x, rim.z - origin.z);
  const df = distanceFactor(distance);
  const nf = noiseFactor(distance);
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
  const spin = { x: -fz * BALL_BACKSPIN, y: 0, z: fx * BALL_BACKSPIN };

  return { hoopId, origin, velocity, spin, distance, perfect };
}

/** Meter value (0..1+) after holding for `heldSeconds`. */
export function meterValue(heldSeconds: number): number {
  return Math.max(0, heldSeconds / METER_FILL_SECONDS);
}

/** Has the hold gone past the top long enough to auto-release? */
export function meterOverheld(heldSeconds: number): boolean {
  return heldSeconds >= METER_FILL_SECONDS + METER_OVERHOLD_SECONDS;
}

/** Map a meter value at release to timingError in [-1, 1] (0 = perfect). */
export function timingErrorFromMeter(value: number): number {
  return clampTiming((value - METER_SWEET_CENTER) / METER_ERROR_SPAN);
}

/** Noise grows more gently with distance than timing error does: 0.7 at the rim, 1.0 at the 3-point line. */
export function noiseFactor(distance: number): number {
  return 0.7 + (0.3 * distance) / THREE_POINT_RADIUS;
}
