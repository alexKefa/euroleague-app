import { test } from "node:test";
import assert from "node:assert/strict";
import { ClipAbortedError, dueFrame, pickRecorderFormat, recordClip } from "./clip-recorder";

test("MP4 is preferred when the browser can record it", () => {
  assert.deepEqual(pickRecorderFormat(() => true), { mime: "video/mp4;codecs=avc1", ext: "mp4" });
});

test("a WebM-only browser records WebM", () => {
  assert.deepEqual(pickRecorderFormat((m) => m.startsWith("video/webm")), { mime: "video/webm;codecs=vp9", ext: "webm" });
});

test("a browser that can't record anything gets no format", () => {
  assert.equal(pickRecorderFormat(() => false), null);
});

test("aborting mid-recording rejects instead of producing a file", async () => {
  const g = globalThis as any;
  g.MediaRecorder = class {
    static isTypeSupported = () => true;
    state = "inactive";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      queueMicrotask(() => this.onstop?.());
    }
  };
  g.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 5);
  g.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
  const canvas = { captureStream: () => ({ getTracks: () => [], getVideoTracks: () => [] }) } as unknown as HTMLCanvasElement;

  const abort = new AbortController();
  const recording = recordClip(canvas, 10, () => {}, () => {}, abort.signal);
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(recording, ClipAbortedError);
});

test("frames fall on a fixed 1/60 s grid, skipping rather than bunching after a stall", () => {
  assert.equal(dueFrame(0), 0);
  assert.equal(dueFrame(0.0167), 1);
  assert.equal(dueFrame(0.025), 1); // a 144 Hz tick between grid points sends nothing new
  assert.equal(dueFrame(0.5), 30); // after a stall, jump straight to the frame that's due
});

test("each captured frame is drawn at an exact grid time", async () => {
  const g = globalThis as any;
  let clock = 0;
  const realNow = performance.now.bind(performance);
  performance.now = () => clock;
  // A 144 Hz display: ticks every ~6.9 ms, which don't line up with 60 fps.
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb((clock += 1000 / 144)), 0);
  const drawn: number[] = [];
  let lastDraw = NaN;
  const requested: number[] = [];
  const track = { requestFrame: () => requested.push(lastDraw), stop() {} };
  const canvas = { captureStream: (fps: number) => (assert.equal(fps, 0), { getTracks: () => [track], getVideoTracks: () => [track] }) } as unknown as HTMLCanvasElement;

  try {
    await recordClip(canvas, 0.5, (t) => drawn.push((lastDraw = t)), () => {});
  } finally {
    performance.now = realNow;
  }
  assert.deepEqual(requested, drawn);
  const grid = drawn.filter((t) => t < 0.5);
  grid.forEach((t, i) => assert.ok(Math.abs(t - i / 60) < 1e-9, `frame ${i} drawn at ${t}`));
  assert.equal(grid.length, 30);
});
