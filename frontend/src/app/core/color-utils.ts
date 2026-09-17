// Standard luma weights, 0-255. Returns null for anything that isn't a
// plain "#rgb"/"#rrggbb" hex string (every real team color is, but colors
// are fed straight from the DB, not validated at the schema level) so a
// caller can fall back to using the color as-is. Shared between
// landing.ts's own-team preview swatch and ThemeService's app-wide accent
// substitution — both need the same "is this color dark enough to risk
// disappearing" check, just for different UI (a one-off demo swatch vs.
// the persistent --accent-primary every reskinned element reads).
export function hexLuma(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const full = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
