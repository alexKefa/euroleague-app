// Player kit rules shared by client and server, so every screen dresses a
// player the same way.

export const DEFAULT_KIT_PRIMARY = "#FF6B35";
export const DEFAULT_KIT_SECONDARY = "#0B1220";

const DARK_LUMA_THRESHOLD = 35;

function hexLuma(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const full = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Jersey colours for a club. Mirrors ThemeService.applyTeam(): a near-black
 * primary (several clubs ship #000000) swaps with a brighter secondary.
 */
export function kitColors(primary: string | null | undefined, secondary: string | null | undefined): { primary: string; secondary: string } {
  let p = primary || DEFAULT_KIT_PRIMARY;
  let s = secondary || DEFAULT_KIT_SECONDARY;
  const pl = hexLuma(p);
  const sl = hexLuma(s);
  if (pl !== null && pl < DARK_LUMA_THRESHOLD && sl !== null && sl >= DARK_LUMA_THRESHOLD) [p, s] = [s, p];
  return { primary: p, secondary: s };
}

/** A stable 0-99 shirt number per user, until players can pick one. */
export function jerseyNumber(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return h % 100;
}
