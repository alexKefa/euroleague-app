import { Lang } from "./lang";

export const predictionsTranslations: Record<string, Record<Lang, string>> = {
  "predictions.spendPoints": { en: "Spend points", el: "Ξόδεψε πόντους" },
  "predictions.upcomingGames": { en: "Upcoming games", el: "Επερχόμενοι αγώνες" },
  "predictions.vs": { en: "vs", el: "vs" },
  "predictions.tapToClearHint": {
    en: "Tap your pick again to remove it.",
    el: "Πάτησε ξανά την επιλογή σου για να την αφαιρέσεις.",
  },
  "predictions.myPicks": { en: "My picks", el: "Οι προγνώσεις μου" },
  "predictions.loginPromptSuffix": {
    en: "to make predictions and track your accuracy.",
    el: "για να κάνεις προγνωστικά και να παρακολουθείς την ακρίβειά σου.",
  },
  "predictions.perfectRoundPrefix": { en: "Perfect round! You won", el: "Τέλειος γύρος! Κέρδισες" },
  "predictions.perfectRoundSuffix": { en: "— check your", el: "— δες τη" },
  "predictions.collection": { en: "collection", el: "συλλογή σου" },
  "predictions.legendaryCards": { en: "legendary cards", el: "θρυλικές κάρτες" },
  "predictions.pts": { en: "pts", el: "πόντοι" },
  "predictions.noBadgesYet": { en: "No badges yet", el: "Δεν υπάρχουν μετάλλια ακόμα" },
  "predictions.pending": { en: "Pending", el: "Εκκρεμεί" },
  "predictions.correct": { en: "Correct", el: "Σωστό" },
  "predictions.wrong": { en: "Wrong", el: "Λάθος" },
  "predictions.noPredictionsYet": {
    en: "No predictions yet — pick a winner from any team's upcoming games list.",
    el: "Δεν υπάρχουν προγνωστικά ακόμα — διάλεξε νικητή από τη λίστα επερχόμενων αγώνων μιας ομάδας.",
  },
  "predictions.leaderboard": { en: "Leaderboard", el: "Κατάταξη" },
  "predictions.noResolvedYet": {
    en: "No resolved predictions yet.",
    el: "Δεν υπάρχουν ολοκληρωμένα προγνωστικά ακόμα.",
  },

  "predictions.hint": {
    en: "Pick a winner before tip-off. Each correct call earns 10 points, and a perfect round unlocks badges plus a bonus card.",
    el: "Διάλεξε νικητή πριν το τζάμπολ. Κάθε σωστή πρόγνωση φέρνει 10 πόντους, και ένας τέλειος γύρος ξεκλειδώνει μετάλλια και μια δωρεάν κάρτα.",
  },
};
