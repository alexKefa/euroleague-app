import { test } from "node:test";
import assert from "node:assert/strict";
import { fitFontSize } from "./clip-fit";

// Text 10 px wide per px of font size.
const measure = (px: number) => px * 10;

test("text shrinks until it fits the box", () => {
  assert.equal(fitFontSize(measure, 960, 150, 40), 96);
});

test("text never shrinks below the floor", () => {
  assert.equal(fitFontSize(measure, 300, 150, 40), 40);
});

test("text that already fits keeps its size", () => {
  assert.equal(fitFontSize(measure, 2000, 150, 40), 150);
});
