import { Lang } from "./lang";

// Matchup preview (2026-10-09): game page card (features/game/matchup-preview.ts)
// and the compact strip in Predictions (shared/matchup-strip.ts).
export const matchupTranslations: Record<string, Record<Lang, string>> = {
  "matchup.title": { en: "Matchup preview", el: "Προϊστορία αναμέτρησης" },
  "matchup.formH2h": { en: "Form & head-to-head", el: "Φόρμα & μεταξύ τους" },
  "matchup.availability": { en: "Availability", el: "Διαθεσιμότητα" },
  "matchup.keyMatchups": { en: "Key matchups", el: "Βασικές μονομαχίες" },
  "matchup.keyBattle": { en: "Key battle", el: "Η μονομαχία της βραδιάς" },
  "matchup.streak": { en: "Streak", el: "Σερί" },
  "matchup.leads": { en: "{team} leads {a}-{b}", el: "{team} προηγείται {a}-{b}" },
  "matchup.tied": { en: "Series tied {a}-{b}", el: "Ισοπαλία {a}-{b}" },
  "matchup.firstMeeting": { en: "First meeting in two seasons", el: "Πρώτη συνάντηση τις δύο τελευταίες σεζόν" },
  "matchup.noGamesYet": { en: "No games yet this season", el: "Κανένας αγώνας ακόμα φέτος" },
  "matchup.restEdge": { en: "{team} has the rest edge", el: "{team} έχει το πλεονέκτημα ξεκούρασης" },
  "matchup.playedDaysAgo": { en: "{team} played {n} days ago", el: "{team} αγωνίστηκε πριν από {n} ημέρες" },
  "matchup.playedYesterday": { en: "{team} played yesterday", el: "{team} αγωνίστηκε χθες" },
  "matchup.bothShortRest": { en: "Both teams on short rest", el: "Και οι δύο ομάδες με λίγη ξεκούραση" },
  "matchup.fullStrength": { en: "Both teams at full strength", el: "Και οι δύο ομάδες σε πλήρη σύνθεση" },
  "matchup.noInjuries": { en: "No injuries", el: "Χωρίς τραυματίες" },
  "matchup.lastSeason": { en: "last season", el: "προηγούμενη σεζόν" },
  "matchup.fullPreview": { en: "Full preview", el: "Πλήρης προϊστορία" },
  "matchup.h2h": { en: "H2H", el: "Μ/Τ" },
  "matchup.injuredCount": { en: "Injured / doubtful", el: "Τραυματίες / αμφίβολοι" },
  "matchup.stat.offRating": { en: "Offensive rating", el: "Επιθετική απόδοση" },
  "matchup.stat.defRating": { en: "Defensive rating", el: "Αμυντική απόδοση" },
  "matchup.stat.threePct": { en: "3PT%", el: "3π%" },
  "matchup.stat.rebPg": { en: "Rebounds / game", el: "Ριμπάουντ / αγώνα" },
  "matchup.stat.astPg": { en: "Assists / game", el: "Ασίστ / αγώνα" },
  "matchup.stat.tovPg": { en: "Turnovers / game", el: "Λάθη / αγώνα" },
  // Duel stat labels reuse game.colPTS / colREB / colAST / colPIR.
};
