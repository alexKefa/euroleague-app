/**
 * Spring physics for throwing a card off a deck, used by the pack reveal.
 *
 * Adapted from kokonutui's "Throw Deck" (MIT, @dorianbaffier,
 * https://github.com/kokonut-labs/kokonutui). Kept framework-free: the
 * caller writes `poseTransform()` straight onto the element each frame.
 */

export interface Pose {
  x: number;
  y: number;
  r: number;
  s: number;
}

export interface Body extends Pose {
  vx: number;
  vy: number;
  vr: number;
  vs: number;
}

export interface Spring {
  k: number;
  c: number;
}

export interface DragSample {
  t: number;
  x: number;
  y: number;
}

// Dragging rotates the card up to this many degrees across its own width.
export const MAX_DRAG_ROTATION = 18;
// A release throws the card when it is this fast (px/ms) or this far (share
// of the card's width). Anything less springs home.
// Tuned stricter than kokonutui's 0.5 / 0.35: on phones those threw on
// almost any drag (2026-11-11).
export const THROW_VELOCITY = 0.9;
export const THROW_DISTANCE = 0.55;
// Moves shorter than this are a tap, not a drag.
export const TAP_SLOP = 5;
// Release velocity is measured over the last stretch of the gesture only.
const VELOCITY_WINDOW = 90;

// Home is slightly underdamped so a hard release visibly carries through;
// the flight is looser so a faster flick travels further.
export const HOME: Spring = { k: 420, c: 30 };
export const FLIGHT: Spring = { k: 150, c: 15 };

export const REST: Pose = { x: 0, y: 0, r: 0, s: 1 };

export function makeBody(pose: Pose = REST): Body {
  return { ...pose, vx: 0, vy: 0, vr: 0, vs: 0 };
}

export function poseTransform({ x, y, r, s }: Pose): string {
  return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(4)})`;
}

function springAxis(value: number, velocity: number, target: number, spring: Spring, dt: number): [number, number] {
  const accel = -spring.k * (value - target) - spring.c * velocity;
  const v = velocity + accel * dt;
  return [value + v * dt, v];
}

export function stepBody(body: Body, target: Pose, spring: Spring, dt: number): void {
  // Sub-step so a stiff spring stays stable on a slow frame.
  const steps = Math.max(1, Math.ceil(dt * 240));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    [body.x, body.vx] = springAxis(body.x, body.vx, target.x, spring, h);
    [body.y, body.vy] = springAxis(body.y, body.vy, target.y, spring, h);
    [body.r, body.vr] = springAxis(body.r, body.vr, target.r, spring, h);
    [body.s, body.vs] = springAxis(body.s, body.vs, target.s, spring, h);
  }
}

export function isSettled(body: Body, target: Pose): boolean {
  return (
    Math.abs(body.x - target.x) < 0.1 &&
    Math.abs(body.y - target.y) < 0.1 &&
    Math.abs(body.r - target.r) < 0.02 &&
    Math.abs(body.s - target.s) < 0.0005 &&
    Math.abs(body.vx) + Math.abs(body.vy) < 2 &&
    Math.abs(body.vr) < 1 &&
    Math.abs(body.vs) < 0.01
  );
}

/** Distance along (ux, uy) at which a w×h card no longer covers the deck. */
export function clearance(w: number, h: number, ux: number, uy: number): number {
  const along = Math.min(
    ux === 0 ? Number.POSITIVE_INFINITY : w / Math.abs(ux),
    uy === 0 ? Number.POSITIVE_INFINITY : h / Math.abs(uy)
  );
  return along + 24;
}

/** Pointer velocity in px/ms over the last ~90 ms of the gesture. */
export function releaseVelocity(samples: DragSample[]): { vx: number; vy: number } {
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last && last.t - s.t <= VELOCITY_WINDOW);
  if (!(first && last) || last.t - first.t < 8) return { vx: 0, vy: 0 };
  const dt = last.t - first.t;
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

export interface Throw {
  body: Body;
  target: Pose;
  /** Unit direction of the throw. */
  dx: number;
  dy: number;
  distance: number;
}

/**
 * Launch a card from `from` along (vx, vy) px/ms. (fx, fy) is the direction
 * to use when there is no real velocity (a tap or a slow, long drag).
 */
export function launch(from: Pose, vx: number, vy: number, fx: number, fy: number, w: number, h: number): Throw {
  const speed = Math.hypot(vx, vy);
  const rawX = speed > 0.05 ? vx : fx;
  const rawY = speed > 0.05 ? vy : fy;
  const norm = Math.hypot(rawX, rawY) || 1;
  const dx = rawX / norm;
  const dy = rawY / norm;
  const distance = clearance(w, h, dx, dy) + Math.min(speed * 50, 90);
  // Keep some speed so a slow but far drag still leaves with intent.
  const v = Math.max(speed, 0.9) * 1000;
  const body = makeBody(from);
  body.vx = dx * v;
  body.vy = dy * v;
  body.vr = dx * v * 0.05;
  return {
    body,
    dx,
    dy,
    distance,
    target: {
      x: dx * distance,
      y: dy * distance,
      r: Math.max(-40, Math.min(40, from.r + dx * 26)),
      s: 0.9,
    },
  };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
