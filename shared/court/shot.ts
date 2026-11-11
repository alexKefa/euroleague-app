// Shot model (CLUTCH_COURT_SPEC.md §5). Pure: the client (practice mode) and
// the court server compute the exact same launch from the same inputs.
import {
  BACKBOARD_WIDTH,
  BALL_BACKSPIN,
  BALL_RADIUS,
  LAYUP_APEX_ABOVE_RIM,
  LAYUP_ERROR_SCALE,
  LAYUP_GATHER,
  LAYUP_MAX_DISTANCE,
  LAYUP_MIN_APPROACH,
  LAYUP_MIN_RELEASE_DISTANCE,
  LAYUP_RELEASE_HEIGHT,
  GRAVITY,
  GREEN_HALF_WIDTH_CURVE,
  GREEN_MAX_DISTANCE,
  LAYUP_GREEN_HALF_WIDTH,
  METER_ERROR_SPAN,
  METER_FILL_SECONDS,
  METER_OVERHOLD_SECONDS,
  METER_MISS_RAMP,
  METER_SWEET_CENTER,
  METER_WHITE_WIDTH,
  PHYSICS_STEP,
  RELEASE_HEIGHT,
  SHOT_MIN_DISTANCE,
  THREE_POINT_RADIUS,
  WHITE_MAX_EFFECT,
} from "./constants.js";
import { hoopLayout, hoopSign, rimCenter } from "./geometry.js";
import { createRng, gaussian } from "./rng.js";
import { HoopId, ShotKind, ShotLaunch, Vec3 } from "./types.js";

// Error tuning. A perfect (green) release flies the ideal arc with no error
// and no noise, so it always goes in. Anything else gets the timing error
// below plus the seeded noise.
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

/** Half-width of the green window (meter units) for a shot of this horizontal distance. */
export function greenHalfWidth(distance: number, kind: ShotKind = "jumper"): number {
  if (kind === "layup") return LAYUP_GREEN_HALF_WIDTH;
  if (distance > GREEN_MAX_DISTANCE) return 0;
  const c = GREEN_HALF_WIDTH_CURVE;
  if (!(distance > c[0]![0])) return c[0]![1];
  for (let i = 1; i < c.length; i++) {
    const [d1, w1] = c[i]!;
    if (distance <= d1) {
      const [d0, w0] = c[i - 1]!;
      return w0 + ((w1 - w0) * (distance - d0)) / (d1 - d0);
    }
  }
  return c[c.length - 1]![1];
}

/** Out of range: no green, so the best possible release is a heave. */
export function outOfRange(distance: number, kind: ShotKind = "jumper"): boolean {
  return greenHalfWidth(distance, kind) === 0;
}

/** How far past the green the release was, in meter units (0 inside the green). */
function meterOverGreen(timingError: number, distance: number, kind: ShotKind): number {
  return Math.max(0, Math.abs(clampTiming(timingError)) * METER_ERROR_SPAN - greenHalfWidth(distance, kind));
}

/** Extra seeded-noise multiplier for heaves: 1 inside range, growing fast past it. */
export function heaveNoise(distance: number, kind: ShotKind = "jumper"): number {
  if (!outOfRange(distance, kind)) return 1;
  return HEAVE_NOISE_BASE + HEAVE_NOISE_PER_M * (distance - GREEN_MAX_DISTANCE);
}
export const HEAVE_NOISE_BASE = 3;
export const HEAVE_NOISE_PER_M = 1.2;

/**
 * Timing error after the green and white windows, in [-1, 1]: 0 in the green,
 * up to ±WHITE_MAX_EFFECT across the white zone, then ramping to ±1.
 */
export function effectiveTiming(timingError: number, distance: number, kind: ShotKind = "jumper"): number {
  let off = meterOverGreen(timingError, distance, kind);
  // No green out of range: dead-centre is treated as the best of the white zone.
  if (off === 0 && outOfRange(distance, kind)) off = 1e-6;
  if (off === 0) return 0;
  const mag =
    off <= METER_WHITE_WIDTH
      ? (WHITE_MAX_EFFECT * off) / METER_WHITE_WIDTH
      : WHITE_MAX_EFFECT + (1 - WHITE_MAX_EFFECT) * Math.min(1, (off - METER_WHITE_WIDTH) / METER_MISS_RAMP);
  return (clampTiming(timingError) < 0 ? -1 : 1) * mag;
}

export type ReleaseGrade = "perfect" | "slightlyEarly" | "slightlyLate" | "early" | "late" | "veryEarly" | "veryLate";

/** The word shown after a release. */
export function releaseGrade(timingError: number, distance: number, kind: ShotKind = "jumper"): ReleaseGrade {
  const off = meterOverGreen(timingError, distance, kind);
  if (off === 0 && !outOfRange(distance, kind)) return "perfect";
  const early = clampTiming(timingError) < 0;
  if (off <= METER_WHITE_WIDTH) return early ? "slightlyEarly" : "slightlyLate";
  if (off < METER_WHITE_WIDTH + METER_MISS_RAMP) return early ? "early" : "late";
  return early ? "veryEarly" : "veryLate";
}

