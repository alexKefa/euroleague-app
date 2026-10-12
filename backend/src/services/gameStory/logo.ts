// Game story cards (2026-10-09): team logos and colours for the card.
// Logos are only embedded when the bytes really are an image satori can
// decode (sniffed, not trusted from the content-type): a CDN error page
// served as image/png would otherwise make every card for that team fail.
import type { TeamFacts } from "./types.js";

const ORANGE = "#FF6B35";

/** A data URI for real PNG/JPEG/SVG bytes, else null (the card draws a circle). */
export function logoDataUriFromBytes(_contentType: string, bytes: Buffer): string | null {
  const b64 = () => bytes.toString("base64");
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return `data:image/png;base64,${b64()}`;
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return `data:image/jpeg;base64,${b64()}`;
  }
  const head = bytes.subarray(0, 2048).toString("utf8");
  // satori needs a viewBox to size an SVG.
  if (/<svg[\s>]/i.test(head) && /viewBox\s*=/i.test(head)) return `data:image/svg+xml;base64,${b64()}`;
  return null;
}

// url -> { uri, until }. A failure is retried after LOGO_RETRY_MS instead
// of sticking until the process restarts.
const LOGO_RETRY_MS = 10 * 60_000;
const logoCache = new Map<string, { uri: string | null; until: number }>();

export async function logoDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  const hit = logoCache.get(url);
  if (hit && (hit.uri !== null || hit.until > Date.now())) return hit.uri;
  let uri: string | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) uri = logoDataUriFromBytes(res.headers.get("content-type") ?? "", Buffer.from(await res.arrayBuffer()));
  } catch {
    uri = null;
  }
  logoCache.set(url, { uri, until: Date.now() + LOGO_RETRY_MS });
  return uri;
}

/** Forget a logo that satori couldn't render after all. */
export function forgetLogo(url: string | null): void {
  if (url) logoCache.set(url, { uri: null, until: Date.now() + LOGO_RETRY_MS });
}

function luma(hex: string | null): number | null {
  const m = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/** Text on top of a solid team colour: ink on light colours, white on dark ones. */
export function inkOn(color: string): string {
  return (luma(color) ?? 0) > 150 ? "#0B0C0F" : "#FFFFFF";
}

/**
 * A team colour that stands out on the card's near-black ground (2026-10-12
 * redesign): the primary, else the secondary, else the primary lifted
 * towards white, else the app orange. Near-white counts as too plain.
 */
export function accentOnDark(team: Pick<TeamFacts, "primaryColor" | "secondaryColor">): string {
  const ok = (c: string | null) => {
    const l = luma(c);
    return l !== null && l >= 70 && l <= 235;
  };
  if (ok(team.primaryColor)) return team.primaryColor!;
  if (ok(team.secondaryColor)) return team.secondaryColor!;
  const m = team.primaryColor ? /^#?([0-9a-f]{6})$/i.exec(team.primaryColor.trim()) : null;
  if (m) {
    const n = parseInt(m[1], 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    // Only a real hue is worth lifting; greys and black get the orange.
    if (Math.max(...rgb) - Math.min(...rgb) >= 40) {
      const lift = rgb.map((v) => Math.round(v + (255 - v) * 0.45));
      return `#${lift.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return ORANGE;
}

/** A team colour readable on white: too light or too dark falls back. */
export function accentFor(team: Pick<TeamFacts, "primaryColor" | "secondaryColor">): string {
  const ok = (c: string | null) => {
    const l = luma(c);
    return l !== null && l >= 35 && l <= 200;
  };
  if (ok(team.primaryColor)) return team.primaryColor!;
  if (ok(team.secondaryColor)) return team.secondaryColor!;
  return ORANGE;
}
