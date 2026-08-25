import { Lang } from "./lang";

// Dashboard hero + widget section labels. Stat abbreviations (PPG, PIR,
// PTS/REB/AST/STL/BLK) are left untranslated — they're internationally
// recognized short-codes, same treatment as team codes.
export const dashboardTranslations: Record<string, Record<Lang, string>> = {
  "dashboard.yourTeam": { en: "Your team", el: "Η ομάδα σου" },
  "dashboard.record": { en: "Record", el: "Ρεκόρ" },
  "dashboard.rank": { en: "Rank", el: "Θέση" },
  "dashboard.next": { en: "Next", el: "Επόμενο" },
  "dashboard.latest": { en: "Latest", el: "Τελευταία" },
  "dashboard.viewAll": { en: "ALL", el: "ΟΛΑ" },
  "dashboard.round": { en: "Round", el: "Αγωνιστική" },
  "dashboard.topPerformances": { en: "Top Performances", el: "Κορυφαίες Εμφανίσεις" },
  "dashboard.leaders": { en: "Leaders", el: "Κορυφαίοι" },
  "dashboard.yourTeamSchedule": { en: "Your Team's Schedule", el: "Πρόγραμμα Ομάδας" },
  "dashboard.standings": { en: "Standings", el: "Βαθμολογία" },

  "dashboard.pointsHintPrefix": { en: "Earn points by making correct predictions on", el: "Κέρδισε πόντους με σωστές προβλέψεις στις" },
  "dashboard.pointsHintMiddle": { en: ", then spend them on", el: ", και μετά εξαργύρωσέ τις σε" },
  "dashboard.pointsHintSuffix": {
    en: "for a shot at rare and legendary cards — or try the free daily",
    el: "για μια ευκαιρία σε σπάνιες και θρυλικές κάρτες — ή δοκίμασε το δωρεάν καθημερινό",
  },

  "dashboard.welcomeBonusPrefix": {
    en: "New accounts start with a 100-point welcome bonus — head to",
    el: "Οι νέοι λογαριασμοί ξεκινούν με δώρο 100 πόντων — πήγαινε στις",
  },
  "dashboard.welcomeBonusSuffix": {
    en: "to open your first pack.",
    el: "για να ανοίξεις το πρώτο σου πακέτο.",
  },

  "dashboard.guestHintPrefix": {
    en: "Predict games, earn points, and collect cards —",
    el: "Πρόβλεψε αγώνες, κέρδισε πόντους και σύλλεξε κάρτες —",
  },
  "dashboard.guestHintCta": { en: "create a free account", el: "δημιούργησε δωρεάν λογαριασμό" },
  "dashboard.guestHintSuffix": { en: "to get started — takes a minute.", el: "για να ξεκινήσεις — παίρνει ένα λεπτό." },

  "dashboard.topPredictors": { en: "Top Predictors", el: "Κορυφαίοι στις Προβλέψεις" },
};
