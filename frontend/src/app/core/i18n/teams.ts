import { Lang } from "./lang";

// The Teams hub (frontend/src/app/features/teams/) — a directory of every
// EuroLeague team, plus entry points into the global stats/compare tools.
export const teamsTranslations: Record<string, Record<Lang, string>> = {
  "teams.title": { en: "Teams", el: "Ομάδες" },
  "teams.subtitle": {
    en: "Every EuroLeague team this season — pick one for its full roster and stats.",
    el: "Κάθε ομάδα της EuroLeague φέτος — διάλεξε μία για το πλήρες ρόστερ και τα στατιστικά της.",
  },
  "teams.searchPlaceholder": { en: "Search teams…", el: "Αναζήτηση ομάδων…" },
  "teams.empty": { en: "No teams match your search.", el: "Καμία ομάδα δεν ταιριάζει με την αναζήτησή σου." },
};
