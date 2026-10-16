// Round clips: records the canvas in real time while the clip plays
// (docs/superpowers/specs/2026-10-15-round-clip-design.md). No Angular here;
// DOM APIs are only touched inside recordClip, so the format pick is testable.

export interface RecorderFormat {
  mime: string;
  ext: "mp4" | "webm";
}

const FORMATS: RecorderFormat[] = [
  { mime: "video/mp4;codecs=avc1", ext: "mp4" },
  { mime: "video/mp4", ext: "mp4" },
  { mime: "video/webm;codecs=vp9", ext: "webm" },
  { mime: "video/webm", ext: "webm" },
];

/** MP4 first (TikTok/Instagram take it directly), then WebM; null when nothing records. */
export function pickRecorderFormat(isSupported: (mime: string) => boolean): RecorderFormat | null {
  return FORMATS.find((f) => isSupported(f.mime)) ?? null;
}

/** Browsers slow down animation in a hidden tab, which would ruin the video. */
export class ClipHiddenError extends Error {}

/** The recording was abandoned (e.g. the admin left the page); no file is produced. */
export class ClipAbortedError extends Error {}

/** 60, not 30: at 30 the export looked choppier than the preview, which redraws at the display's rate. */
export const CLIP_FPS = 60;

/**
 * The frame due at `elapsedSec` of wall time. Frames sit on a fixed 1/CLIP_FPS
 * grid; when the browser stalls, late ones are skipped rather than bunched up,
 * so the clip's content stays in step with the recording's timestamps.
 */
export function dueFrame(elapsedSec: number): number {
  return Math.floor(elapsedSec * CLIP_FPS);
}

/**
 * Plays the clip from 0 to `durationSec` while recording the canvas at a
 * steady CLIP_FPS. The stream doesn't sample on its own (captureStream(0)):
 * each frame is drawn at exactly frame / CLIP_FPS seconds and handed over with
 * requestFrame(), so frames are evenly spaced instead of depending on how the
 * display's refresh rate lines up with the recorder. Rejects with ClipHiddenError
 * if the tab is hidden mid-recording, and with ClipAbortedError when
 * `signal` aborts.
 */
export function recordClip(
  canvas: HTMLCanvasElement,
  durationSec: number,
  renderAt: (time: number) => void,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  const format = typeof MediaRecorder === "undefined" ? null : pickRecorderFormat((m) => MediaRecorder.isTypeSupported(m));
  if (!format) return Promise.reject(new Error("Recording is not supported in this browser"));

  return new Promise((resolve, reject) => {
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    const recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 20_000_000 });
    const chunks: Blob[] = [];
    let frame = 0;
    let failed: Error | null = null;

    const cleanup = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      signal?.removeEventListener("abort", onAbort);
      stream.getTracks().forEach((t) => t.stop());
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && recorder.state === "recording") {
        failed = new ClipHiddenError("The tab was hidden while recording");
        recorder.stop();
      }
    };

    const onAbort = () => {
      failed = new ClipAbortedError("Recording abandoned");
      if (recorder.state === "recording") recorder.stop();
    };

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      cleanup();
      if (failed) reject(failed);
      else resolve({ blob: new Blob(chunks, { type: format.mime.split(";")[0] }), ext: format.ext });
    };

    document.addEventListener("visibilitychange", onVisibility);
    signal?.addEventListener("abort", onAbort);
    recorder.start();
    const totalFrames = Math.ceil(durationSec * CLIP_FPS);
    // A few frames past the end so the held last frame makes it into the file.
    const lastFrame = totalFrames + Math.round(0.2 * CLIP_FPS);
    let sent = -1;
    const start = performance.now();
    const tick = (now: number) => {
      if (failed) return;
      const due = Math.min(dueFrame((now - start) / 1000), lastFrame);
      if (due > sent) {
        sent = due;
        renderAt(Math.min(due / CLIP_FPS, durationSec));
        track?.requestFrame();
        onProgress(Math.min(1, due / totalFrames));
      }
      if (sent >= lastFrame) {
        if (recorder.state === "recording") recorder.stop();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
}
