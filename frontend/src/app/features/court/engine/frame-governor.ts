// Adaptive render resolution (CLUTCH_COURT_SPEC.md §10: 30 fps minimum on a
// mid-range phone). Watches frame times in 2 s windows; after two slow windows
// in a row it lowers the pixel ratio one step. If a drop didn't make frames
// faster (a 30 Hz battery-saver cap, or a CPU-bound phone where pixels aren't
// the problem) it puts the resolution back and stops adjusting for good.
// Never raises quality on its own: no oscillation.

const WINDOW_MS = 2000;
const WARMUP_MS = 3000;
/** Below this, a window counts as slow. */
const SLOW_FPS = 45;
/** A drop must gain at least this much fps to be kept. */
const MIN_GAIN_FPS = 5;
const STEP = 0.25;
/** Longer frames are a tab switch or a lock screen, not rendering cost. */
const IGNORE_FRAME_MS = 250;

export interface GovernorStats {
  /** Average fps over the last complete window. */
  fps: number;
  /** 1% low: fps of the slowest 1% of frames in the last window. */
  low1: number;
  dpr: number;
}

export class FrameGovernor {
  private startedAt: number | null = null;
  private windowStart = 0;
  private frames: number[] = [];
  private slowWindows = 0;
  private done = false;
  /** Set right after a drop: the previous ratio and fps, to judge whether it helped. */
  private trial: { prevDpr: number; prevFps: number } | null = null;
  private last: GovernorStats;

  constructor(
    private dpr: number,
    private readonly minDpr: number
  ) {
    this.last = { fps: 0, low1: 0, dpr };
  }

  stats(): GovernorStats {
    return { ...this.last, dpr: this.dpr };
  }

  /** Feed one frame. Returns the new pixel ratio when it should change, else null. */
  frame(now: number, frameMs: number): number | null {
    if (this.startedAt === null) {
      this.startedAt = now;
      this.windowStart = now;
    }
    if (frameMs > IGNORE_FRAME_MS) {
      // Start a fresh window: the gap says nothing about rendering speed.
      this.windowStart = now;
      this.frames = [];
      return null;
    }
    this.frames.push(frameMs);
    if (now - this.windowStart < WINDOW_MS) return null;

    const elapsed = now - this.windowStart;
    const fps = (this.frames.length * 1000) / elapsed;
    // 1% low: the average of the slowest 1% of frames (at least one).
    const worst = [...this.frames].sort((a, b) => b - a).slice(0, Math.max(1, Math.floor(this.frames.length / 100)));
    const worstMs = worst.reduce((a, b) => a + b, 0) / worst.length;
    this.last = { fps: Math.round(fps), low1: Math.round(1000 / worstMs), dpr: this.dpr };
    this.windowStart = now;
    this.frames = [];

    if (this.done || now - this.startedAt < WARMUP_MS) return null;

    if (this.trial) {
      const { prevDpr, prevFps } = this.trial;
      this.trial = null;
      if (fps < prevFps + MIN_GAIN_FPS) {
        // Resolution wasn't the bottleneck: restore it and leave it alone.
        this.done = true;
        this.dpr = prevDpr;
        return this.dpr;
      }
    }

    this.slowWindows = fps < SLOW_FPS ? this.slowWindows + 1 : 0;
    if (this.slowWindows < 2 || this.dpr <= this.minDpr) return null;
    this.slowWindows = 0;
    this.trial = { prevDpr: this.dpr, prevFps: fps };
    this.dpr = Math.max(this.minDpr, Math.round((this.dpr - STEP) * 100) / 100);
    return this.dpr;
  }
}
