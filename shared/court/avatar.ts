// A player's look on the court (the Locker room), shared by client and
// server. Stored as JSON on users.avatar and sent to everyone on a court as
// a compact string in CourtPlayer.avatar. Players who never customised get
// defaultAvatar(), which matches the look they always had.

export const SKIN_TONE_COUNT = 5;
export const HAIR_COLOR_COUNT = 6;
export const HAIR_STYLES = ["short", "buzz", "top", "bald"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export interface AvatarLook {
  /** 0..SKIN_TONE_COUNT-1, light to dark. */
  skin: number;
  hair: HairStyle;
  /** 0..HAIR_COLOR_COUNT-1. */
  hairColor: number;
  beard: boolean;
  /** Shirt number, 0-99. */
  number: number;
}

/** The auto look from a shirt number (what every player had before the Locker room). */
export function defaultAvatar(number: number): AvatarLook {
  const n = Math.max(0, Math.floor(number)) % 100;
  const autoStyles: HairStyle[] = ["short", "buzz", "top", "short", "bald", "buzz"];
  return {
    skin: n % SKIN_TONE_COUNT,
    hair: autoStyles[(n * 5 + 1) % autoStyles.length]!,
    hairColor: (n * 7 + 3) % HAIR_COLOR_COUNT,
    beard: (n * 3) % 5 < 2,
    number: n,
  };
}

function intIn(v: unknown, max: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < max ? v : null;
}

/** A validated look from untrusted input (request body, DB row), or null if anything is off. */
export function parseAvatar(raw: unknown): AvatarLook | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const skin = intIn(o["skin"], SKIN_TONE_COUNT);
  const hairColor = intIn(o["hairColor"], HAIR_COLOR_COUNT);
  const number = intIn(o["number"], 100);
  const hair = HAIR_STYLES.find((h) => h === o["hair"]);
  if (skin === null || hairColor === null || number === null || !hair || typeof o["beard"] !== "boolean") return null;
  return { skin, hair, hairColor, beard: o["beard"], number };
}

/** Compact wire form for the room state, e.g. "2.top.3.1.23". */
export function encodeAvatar(a: AvatarLook): string {
  return [a.skin, a.hair, a.hairColor, a.beard ? 1 : 0, a.number].join(".");
}

/** Inverse of encodeAvatar; null for "" or anything malformed. */
export function decodeAvatar(s: string | null | undefined): AvatarLook | null {
  if (!s) return null;
  const [skin, hair, hairColor, beard, number] = s.split(".");
  return parseAvatar({ skin: Number(skin), hair, hairColor: Number(hairColor), beard: beard === "1" ? true : beard === "0" ? false : null, number: Number(number) });
}
