// Home-kit looks per club, keyed by the display code on the chest
// (team-display-codes.ts). These are approximations of each club's identity
// (colours and signature pattern: Barça's blaugrana stripes, Partizan's
// black-and-white stripes, Fenerbahçe's pinstripes...),
// not reproductions of any season's actual kit. Clubs missing here fall back
// to their app theme colours with plain side panels.

export type KitPattern =
  /** Wide vertical stripes. */
  | "stripes"
  /** Thin vertical pinstripes. */
  | "pinstripes"
  /** Diagonal split, shoulder to hip. */
  | "diagonal"
  /** Contrasting panels down both sides. */
  | "panels";

export interface KitStyle {
  /** Jersey base colour. */
  body: string;
  /** Collar / armhole piping and shorts trim. */
  trim: string;
  pattern: KitPattern;
  /** Pattern colour (defaults to the trim). */
  patternColor?: string;
  /** Number / name colour and its outline (default: picked for contrast). */
  ink?: string;
  outline?: string;
  /** Shorts colour (default: the body). */
  shorts?: string;
  /** Sneaker colour (default: the trim, or the body when the trim is white). */
  shoe?: string;
}

export const KIT_STYLES: Record<string, KitStyle> = {
  OLY: { body: "#c8102e", trim: "#ffffff", pattern: "panels", ink: "#ffffff", outline: "#8a0a1f" },
  PAO: { body: "#007a3d", trim: "#ffffff", pattern: "panels", ink: "#ffffff", outline: "#004d26" },
  RMB: { body: "#ffffff", trim: "#3f2d7c", pattern: "panels", patternColor: "#3f2d7c", ink: "#3f2d7c", outline: "#c9a227", shoe: "#3f2d7c" },
  BAR: { body: "#0b4ea2", trim: "#edbb00", pattern: "stripes", patternColor: "#a50044", ink: "#edbb00", outline: "#0a1f44", shorts: "#0b4ea2" },
  FBT: { body: "#0b2d6b", trim: "#ffe600", pattern: "pinstripes", patternColor: "#ffe600", ink: "#ffffff", outline: "#0b2d6b" },
  EFS: { body: "#0a2a5e", trim: "#ffffff", pattern: "panels", patternColor: "#5fb3e6", ink: "#ffffff", outline: "#061a3b" },
  CZV: { body: "#d2232a", trim: "#ffffff", pattern: "stripes", patternColor: "#ffffff", ink: "#ffffff", outline: "#1d2f6f", shorts: "#d2232a" },
  PAR: { body: "#111111", trim: "#ffffff", pattern: "stripes", patternColor: "#f4f4f4", ink: "#ffffff", outline: "#111111", shorts: "#111111" },
  BJK: { body: "#111111", trim: "#ffffff", pattern: "stripes", patternColor: "#f4f4f4", ink: "#ffffff", outline: "#111111", shorts: "#111111" },
  MTA: { body: "#ffd100", trim: "#003d8f", pattern: "panels", ink: "#003d8f", outline: "#ffffff" },
  ZAL: { body: "#00703c", trim: "#ffffff", pattern: "panels", ink: "#ffffff", outline: "#00431f" },
  BAY: { body: "#dc052d", trim: "#ffffff", pattern: "panels", patternColor: "#0f1c3f", ink: "#ffffff", outline: "#0f1c3f" },
  MIL: { body: "#ffffff", trim: "#d2001f", pattern: "panels", ink: "#d2001f", outline: "#ffffff", shoe: "#d2001f" },
  VIR: { body: "#111111", trim: "#ffffff", pattern: "panels", patternColor: "#ffffff", ink: "#ffffff", outline: "#111111" },
  KBA: { body: "#1b3e8a", trim: "#d4213d", pattern: "panels", ink: "#ffffff", outline: "#d4213d" },
  PBB: { body: "#111111", trim: "#ffffff", pattern: "panels", patternColor: "#e8e8e8", ink: "#ffffff", outline: "#111111" },
  VBC: { body: "#f26b1d", trim: "#111111", pattern: "panels", ink: "#111111", outline: "#ffffff" },
  HTA: { body: "#e30613", trim: "#ffffff", pattern: "panels", ink: "#ffffff", outline: "#8f040c" },
};

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1]!, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Everything resolved: what the rig and the jersey painter use. */
export interface Kit {
  body: string;
  trim: string;
  pattern: KitPattern;
  patternColor: string;
  ink: string;
  outline: string;
  shorts: string;
  shoe: string;
}

/** Lettering colour: the trim when it clearly reads on the jersey, else white/black. */
function letteringColor(body: string, trim: string): string {
  if (contrast(body, trim) >= 3) return trim;
  return contrast(body, "#ffffff") >= contrast(body, "#111111") ? "#ffffff" : "#111111";
}

/** Outline: whichever of body/trim/black/white contrasts most with the lettering. */
function outlineColor(ink: string, body: string, trim: string): string {
  const options = [body, trim, "#111111", "#ffffff"].filter((c) => c.toLowerCase() !== ink.toLowerCase());
  return options.reduce((best, c) => (contrast(ink, c) > contrast(ink, best) ? c : best), options[0]!);
}

/** The kit for a club code, or one built from the theme colours. */
export function resolveKit(code: string, primary: string, secondary: string): Kit {
  const s: KitStyle = KIT_STYLES[code.toUpperCase()] ?? { body: primary, trim: secondary, pattern: "panels" };
  const ink = s.ink ?? letteringColor(s.body, s.trim);
  return {
    body: s.body,
    trim: s.trim,
    pattern: s.pattern,
    patternColor: s.patternColor ?? s.trim,
    ink,
    outline: s.outline ?? outlineColor(ink, s.body, s.trim),
    shorts: s.shorts ?? s.body,
    shoe: s.shoe ?? (luminance(s.trim) > 0.75 ? s.body : s.trim),
  };
}
