/**
 * The EuroLeague feed gives us team codes/names but not brand colors,
 * which the app needs for the "team skin" personalization. This is a
 * fallback used only when a team is first inserted — feel free to
 * override any of these later via an admin update, they won't be
 * touched again by the sync.
 *
 * Real club colors, not a generated palette (see standings_sync.py's
 * FALLBACK_PALETTE history — that one assigned colors by sync order,
 * which is how Panathinaikos ended up purple). Originally picked as
 * subtle theme-accent colors (glows, borders, translucent overlays), which
 * is why several were noticeably off once 2026-09-02's player/collectible
 * jersey redesign started rendering them as solid, literal team colors —
 * re-checked against teamcolorcodes.com and corrected that day (most
 * consequentially BAS, which had been solid green from a 2010-2016 kit era
 * rather than the club's actual red/navy, and MAD/DUB, both of whose real
 * primary is white with a colored trim rather than the solid dark tone
 * used before). PRS and DUB are still the lowest-confidence entries
 * (newer/less iconic branding) — worth double-checking if it matters.
 */
export const TEAM_COLORS: Record<string, { primary: string; secondary: string }> = {
  MUN: { primary: "#DC052D", secondary: "#0066B2" }, // FC Bayern Munich
  ULK: { primary: "#0C2340", secondary: "#FFD200" }, // Fenerbahce Beko Istanbul
  HTA: { primary: "#E2001A", secondary: "#FFFFFF" }, // Hapoel IBI Tel Aviv
  BAS: { primary: "#CF152D", secondary: "#0B2240" }, // Baskonia Vitoria-Gasteiz — actual club colors are red/navy, not green (checked 2026-09-02: the green was a ~2010-2016 kit era, teamcolorcodes.com lists red #CF152D/navy #0B2240 as current)
  ASV: { primary: "#E31E24", secondary: "#002654" }, // LDLC ASVEL Villeurbanne
  TEL: { primary: "#FFDD00", secondary: "#003399" }, // Maccabi Rapyd Tel Aviv
  OLY: { primary: "#D0061F", secondary: "#FFFFFF" }, // Olympiacos Piraeus
  PAN: { primary: "#007841", secondary: "#FFFFFF" }, // Panathinaikos AKTOR Athens
  PRS: { primary: "#000000", secondary: "#FFFFFF" }, // Paris Basketball
  PAR: { primary: "#000000", secondary: "#FFFFFF" }, // Partizan Mozzart Bet Belgrade
  MAD: { primary: "#FFFFFF", secondary: "#00529F" }, // Real Madrid — actual kit is white ("Los Blancos"), not navy; navy/blue is the trim color
  PAM: { primary: "#F7941E", secondary: "#12275A" }, // Valencia Basket
  VIR: { primary: "#000000", secondary: "#FFFFFF" }, // Virtus Bologna — "Vu Nere" (the blacks), black/white
  ZAL: { primary: "#146734", secondary: "#FFFFFF" }, // Zalgiris Kaunas
  MCO: { primary: "#C8102E", secondary: "#111111" }, // AS Monaco — not in the 2026-27 competition, left as-is
  IST: { primary: "#D73430", secondary: "#213557" }, // Anadolu Efes Istanbul
  MIL: { primary: "#0D0D0D", secondary: "#C8102E" }, // EA7 Emporio Armani Milan
  BES: { primary: "#000000", secondary: "#FFFFFF" }, // Besiktas Istanbul
  RED: { primary: "#EB1926", secondary: "#FFFFFF" }, // Crvena Zvezda Meridianbet Belgrade
  DUB: { primary: "#FFFFFF", secondary: "#0A0A0A" }, // Dubai Basketball — home kit is white with black/gold trim
  BAR: { primary: "#004D98", secondary: "#A50044" }, // FC Barcelona
  DEFAULT: { primary: "#3E7CB1", secondary: "#0B1220" },
};

export function colorsForTeam(code: string) {
  return TEAM_COLORS[code] ?? TEAM_COLORS.DEFAULT;
}
