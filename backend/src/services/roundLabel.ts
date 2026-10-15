/**
 * Display name for a round number, for push notifications — mirrors the
 * frontend's shared/round-label.ts (see that file for the numbering). The
 * feed numbers the postseason as rounds after the 38 regular-season ones.
 */
export const REGULAR_SEASON_ROUNDS = 38;

export function roundLabel(round: number, lang: "en" | "el"): string {
  const after = round - REGULAR_SEASON_ROUNDS;
  const el = lang === "el";
  if (after <= 0) return el ? `Αγωνιστική ${round}` : `Round ${round}`;
  if (after <= 2) return el ? "Πλέι-ιν" : "Play-in";
  if (after <= 7) return el ? `Πλέι οφ · Αγώνας ${after - 2}` : `Playoffs · Game ${after - 2}`;
  if (after === 8) return el ? "Φάιναλ Φορ · Ημιτελικοί" : "Final Four · Semifinals";
  return el ? "Φάιναλ Φορ · Τελικός" : "Final Four · Final";
}
