import { test } from "node:test";
import assert from "node:assert/strict";
import { ClipAbortedError, pickRecorderFormat, recordClip } from "./clip-recorder";

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
  const canvas = { captureStream: () => ({ getTracks: () => [] }) } as unknown as HTMLCanvasElement;

  const abort = new AbortController();
  const recording = recordClip(canvas, 10, () => {}, () => {}, abort.signal);
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(recording, ClipAbortedError);
});
