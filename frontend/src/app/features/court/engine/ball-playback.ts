// Plays a simulated shot back from its keyframes (CLUTCH_COURT_SPEC.md §5.6).
// Practice mode simulates locally and plays the result the same way the
// multiplayer client will play server keyframes.
import { Vector3 } from "three";
import { SHOT_KEYFRAME_HZ } from "../../../../../../shared/court/constants";
import { ShotEvent, ShotResult, Vec3 } from "../../../../../../shared/court/types";

const FRAME_MS = 1000 / SHOT_KEYFRAME_HZ;

export class BallPlayback {
  private frames: number;
  private nextEvent = 0;
  /** Playback time (ms) up to which events have been handed out. */
  private firedUntil = -1;
  /** False while this is the shooter's local prediction, true once the server's result is in. */
  authoritative = true;
  private readonly spinAxis: Vector3;
  private readonly spinRate: number;

  constructor(
    public result: ShotResult,
    readonly startedAt: number,
    spin: Vec3
  ) {
    this.frames = result.keyframes.length / 3;
    const s = new Vector3(spin.x, spin.y, spin.z);
    this.spinRate = s.length();
    this.spinAxis = this.spinRate > 0 ? s.normalize() : new Vector3(1, 0, 0);
  }

  /** Total playback length in ms. */
  get duration(): number {
    return (this.frames - 1) * FRAME_MS;
  }

  done(now: number): boolean {
    return now - this.startedAt >= this.duration;
  }

  /** Ball centre at `now`, Catmull-Rom interpolated between keyframes. */
  positionAt(now: number, out: Vector3): Vector3 {
    const t = Math.max(0, Math.min(now - this.startedAt, this.duration));
    const f = t / FRAME_MS;
    const i = Math.min(Math.floor(f), this.frames - 2);
    const u = f - i;
    const k = this.result.keyframes;
    const get = (j: number, axis: number) => k[Math.max(0, Math.min(this.frames - 1, j)) * 3 + axis]! / 100;
    const cr = (axis: number) => {
      const p0 = get(i - 1, axis);
      const p1 = get(i, axis);
      const p2 = get(i + 1, axis);
      const p3 = get(i + 2, axis);
      return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
    };
    if (this.frames < 2) return out.set(get(0, 0), get(0, 1), get(0, 2));
    return out.set(cr(0), cr(1), cr(2));
  }

  /** Spin angle (radians) about `axis` at `now`; spin decays after the first bounce feel. */
  spin(now: number): { axis: Vector3; angle: number } {
    const t = Math.max(0, now - this.startedAt) / 1000;
    return { axis: this.spinAxis, angle: this.spinRate * t * 0.6 };
  }

  /** Events whose time has passed since the last call. */
  takeEvents(now: number): ShotEvent[] {
    const t = now - this.startedAt;
    const out: ShotEvent[] = [];
    const ev = this.result.events;
    while (this.nextEvent < ev.length && ev[this.nextEvent]!.t <= t) out.push(ev[this.nextEvent++]!);
    this.firedUntil = Math.max(this.firedUntil, t);
    return out;
  }

  /**
   * Swap in the server's result for a predicted shot. Both start at the
   * release, so timing lines up; events already played are not replayed.
   * (With the server's seed the two are normally identical.)
   */
  replaceResult(result: ShotResult): void {
    this.result = result;
    this.frames = result.keyframes.length / 3;
    this.nextEvent = result.events.findIndex((e) => e.t > this.firedUntil);
    if (this.nextEvent < 0) this.nextEvent = result.events.length;
    this.authoritative = true;
  }
}
