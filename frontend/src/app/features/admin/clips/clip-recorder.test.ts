import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRecorderFormat } from "./clip-recorder";

test("MP4 is preferred when the browser can record it", () => {
  assert.deepEqual(pickRecorderFormat(() => true), { mime: "video/mp4;codecs=avc1", ext: "mp4" });
});

test("a WebM-only browser records WebM", () => {
  assert.deepEqual(pickRecorderFormat((m) => m.startsWith("video/webm")), { mime: "video/webm;codecs=vp9", ext: "webm" });
});

test("a browser that can't record anything gets no format", () => {
  assert.equal(pickRecorderFormat(() => false), null);
});
