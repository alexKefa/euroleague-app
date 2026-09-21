import { Lang } from "./lang";

// Dashboard hero + widget section labels. Stat abbreviations (PPG, PIR,
// PTS/REB/AST/STL/BLK) are left untranslated — they're internationally
// recognized short-codes, same treatment as team codes.
export const dashboardTranslations: Record<string, Record<Lang, string>> = {
  "dashboard.yourTeam": { en: "Your team", el: "Η ομάδα σου" },
  "dashboard.record": { en: "Record", el: "Ρεκόρ" },
  "dashboard.rank": { en: "Rank", el: "Θέση" },
  "dashboard.next": { en: "Next", el: "Επόμενο" },
  "dashboard.form": { en: "Form", el: "Φόρμα" },
  "dashboard.latest": { en: "Latest", el: "Τελευταία" },
  "dashboard.viewAll": { en: "ALL", el: "ΟΛΑ" },
  "dashboard.round": { en: "Round", el: "Αγωνιστική" },
  "dashboard.topPerformances": { en: "Top Performances", el: "Κορυφαίες Εμφανίσεις" },
  "dashboard.leaders": { en: "Leaders", el: "Κορυφαίοι" },
  "dashboard.yourTeamSchedule": { en: "Your Team's Schedule", el: "Πρόγραμμα Ομάδας" },
  "dashboard.standings": { en: "Standings", el: "Βαθμολογία" },
  "dashboard.myLeagues": { en: "My Leagues", el: "Οι Λίγκες μου" },
  "dashboard.leaguesEmptyHint": {
    en: "Create a private league and compete with friends.",
    el: "Δημιούργησε μια ιδιωτική λίγκα και παίξε με τους φίλους σου.",
  },

  // Consolidated (2026-09-13) — this used to be two separate stacked
  // hints (a welcome-bonus one and a points/economy one), which read as
  // clutter/nagging right after the next-game card rather than a single
  // clear orientation. Merged into one, and fixed a real bug in the
  // process: the old welcome-bonus copy said "100-point", stale since the
  // 2026-08-25 repricing pass bumped it to 150 (backend/src/routes/
  // auth.ts's WELCOME_BONUS_POINTS) — never updated here.
  "dashboard.economyHintPrefix": { en: "Predict games on", el: "Πρόβλεψε αγώνες στις" },
  "dashboard.economyHintMiddle1": { en: "to earn points, then spend them on", el: ", και μετά εξαργύρωσέ τους σε" },
  "dashboard.economyHintMiddle2": {
    en: "or the free daily",
    el: "ή στο δωρεάν καθημερινό",
  },
  "dashboard.economyHintMiddle3": {
    en: "for a shot at rare and legendary cards. New accounts also start with free Welcome Packs — open yours in",
    el: "για μια ευκαιρία σε σπάνιες και θρυλικές κάρτες. Οι νέοι λογαριασμοί ξεκινούν επιπλέον με δωρεάν Πακέτα Καλωσορίσματος — άνοιξέ τα στις",
  },
  "dashboard.economyHintSuffix": { en: ".", el: "." },

  "dashboard.guestHintPrefix": {
    en: "Predict games, earn points, and collect cards —",
    el: "Πρόβλεψε αγώνες, κέρδισε πόντους και σύλλεξε κάρτες —",
  },
  "dashboard.guestHintCta": { en: "create a free account", el: "δημιούργησε δωρεάν λογαριασμό" },
  "dashboard.guestHintSuffix": { en: "to get started — takes a minute.", el: "για να ξεκινήσεις — παίρνει ένα λεπτό." },

  "dashboard.topPredictors": { en: "Top Predictors", el: "Κορυφαίοι στις Προβλέψεις" },

  "dashboard.sponsorTag": { en: "SPONSOR", el: "ΧΟΡΗΓΟΣ" },
};
