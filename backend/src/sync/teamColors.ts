/**
 * The EuroLeague feed gives us team codes/names but not brand colors,
 * which the app needs for the "team skin" personalization. This is a
 * fallback used only when a team is first inserted — feel free to
 * override any of these later via an admin update, they won't be
 * touched again by the sync.
 *
 * Real club colors, not a generated palette (see standings_sync.py's
 * FALLBACK_PALETTE history — that one assigned colors by sync order,
 * which is how Panathinaikos ended up purple). Most of these are
 * well-known kit colors; PRS and DUB are lower-confidence (newer/less
 * iconic branding) — worth double-checking if it matters.
 */
export const TEAM_COLORS: Record<string, { primary: string; secondary: string }> = {
  MUN: { primary: "#DC052D", secondary: "#0066B2" }, // FC Bayern Munich
  ULK: { primary: "#0C2340", secondary: "#FFD200" }, // Fenerbahce Beko Istanbul
  HTA: { primary: "#E2001A", secondary: "#111111" }, // Hapoel IBI Tel Aviv
  BAS: { primary: "#78BE20", secondary: "#111111" }, // Baskonia Vitoria-Gasteiz
  ASV: { primary: "#E31E24", secondary: "#002654" }, // LDLC ASVEL Villeurbanne
  TEL: { primary: "#FFDD00", secondary: "#003399" }, // Maccabi Rapyd Tel Aviv
  OLY: { primary: "#E31837", secondary: "#0A0A0A" }, // Olympiacos Piraeus
  PAN: { primary: "#007A33", secondary: "#012D18" }, // Panathinaikos AKTOR Athens
  PRS: { primary: "#8A1538", secondary: "#1A1A1A" }, // Paris Basketball
  PAR: { primary: "#000000", secondary: "#3A3A3A" }, // Partizan Mozzart Bet Belgrade
  MAD: { primary: "#1E3B70", secondary: "#FEBE10" }, // Real Madrid
  PAM: { primary: "#F7941E", secondary: "#12275A" }, // Valencia Basket
  VIR: { primary: "#111111", secondary: "#8C7A3D" }, // Virtus Bologna
  ZAL: { primary: "#0B8A3E", secondary: "#111111" }, // Zalgiris Kaunas
  MCO: { primary: "#C8102E", secondary: "#111111" }, // AS Monaco
  IST: { primary: "#E2231A", secondary: "#1A1A1A" }, // Anadolu Efes Istanbul
  MIL: { primary: "#0D0D0D", secondary: "#C8102E" }, // EA7 Emporio Armani Milan
  BES: { primary: "#000000", secondary: "#8C1D1D" }, // Besiktas Istanbul
  RED: { primary: "#E4022D", secondary: "#1A1A1A" }, // Crvena Zvezda Meridianbet Belgrade
  DUB: { primary: "#0A0A0A", secondary: "#C9A227" }, // Dubai Basketball
  BAR: { primary: "#004D98", secondary: "#A50044" }, // FC Barcelona
  DEFAULT: { primary: "#3E7CB1", secondary: "#0B1220" },
};

export function colorsForTeam(code: string) {
  return TEAM_COLORS[code] ?? TEAM_COLORS.DEFAULT;
}
