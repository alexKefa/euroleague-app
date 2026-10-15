import type { RoundClipData } from "../../../core/models";

// Round clips (docs/superpowers/specs/2026-10-15-round-clip-design.md):
// which scenes run, when, and the easing they share. No drawing and no
// Angular here, so it runs under `npx tsx --test`.

export type SceneId = "hook" | "results" | "topPredictor" | "boldCall" | "payoff" | "cta";

export interface Scene {
  id: SceneId;
  start: number;
  end: number;
  /** The hook shows the upset, or the bold call when there's no upset. */
  variant?: "upset" | "boldCall";
}

const DURATION: Record<SceneId, number> = { hook: 2, results: 4, topPredictor: 3, boldCall: 3, payoff: 4, cta: 2 };

/** The clip's scenes in order; skipped scenes close the gap. */
export function buildTimeline(data: RoundClipData): Scene[] {
  const plan: Omit<Scene, "start" | "end">[] = [];
  if (data.hook) plan.push({ id: "hook", variant: "upset" });
  else if (data.boldCall) plan.push({ id: "hook", variant: "boldCall" });
  plan.push({ id: "results" });
  if (data.topPredictor) plan.push({ id: "topPredictor" });
  if (data.boldCall && data.hook) plan.push({ id: "boldCall" });
  plan.push({ id: "payoff" }, { id: "cta" });

  let t = 0;
  return plan.map((s) => {
    const scene = { ...s, start: t, end: t + DURATION[s.id] };
    t = scene.end;
    return scene;
  });
}

export function clipDuration(timeline: Scene[]): number {
  return timeline.length ? timeline[timeline.length - 1].end : 0;
}

/** The scene at `time` and how far into it (seconds); the last scene holds past the end. */
export function sceneAt(timeline: Scene[], time: number): { scene: Scene; local: number } | null {
  if (!timeline.length) return null;
  const scene = timeline.find((s) => time < s.end) ?? timeline[timeline.length - 1];
  return { scene, local: Math.max(0, time - scene.start) };
}

export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);

export function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** 0..1 progress of an animation that starts `from` seconds into a scene and lasts `dur`. */
export function progress(local: number, from: number, dur: number): number {
  return Math.min(1, Math.max(0, (local - from) / dur));
}
