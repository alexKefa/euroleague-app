// Court layout derived from constants.ts: hoop positions, static collider
// descriptions (consumed by sim.ts and the renderer), bounds and targeting.
import {
  BACKBOARD_BOTTOM,
  BACKBOARD_HEIGHT,
  BACKBOARD_THICKNESS,
  BACKBOARD_WIDTH,
  BOARD_FROM_BASELINE,
  FENCE_HALF_LENGTH,
  FENCE_HALF_WIDTH,
  HALF_LENGTH,
  PLAYER_FENCE_MARGIN,
  PLAYER_RADIUS,
  POLE_BEHIND_BASELINE,
  POLE_RADIUS,
  RIM_BOARD_GAP,
  RIM_HEIGHT,
  RIM_INNER_RADIUS,
  RIM_TUBE_RADIUS,
  SHOT_TARGET_HALF_ANGLE,
  THREE_POINT_CORNER_INSET,
  THREE_POINT_RADIUS,
  HALF_WIDTH,
} from "./constants.js";
import { HoopId, Vec3 } from "./types.js";

export const HOOP_IDS: readonly HoopId[] = ["A", "B"];

/**
 * Half court for now (user decision 2026-11-09, overriding the spec's full
 * court): only hoop A is built, and the fence closes 2.5 m past the
 * midcourt line. Flip to false for the full two-hoop court.
 */
export const HALF_COURT = true;

/** Hoops that physically exist on the court. */
export const ACTIVE_HOOPS: readonly HoopId[] = HALF_COURT ? ["A"] : HOOP_IDS;

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The fence lines. */
export const FENCE: Bounds = {
  minX: -FENCE_HALF_WIDTH,
  maxX: FENCE_HALF_WIDTH,
  minZ: -FENCE_HALF_LENGTH,
  maxZ: HALF_COURT ? 2.5 : FENCE_HALF_LENGTH,
};

/** -1 for hoop A (at -z), +1 for hoop B (at +z). */
export function hoopSign(hoopId: HoopId): -1 | 1 {
  return hoopId === "A" ? -1 : 1;
}

/** Rim centre (in the rim plane). */
export function rimCenter(hoopId: HoopId): Vec3 {
  const s = hoopSign(hoopId);
  const boardFace = HALF_LENGTH - BOARD_FROM_BASELINE;
  return { x: 0, y: RIM_HEIGHT, z: s * (boardFace - RIM_BOARD_GAP - RIM_INNER_RADIUS) };
}

/** Radius of the rim's tube centreline. */
export const RIM_RING_RADIUS = RIM_INNER_RADIUS + RIM_TUBE_RADIUS;

export interface BoxShape {
  kind: "box";
  center: Vec3;
  half: Vec3;
}

export interface CylinderShape {
  kind: "cylinder";
  center: Vec3;
  halfHeight: number;
  radius: number;
}

export interface HoopLayout {
  id: HoopId;
  rim: Vec3;
  board: BoxShape;
  pole: CylinderShape;
  /** Horizontal arm from the pole to the back of the board. */
  arm: BoxShape;
}

export function hoopLayout(hoopId: HoopId): HoopLayout {
  const s = hoopSign(hoopId);
  const boardFace = HALF_LENGTH - BOARD_FROM_BASELINE;
  const poleZ = HALF_LENGTH + POLE_BEHIND_BASELINE;
  const poleHeight = BACKBOARD_BOTTOM + 0.5;
  const armStart = boardFace + BACKBOARD_THICKNESS;
  const armLength = poleZ - armStart;
  return {
    id: hoopId,
    rim: rimCenter(hoopId),
    board: {
      kind: "box",
      center: { x: 0, y: BACKBOARD_BOTTOM + BACKBOARD_HEIGHT / 2, z: s * (boardFace + BACKBOARD_THICKNESS / 2) },
      half: { x: BACKBOARD_WIDTH / 2, y: BACKBOARD_HEIGHT / 2, z: BACKBOARD_THICKNESS / 2 },
    },
    pole: {
      kind: "cylinder",
      center: { x: 0, y: poleHeight / 2, z: s * poleZ },
      halfHeight: poleHeight / 2,
      radius: POLE_RADIUS,
    },
    arm: {
      kind: "box",
      center: { x: 0, y: BACKBOARD_BOTTOM + 0.35, z: s * (armStart + armLength / 2) },
      half: { x: 0.06, y: 0.08, z: armLength / 2 },
    },
  };
}

/** Is a floor point (x, z) inside the 3-point line area of a hoop? */
export function insideThreePoint(hoopId: HoopId, x: number, z: number): boolean {
  const s = hoopSign(hoopId);
  // Must be on this hoop's half and inside the court.
  if (s * z < 0 || Math.abs(x) > HALF_WIDTH || Math.abs(z) > HALF_LENGTH) return false;
  const rim = rimCenter(hoopId);
  const cornerX = HALF_WIDTH - THREE_POINT_CORNER_INSET;
  if (Math.abs(x) >= cornerX) return false;
  // The straight corner segment runs from the baseline to where it meets the arc.
  const dz = Math.sqrt(THREE_POINT_RADIUS ** 2 - cornerX ** 2);
  const zFromRim = s * (rim.z - z); // positive = towards midcourt
  if (zFromRim <= dz) return true;
  return Math.hypot(x - rim.x, z - rim.z) < THREE_POINT_RADIUS;
}

/** Clamp a player position to the fenced area, keeping clear of the poles. */
export function clampPlayerPosition(x: number, z: number): { x: number; z: number } {
  const m = PLAYER_FENCE_MARGIN;
  let cx = Math.max(FENCE.minX + m, Math.min(FENCE.maxX - m, x));
  let cz = Math.max(FENCE.minZ + m, Math.min(FENCE.maxZ - m, z));
  for (const id of ACTIVE_HOOPS) {
    const pole = hoopLayout(id).pole.center;
    const dx = cx - pole.x;
    const dz = cz - pole.z;
    const d = Math.hypot(dx, dz);
    const min = POLE_RADIUS + PLAYER_RADIUS;
    if (d < min) {
      const k = d > 1e-6 ? min / d : 1;
      cx = pole.x + (d > 1e-6 ? dx * k : min);
      cz = pole.z + dz * k;
    }
  }
  return { x: cx, z: cz };
}

/** Yaw (rotY) that faces from (x, z) towards a point. Forward = (sin rotY, cos rotY). */
export function yawTowards(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Spec §5.1: target the nearer hoop in front of the player (within ±60°).
 * If none is in front, the player turns to the nearest hoop.
 * Returns the hoop and the yaw the shooter should face.
 */
export function pickTargetHoop(
  x: number,
  z: number,
  rotY: number,
  hoops: readonly HoopId[] = ACTIVE_HOOPS
): { hoopId: HoopId; yaw: number } {
  const candidates = hoops.map((id) => {
    const rim = rimCenter(id);
    const yaw = yawTowards(x, z, rim.x, rim.z);
    return { hoopId: id, yaw, dist: Math.hypot(rim.x - x, rim.z - z), inFront: Math.abs(angleDiff(yaw, rotY)) <= SHOT_TARGET_HALF_ANGLE };
  }).sort((a, b) => a.dist - b.dist);
  const pick = candidates.find((c) => c.inFront) ?? candidates[0]!;
  return { hoopId: pick.hoopId, yaw: pick.yaw };
}

/** The hoop whose half of the court the point is on (always A on a half court). */
export function hoopForHalf(z: number): HoopId {
  if (ACTIVE_HOOPS.length === 1) return ACTIVE_HOOPS[0]!;
  return z < 0 ? "A" : "B";
}
