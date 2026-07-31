/**
 * The EuroLeague feed gives us team codes/names but not brand colors,
 * which the app needs for the "team skin" personalization. This is a
 * fallback used only when a team is first inserted — feel free to
 * override any of these later via an admin update, they won't be
 * touched again by the sync.
 */
export const TEAM_COLORS: Record<string, { primary: string; secondary: string }> = {
  OLY: { primary: "#DA1A32", secondary: "#111111" }, // Olympiacos
  VAL: { primary: "#F7941E", secondary: "#12275A" }, // Valencia Basket
  MAD: { primary: "#1E3B70", secondary: "#FEBE10" }, // Real Madrid
  FEN: { primary: "#10275A", secondary: "#FEDD00" }, // Fenerbahce Beko
  ZAL: { primary: "#0B8A3E", secondary: "#111111" }, // Zalgiris
  PAN: { primary: "#007A3D", secondary: "#111111" }, // Panathinaikos
  MCO: { primary: "#C8102E", secondary: "#111111" }, // AS Monaco
  BAR: { primary: "#004D98", secondary: "#A50044" }, // FC Barcelona
  DEFAULT: { primary: "#3E7CB1", secondary: "#0B1220" },
};

export function colorsForTeam(code: string) {
  return TEAM_COLORS[code] ?? TEAM_COLORS.DEFAULT;
}
