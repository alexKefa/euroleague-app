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
};
