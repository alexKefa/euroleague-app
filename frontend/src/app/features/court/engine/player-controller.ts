// Local player movement + third-person camera.
//
// The camera sits behind the player on the line from the hoop of the half
// they're on, so pushing "forward" runs at the basket and left/right circles
// the arc. Movement is camera-relative, but the camera yaw is latched when a
// push starts: otherwise running across midcourt flips the camera, which
// flips "forward", which turns the player around (an oscillation).
import { PerspectiveCamera, Vector3 } from "three";
import { PLAYER_SPEED } from "../../../../../../shared/court/constants";
import { clampPlayerPosition, hoopForHalf, rimCenter, yawTowards } from "../../../../../../shared/court/geometry";
import { HoopId } from "../../../../../../shared/court/types";

export interface CameraPreset {
  distance: number;
  height: number;
  lookHeight: number;
}

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  { distance: 6.2, height: 3.1, lookHeight: 1.9 }, // default
  { distance: 9, height: 4.6, lookHeight: 1.6 }, // wide
  { distance: 4.3, height: 2.3, lookHeight: 2.1 }, // close
];

const TURN_RATE = 12; // rad/s towards the desired facing
const CAMERA_YAW_RATE = 3.2;
const CAMERA_FOLLOW = 8;
/** Distance past midcourt before the camera switches to the other hoop. */
const HALF_HYSTERESIS = 1.2;

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function approachAngle(current: number, target: number, maxStep: number): number {
  const d = wrap(target - current);
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}

export class PlayerController {
  x = 0;
  z = -5;
  rotY = Math.PI; // facing hoop A
  moving = false;
  /** Current ground speed, m/s. */
  speed = 0;
  /** When set, the player turns to face this yaw (shooting) and can't move. */
  lockedYaw: number | null = null;

  private cameraHoop: HoopId = "A";
  private cameraYaw = Math.PI;
  private latchedYaw: number | null = null;
  private readonly camPos = new Vector3();
  private readonly lookAt = new Vector3();
  private shake = 0;
  private initialized = false;
  preset = 0;

  /** Advance movement. `input`: x = right, y = forward. */
  update(dt: number, input: { x: number; y: number }): void {
    const active = Math.hypot(input.x, input.y) > 0.01;
    if (this.lockedYaw !== null) {
      this.rotY = approachAngle(this.rotY, this.lockedYaw, TURN_RATE * 1.5 * dt);
      this.moving = false;
      this.speed = 0;
      this.latchedYaw = null;
      return;
    }
    if (!active) {
      this.latchedYaw = null;
      this.moving = false;
      this.speed = 0;
      return;
    }
    if (this.latchedYaw === null) this.latchedYaw = this.cameraYaw;
    const c = this.latchedYaw;
    const fx = Math.sin(c);
    const fz = Math.cos(c);
    // right = forward x up = (-fz, 0, fx)
    const mx = fx * input.y - fz * input.x;
    const mz = fz * input.y + fx * input.x;
    const mag = Math.min(1, Math.hypot(mx, mz));
    const p = clampPlayerPosition(this.x + mx * PLAYER_SPEED * dt, this.z + mz * PLAYER_SPEED * dt);
    this.x = p.x;
    this.z = p.z;
    this.moving = mag > 0.05;
    this.speed = this.moving ? mag * PLAYER_SPEED : 0;
    if (this.moving) this.rotY = approachAngle(this.rotY, Math.atan2(mx, mz), TURN_RATE * dt);
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  /** Position the camera. */
  updateCamera(dt: number, camera: PerspectiveCamera): void {
    if (this.cameraHoop === "A" && this.z > HALF_HYSTERESIS) this.cameraHoop = "B";
    else if (this.cameraHoop === "B" && this.z < -HALF_HYSTERESIS) this.cameraHoop = "A";
    if (!this.initialized) this.cameraHoop = hoopForHalf(this.z);

    const rim = rimCenter(this.cameraHoop);
    const dist = Math.hypot(rim.x - this.x, rim.z - this.z);
    // Right under the rim the direction is unstable: keep the current yaw.
    const desired = dist > 1.8 ? yawTowards(this.x, this.z, rim.x, rim.z) : this.cameraYaw;
    this.cameraYaw = this.initialized ? approachAngle(this.cameraYaw, desired, CAMERA_YAW_RATE * dt * Math.max(0.4, Math.abs(wrap(desired - this.cameraYaw)))) : desired;

    const preset = CAMERA_PRESETS[this.preset]!;
    const fx = Math.sin(this.cameraYaw);
    const fz = Math.cos(this.cameraYaw);
    const target = new Vector3(this.x - fx * preset.distance, preset.height, this.z - fz * preset.distance);
    const look = new Vector3(this.x + fx * 2.5, preset.lookHeight, this.z + fz * 2.5);
    const k = this.initialized ? 1 - Math.exp(-CAMERA_FOLLOW * dt) : 1;
    this.camPos.lerp(target, k);
    this.lookAt.lerp(look, k);
    this.initialized = true;

    camera.position.copy(this.camPos);
    if (this.shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * this.shake;
      camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-10 * dt);
    }
    camera.lookAt(this.lookAt);
  }
}
