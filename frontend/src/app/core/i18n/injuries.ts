import { Lang } from "./lang";

// The Injury Report page (frontend/src/app/features/injuries/) plus the
// small badge reused on the roster page and Profile's admin form. Data is
// admin-entered, not synced — see backend/src/db/schema.ts's playerInjuries
// doc comment for why EuroLeague's own feed can't supply this.
export const injuriesTranslations: Record<string, Record<Lang, string>> = {
  "injuries.title": { en: "Injury Report", el: "Αναφορά Τραυματισμών" },
  "injuries.subtitle": {
    en: "Player availability across the league, updated by hand — not an official EuroLeague feed.",
    el: "Διαθεσιμότητα παικτών σε όλο το πρωτάθλημα, ενημερώνεται χειροκίνητα — όχι επίσημη ροή της EuroLeague.",
  },
  "injuries.empty": { en: "No active injury reports.", el: "Καμία ενεργή αναφορά τραυματισμού." },
  "injuries.loadError": { en: "Couldn't load the injury report.", el: "Δεν ήταν δυνατή η φόρτωση της αναφοράς τραυματισμών." },
  "injuries.updated": { en: "Updated", el: "Ενημερώθηκε" },
  "injuries.statusOut": { en: "Out", el: "Εκτός" },
  "injuries.statusDoubtful": { en: "Doubtful", el: "Αμφίβολος" },
  "injuries.statusQuestionable": { en: "Questionable", el: "Ερωτηματικό" },
  "injuries.statusProbable": { en: "Probable", el: "Πιθανός" },

  // Admin-only tools, inline on this page (moved off Profile 2026-09-04 —
  // editing/removing a report now happens right where it's read, not on a
  // separate settings page).
  "injuries.adminReportTitle": { en: "Report an injury", el: "Καταχώρηση τραυματισμού" },
  "injuries.adminPlayerPlaceholder": { en: "Choose a player", el: "Επίλεξε παίκτη" },
  "injuries.adminNotePlaceholder": { en: "Note (optional)", el: "Σημείωση (προαιρετικό)" },
  "injuries.adminSubmit": { en: "Set status", el: "Ορισμός κατάστασης" },
  "injuries.adminSubmitting": { en: "Saving…", el: "Αποθήκευση…" },
  "injuries.adminSetFor": { en: "Set injury status for", el: "Ορίστηκε κατάσταση τραυματισμού για" },
  "injuries.adminSetFailed": { en: "Failed to set injury status.", el: "Αποτυχία ορισμού κατάστασης τραυματισμού." },
  "injuries.adminEdit": { en: "Edit", el: "Επεξεργασία" },
  "injuries.adminRemove": { en: "Remove", el: "Αφαίρεση" },
  "injuries.adminSave": { en: "Save", el: "Αποθήκευση" },
  "injuries.adminCancel": { en: "Cancel", el: "Ακύρωση" },
};
