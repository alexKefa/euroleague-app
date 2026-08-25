import { Lang } from "./lang";

// The analytics builder (frontend/src/app/features/analytics-builder/) — a
// user's saved custom stat tables: pick players + columns, save, view as a
// sortable table. Free (not points-gated).
export const analyticsBuilderTranslations: Record<string, Record<Lang, string>> = {
  "builder.navTitle": { en: "Builder", el: "Δημιουργός" },
  "builder.title": { en: "Analytics Builder", el: "Δημιουργός Στατιστικών" },
  "builder.subtitle": {
    en: "Build your own stat table — pick the players and columns you actually care about, save it, come back anytime.",
    el: "Φτιάξε τον δικό σου πίνακα στατιστικών — διάλεξε τους παίκτες και τις στήλες που σε ενδιαφέρουν, αποθήκευσέ τον, επίστρεψε όποτε θες.",
  },
  "builder.loginPrompt": { en: "to build and save your own stat tables.", el: "για να φτιάξεις και να αποθηκεύσεις τους δικούς σου πίνακες στατιστικών." },
  "builder.newView": { en: "New view", el: "Νέα προβολή" },
  "builder.editView": { en: "Edit view", el: "Επεξεργασία προβολής" },
  "builder.empty": { en: "No saved views yet — build your first one.", el: "Δεν υπάρχουν αποθηκευμένες προβολές ακόμα — φτιάξε την πρώτη σου." },
  "builder.playersCount": { en: "players", el: "παίκτες" },
  "builder.columnsCount": { en: "columns", el: "στήλες" },
  "builder.nameLabel": { en: "Name", el: "Όνομα" },
  "builder.namePlaceholder": { en: "e.g. My watchlist", el: "π.χ. Η λίστα μου" },
  "builder.playersLabel": { en: "Players", el: "Παίκτες" },
  "builder.templatesLabel": { en: "Quick templates", el: "Γρήγορα πρότυπα" },
  "builder.templateGuards": { en: "Top 5 Guards", el: "Κορυφαίοι 5 Γκαρντ" },
  "builder.templateForwards": { en: "Top 5 Forwards", el: "Κορυφαίοι 5 Φόργουορντ" },
  "builder.templateCenters": { en: "Top 5 Centers", el: "Κορυφαίοι 5 Σέντερ" },
  "builder.templateHint": { en: "Ranked by PIR — swap players below anytime.", el: "Κατάταξη με βάση το PIR — άλλαξε παίκτες παρακάτω όποτε θες." },
  "builder.searchPlaceholder": { en: "Search to add a player…", el: "Αναζήτηση για προσθήκη παίκτη…" },
  "builder.columnsLabel": { en: "Columns", el: "Στήλες" },
  "builder.save": { en: "Save view", el: "Αποθήκευση προβολής" },
  "builder.cancel": { en: "Cancel", el: "Ακύρωση" },
  "builder.delete": { en: "Delete", el: "Διαγραφή" },
  "builder.deleteConfirmPrompt": { en: "Delete this view?", el: "Διαγραφή αυτής της προβολής;" },
  "builder.deleteConfirmYes": { en: "Yes, delete", el: "Ναι, διαγραφή" },
  "builder.edit": { en: "Edit", el: "Επεξεργασία" },
  "builder.backToViews": { en: "My views", el: "Οι προβολές μου" },
  "builder.viewTable": { en: "Table", el: "Πίνακας" },
  "builder.viewChart": { en: "Chart", el: "Γράφημα" },
  "builder.formErrorIncomplete": {
    en: "Give it a name, at least one player, and at least one column.",
    el: "Δώσε ένα όνομα, τουλάχιστον έναν παίκτη και τουλάχιστον μία στήλη.",
  },
};
