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

/**
 * Plays the clip from 0 to `durationSec` (calling `renderAt` every animation
 * frame) while recording the canvas at 30 fps. Rejects with ClipHiddenError
 * if the tab is hidden mid-recording.
 */
export function recordClip(
  canvas: HTMLCanvasElement,
  durationSec: number,
  renderAt: (time: number) => void,
  onProgress: (fraction: number) => void
): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  const format = typeof MediaRecorder === "undefined" ? null : pickRecorderFormat((m) => MediaRecorder.isTypeSupported(m));
  if (!format) return Promise.reject(new Error("Recording is not supported in this browser"));

  return new Promise((resolve, reject) => {
    renderAt(0); // the first captured frame is the clip's first frame
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    let frame = 0;
    let failed: Error | null = null;

    const cleanup = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      stream.getTracks().forEach((t) => t.stop());
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && recorder.state === "recording") {
        failed = new ClipHiddenError("The tab was hidden while recording");
        recorder.stop();
      }
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
    recorder.start();
    const start = performance.now();
    const tick = (now: number) => {
      const time = (now - start) / 1000;
      renderAt(Math.min(time, durationSec));
      onProgress(Math.min(1, time / durationSec));
      // A little past the end so the held last frame makes it into the file.
      if (time >= durationSec + 0.2) {
        if (recorder.state === "recording") recorder.stop();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
}
