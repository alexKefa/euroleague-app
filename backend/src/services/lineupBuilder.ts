// Lineup builder (2026-10-09): how any 2-5 players did together this
// season, how the team did otherwise, and which teammate makes the group
// best. Built from lineup_stints in one statement (latency here is round
// trips). Spec: docs/superpowers/specs/2026-10-09-lineup-builder-design.md

export interface LineupSums {
  seconds: number;
  games: number;
  ptsFor: number;
  ptsAgainst: number;
  possFor: number;
  possAgainst: number;
}

export interface LineupPartner extends LineupSums {
  player: { id: string | null; code: string; name: string | null; photoUrl: string | null };
}

export interface LineupBuilderResult {
  season: string;
  together: LineupSums;
  otherwise: LineupSums;
  partners: LineupPartner[];
}

const CODE_RE = /^[A-Za-z0-9]{1,20}$/;
const MIN_PICK = 2;
const MAX_PICK = 5;

/** `?players=` → sorted, deduped codes, or null unless 2-5 well-formed codes. */
export function normalizePlayerCodes(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.some((p) => !CODE_RE.test(p))) return null;
  const codes = [...new Set(parts)].sort((a, b) => a.localeCompare(b));
  return codes.length >= MIN_PICK && codes.length <= MAX_PICK ? codes : null;
}