/** Horizontal release-to-rim distance for a shot from (x, z), as computeShotLaunch measures it. */
export function shotDistance(x: number, z: number, hoopId: HoopId, kind: ShotKind = "jumper"): number {
  const rim = rimCenter(hoopId);
  const o = kind === "layup" ? layupReleasePoint(x, z, hoopId) : releasePoint(x, z, hoopId);
  return Math.hypot(rim.x - o.x, rim.z - o.z);
}

/**
 * Standing under or behind the backboard there's no line to the rim, so the
 * shot goes up from the mirror-image spot in front of it (same distance).
 */
function outOfBoardShadow(x: number, z: number, hoopId: HoopId): { x: number; z: number } {
  const rim = rimCenter(hoopId);
  const s = hoopSign(hoopId);
  const behind = s * (z - rim.z);
  if (behind > 0 && Math.abs(x - rim.x) < BACKBOARD_WIDTH / 2 + 0.6) return { x, z: rim.z - s * behind };
  return { x, z };
}

/** Release point for a player standing at (x, z) shooting at `hoopId`. */
export function releasePoint(px: number, pz: number, hoopId: HoopId): Vec3 {
  const { x, z } = outOfBoardShadow(px, pz, hoopId);
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
export function layupReleasePoint(px: number, pz: number, hoopId: HoopId): Vec3 {
  const { x, z } = outOfBoardShadow(px, pz, hoopId);
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
  // The gather can carry a baseline drive under the board: mirror that out too.
  const out = outOfBoardShadow(rim.x + ux * r, rim.z + uz * r, hoopId);
  return { x: out.x, y: LAYUP_RELEASE_HEIGHT, z: out.z };
}

/**
 * Full launch for a shot: ideal velocity, plus (unless the release was green)
 * timing error (power + aim, scaled by distance) and seeded noise. Early (negative) releases fall short,
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
  const distance = Math.hypot(rim.x - origin.x, rim.z - origin.z);
  const df = distanceFactor(distance) * (layup ? LAYUP_ERROR_SCALE : 1);
  const nf = noiseFactor(distance) * (layup ? 0.7 : 1);
  const eff = effectiveTiming(timingError, distance, kind);
  const perfect = eff === 0;
  const baseApex = layup ? LAYUP_APEX_ABOVE_RIM : apexAboveRim(distance);
  // A green release gets an arc that can't miss: lofted over the backboard
  // from behind it, and steep enough to fit through the rim from deep.
  const ideal = idealVelocity(origin, rim, perfect ? greenApex(origin, hoopId, baseApex) : baseApex);

  const aimSide = rng() < 0.5 ? -1 : 1;
  // In the white zone the noise fades in too (up to 70%): a hair off the green is nearly as good as green.
  const white = Math.abs(eff) <= WHITE_MAX_EFFECT;
  const noiseScale = nf * heaveNoise(distance, kind) * (white ? Math.max(0.35, Math.abs(eff) / WHITE_MAX_EFFECT) : 1);
  const noisePower = gaussian(rng) * NOISE_POWER * noiseScale;
  const noiseAngle = gaussian(rng) * NOISE_ANGLE * noiseScale;
  // Green = the ideal arc, untouched: it always goes in.
  const power = perfect ? 1 : 1 + eff * POWER_ERROR * df + noisePower;
  const yawErr = perfect ? 0 : Math.abs(eff) * ANGLE_ERROR * df * aimSide + noiseAngle;

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

/** Steepest-needed entry: below this the ball (with a little margin) can't fit through the rim. */
const MIN_ENTRY_ANGLE = (42 * Math.PI) / 180;
const CLEARANCE = BALL_RADIUS + 0.04;

/** Lowest apex (from `baseApex` up, in 0.25 m steps) whose arc clears the hoop's hardware and drops in steeply. */
export function greenApex(origin: Vec3, hoopId: HoopId, baseApex: number): number {
  for (let k = 0; k <= 32; k++) {
    const apex = baseApex + k * 0.25;
    if (arcIsClean(origin, hoopId, apex)) return apex;
  }
  return baseApex + 8;
}

function arcIsClean(origin: Vec3, hoopId: HoopId, apex: number): boolean {
  const layout = hoopLayout(hoopId);
  const rim = layout.rim;
  const v = idealVelocity(origin, rim, apex);
  const boxes = [
    layout.board,
    layout.arm,
    { center: layout.pole.center, half: { x: layout.pole.radius, y: layout.pole.halfHeight, z: layout.pole.radius } },
  ];
  const dt = 1 / 240;
  for (let t = dt; t < 8; t += dt) {
    const px = origin.x + v.x * t;
    const py = origin.y + v.y * t - 0.5 * GRAVITY * t * t;
    const pz = origin.z + v.z * t;
    const vy = v.y - GRAVITY * t;
    if (vy < 0 && py <= rim.y) {
      return Math.atan2(-vy, Math.hypot(v.x, v.z)) >= MIN_ENTRY_ANGLE;
    }
    for (const b of boxes) {
      if (
        Math.abs(px - b.center.x) < b.half.x + CLEARANCE &&
        Math.abs(py - b.center.y) < b.half.y + CLEARANCE &&
        Math.abs(pz - b.center.z) < b.half.z + CLEARANCE
      ) {
        return false;
      }
    }
  }
  return false;
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
