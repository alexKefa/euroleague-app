export type HoopId = "A" | "B";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ShotLaunch {
  hoopId: HoopId;
  /** Release point (ball centre). */
  origin: Vec3;
  /** Launch velocity with timing error and noise applied. */
  velocity: Vec3;
  /** Angular velocity (backspin). */
  spin: Vec3;
  /** Horizontal distance from the release point to the rim centre. */
  distance: number;
  /** True when the release was inside the green window. */
  perfect: boolean;
}

export type ShotEventKind = "rim" | "board" | "ground" | "pole" | "fence" | "make";

export interface ShotEvent {
  /** Milliseconds since release. */
  t: number;
  kind: ShotEventKind;
  /** Impact speed change, m/s (0 for "make"). */
  strength: number;
}

export interface ShotResult {
  made: boolean;
  /** Flat [x, y, z, x, y, z, ...] ball centre positions in centimetres, at SHOT_KEYFRAME_HZ. */
  keyframes: number[];
  durationMs: number;
  events: ShotEvent[];
}
