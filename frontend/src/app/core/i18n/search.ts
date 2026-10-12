import { Lang } from "./lang";

// Global search (2026-10-12, shared/search-dialog.ts).
export const searchTranslations: Record<string, Record<Lang, string>> = {
  "search.placeholder": { en: "Search players, teams, games, referees", el: "Αναζήτηση παικτών, ομάδων, αγώνων, διαιτητών" },
  "search.players": { en: "Players", el: "Παίκτες" },
  "search.teams": { en: "Teams", el: "Ομάδες" },
  "search.games": { en: "Games", el: "Αγώνες" },
  "search.referees": { en: "Referees", el: "Διαιτητές" },
  "search.recent": { en: "Recent", el: "Πρόσφατα" },
  "search.none": { en: "No results for \"{q}\"", el: "Κανένα αποτέλεσμα για \"{q}\"" },
  "search.open": { en: "Search", el: "Αναζήτηση" },
  "search.loading": { en: "Loading…", el: "Φόρτωση…" },
};
