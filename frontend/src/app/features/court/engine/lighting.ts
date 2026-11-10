// Time-of-day lighting for the court (pure: no three.js, so it's unit-tested).
// Keyframes through the day are blended by hour; "auto" follows the device's
// clock, the other modes pin a time so the look can be picked by hand.

export const TIME_MODES = ["auto", "day", "sunset", "night"] as const;
export type TimeMode = (typeof TIME_MODES)[number];

export interface Lighting {
  /** 0 = night .. 1 = full day. Drives LED brightness and the floodlights. */
  day: number;
  skyTop: string;
  skyHorizon: string;
  sunColor: string;
  sunIntensity: number;
  /** Unit vector towards the sun (or the moon at night). */
  sunDir: { x: number; y: number; z: number };
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  floodlights: boolean;
}

interface Key {
  h: number;
  day: number;
  skyTop: string;
  skyHorizon: string;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
}

// Night is floodlit: the hemisphere light stays strong and neutral so players
// read clearly, while the sky goes dark and the LED floor carries the scene.
const NIGHT: Omit<Key, "h"> = {
  day: 0,
  skyTop: "#04060d",
  skyHorizon: "#121a2c",
  sunColor: "#9fb3d9",
  sunIntensity: 0.45,
  hemiSky: "#c9d3ea",
  hemiGround: "#1a1f28",
  hemiIntensity: 1.05,
};
const DAY: Omit<Key, "h"> = {
  day: 1,
  skyTop: "#6fa8dc",
  skyHorizon: "#cfe4f5",
  sunColor: "#fff3dc",
  sunIntensity: 2.2,
  hemiSky: "#e4f1ff",
  hemiGround: "#5a6b45",
  hemiIntensity: 1.6,
};
const KEYS: Key[] = [
  { h: 0, ...NIGHT },
  { h: 5.5, ...NIGHT, skyHorizon: "#1b2236" },
  { h: 6.5, day: 0.35, skyTop: "#3b4f7a", skyHorizon: "#f2a477", sunColor: "#ffb27a", sunIntensity: 1.3, hemiSky: "#c9cfe0", hemiGround: "#4a4a40", hemiIntensity: 1.0 },
  { h: 8.5, ...DAY },
  { h: 16.5, ...DAY },
  { h: 18.5, day: 0.7, skyTop: "#5a86c0", skyHorizon: "#ffc58a", sunColor: "#ffc07a", sunIntensity: 1.8, hemiSky: "#ffe2c4", hemiGround: "#5a5540", hemiIntensity: 1.3 },
  { h: 19.6, day: 0.4, skyTop: "#3a4a7e", skyHorizon: "#ff8a5c", sunColor: "#ff7a45", sunIntensity: 1.1, hemiSky: "#e8b8a8", hemiGround: "#3a3530", hemiIntensity: 1.0 },
  { h: 20.6, day: 0.12, skyTop: "#141c38", skyHorizon: "#5a3f5e", sunColor: "#c08aa0", sunIntensity: 0.6, hemiSky: "#b8b6d4", hemiGround: "#22222a", hemiIntensity: 1.0 },
  { h: 21.5, ...NIGHT },
  { h: 24, ...NIGHT },
];

const SUNRISE = 6.5;
const SUNSET = 20;

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const out = [16, 8, 0].map((s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function lightingFor(hour: number): Lighting {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.h <= h) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  const num = (x: number, y: number) => x + (y - x) * t;

  // The sun rises in +x, sets in -x and arcs overhead; at night a low moon.
  const dayArc = h > SUNRISE && h < SUNSET ? Math.sin((Math.PI * (h - SUNRISE)) / (SUNSET - SUNRISE)) : 0;
  const az = h > SUNRISE && h < SUNSET ? (Math.PI * (h - SUNRISE)) / (SUNSET - SUNRISE) : Math.PI * 0.35;
  const y = Math.max(0.12, dayArc * 0.95);
  const flat = Math.sqrt(1 - y * y);
  // Horizontal heading: east-west with a little towards +z (behind the usual camera), unit length.
  const hx = Math.cos(az) * 0.92;
  const hz = 0.39;
  const hl = Math.hypot(hx, hz);

  const day = num(a.day, b.day);
  return {
    day,
    skyTop: mixHex(a.skyTop, b.skyTop, t),
    skyHorizon: mixHex(a.skyHorizon, b.skyHorizon, t),
    sunColor: mixHex(a.sunColor, b.sunColor, t),
    sunIntensity: num(a.sunIntensity, b.sunIntensity),
    sunDir: { x: (hx / hl) * flat, y, z: (hz / hl) * flat },
    hemiSky: mixHex(a.hemiSky, b.hemiSky, t),
    hemiGround: mixHex(a.hemiGround, b.hemiGround, t),
    hemiIntensity: num(a.hemiIntensity, b.hemiIntensity),
    floodlights: day < 0.3,
  };
}

/** The hour to light the court for: the device clock in "auto", else a fixed time. */
export function resolveHour(mode: TimeMode, now: Date = new Date()): number {
  switch (mode) {
    case "day":
      return 13;
    case "sunset":
      return 19.4;
    case "night":
      return 22.5;
    default:
      return now.getHours() + now.getMinutes() / 60;
  }
}

export function nextTimeMode(mode: TimeMode): TimeMode {
  return TIME_MODES[(TIME_MODES.indexOf(mode) + 1) % TIME_MODES.length]!;
}
