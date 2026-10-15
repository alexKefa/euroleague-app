// Round clips: shrink a line of text until it fits its box (long Greek
// names like "Ο Μοναχικός Λύκος του Βελιγραδίου" must never run off the
// canvas). Angular-free so it can be tested under tsx.

/** The largest size ≤ startPx whose measured width fits maxWidth, but never below minPx. */
export function fitFontSize(measure: (px: number) => number, maxWidth: number, startPx: number, minPx: number): number {
  let px = startPx;
  while (px > minPx && measure(px) > maxWidth) px -= 2;
  return Math.max(px, minPx);
}
