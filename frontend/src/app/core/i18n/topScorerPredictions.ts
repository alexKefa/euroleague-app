import { Lang } from "./lang";

export const topScorerPredictionsTranslations: Record<string, Record<Lang, string>> = {
  "topScorer.pickTitle": { en: "Top scorer pick", el: "Πρόβλεψη κορυφαίου σκόρερ" },
  "topScorer.hint": {
    en: "Pick anytime before the 4th quarter starts — you can change your pick while it's live.",
    el: "Διάλεξε οποτεδήποτε πριν ξεκινήσει το 4ο δεκάλεπτο — μπορείς να αλλάξεις την επιλογή σου ενώ είναι live.",
  },
  "topScorer.locked": {
    en: "Picks are locked — the 4th quarter has started.",
    el: "Οι επιλογές κλείδωσαν — το 4ο δεκάλεπτο ξεκίνησε.",
  },
  "topScorer.myPick": { en: "Your pick", el: "Η επιλογή σου" },
  "topScorer.correct": { en: "Correct!", el: "Σωστό!" },
  "topScorer.wrong": { en: "Not this time", el: "Όχι αυτή τη φορά" },
  "topScorer.unresolvedTie": {
    en: "No clear top scorer — two players tied",
    el: "Δεν υπήρξε ξεκάθαρος κορυφαίος σκόρερ — ισοπαλία",
  },
  "topScorer.pickFailed": { en: "Failed to save your pick", el: "Αποτυχία αποθήκευσης επιλογής" },
  // Shown under each candidate in the picker (2026-09-22, "it's hard to
  // pick informed, show PPG" — the list was already sorted by season PPG,
  // just never displayed it).
  "topScorer.ppgAbbrev": { en: "PPG", el: "ΠΟΝ" },

  // Picked-state strip, reset, and how-to copy (2026-09-30).
  "topScorer.yourTopScorer": { en: "Your top scorer", el: "Ο σκόρερ σου" },
  "topScorer.change": { en: "Change", el: "Αλλαγή" },
  "topScorer.remove": { en: "Remove", el: "Αφαίρεση" },
  "topScorer.whoScoresMost": { en: "Top scorer", el: "Κορυφαίος σκόρερ" },
  "topScorer.seeAllPlayers": { en: "All players", el: "Όλοι οι παίκτες" },
  "topScorer.pickerHowTo": {
    en: "Tap the player you think will score the most. Lower scorers are worth more points. Tap them again to remove. You can change it until the 4th quarter starts.",
    el: "Πάτησε τον παίκτη που πιστεύεις ότι θα σκοράρει περισσότερο. Όσοι έχουν χαμηλότερο μέσο όρο δίνουν περισσότερους πόντους. Πάτησε ξανά για αφαίρεση. Μπορείς να την αλλάξεις μέχρι να ξεκινήσει το 4ο δεκάλεπτο.",
  },
};
