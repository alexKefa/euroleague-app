import { Lang } from "./lang";

export const topScorerPredictionsTranslations: Record<string, Record<Lang, string>> = {
  "topScorer.pickTitle": { en: "Top scorer pick", el: "Πρόβλεψη κορυφαίου σκόρερ" },
  "topScorer.hint": {
    en: "Pick anytime before the game ends — you can change your pick while it's live.",
    el: "Διάλεξε οποτεδήποτε πριν τελειώσει ο αγώνας — μπορείς να αλλάξεις την επιλογή σου ενώ είναι live.",
  },
  "topScorer.myPick": { en: "Your pick", el: "Η επιλογή σου" },
  "topScorer.potentialPoints": { en: "pts", el: "πόντοι" },
  "topScorer.correct": { en: "Correct!", el: "Σωστό!" },
  "topScorer.wrong": { en: "Not this time", el: "Όχι αυτή τη φορά" },
  "topScorer.unresolvedTie": {
    en: "No clear top scorer — two players tied",
    el: "Δεν υπήρξε ξεκάθαρος κορυφαίος σκόρερ — ισοπαλία",
  },
  "topScorer.pickFailed": { en: "Failed to save your pick", el: "Αποτυχία αποθήκευσης επιλογής" },
};
