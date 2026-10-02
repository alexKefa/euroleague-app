import { Lang } from "./lang";

// The Teams hub (frontend/src/app/features/teams/) — a directory of every
// EuroLeague team, plus entry points into the global stats/compare tools.
export const teamsTranslations: Record<string, Record<Lang, string>> = {
  "teams.title": { en: "Teams", el: "Ομάδες" },
  // Fan map (features/fan-map, 2026-10-02).
  "fanMap.title": { en: "Fan map", el: "Χάρτης φιλάθλων" },
  "fanMap.eyebrow": { en: "Community", el: "Κοινότητα" },
  "fanMap.subtitle": { en: "Every club's fan base on Clutch. The taller the block, the bigger the crowd.", el: "Οι φίλαθλοι κάθε ομάδας στο Clutch. Όσο πιο ψηλό το τουβλάκι, τόσο μεγαλύτερη η κερκίδα." },
  "fanMap.total": { en: "{n} fans", el: "{n} φίλαθλοι" },
  "fanMap.yourTeam": { en: "Your team", el: "Η ομάδα σου" },
  "fanMap.yourRank": { en: "{team}: #{rank} of {n} fan bases", el: "{team}: #{rank} από {n} κερκίδες" },
  "fanMap.fansOne": { en: "1 fan", el: "1 φίλαθλος" },
  "fanMap.fansMany": { en: "{n} fans", el: "{n} φίλαθλοι" },
  "fanMap.ranking": { en: "Biggest fan bases", el: "Οι μεγαλύτερες κερκίδες" },
  "fanMap.noFans": { en: "No fans yet. Be the first!", el: "Δεν υπάρχουν φίλαθλοι ακόμα." },
  "fanMap.you": { en: "You", el: "Εσύ" },
  "fanMap.teamPage": { en: "Team page", el: "Σελίδα ομάδας" },
  // Teams hub destination cards (2026-09-29).
  "teams.hubStandingsSub": { en: "The full league table", el: "Η πλήρης βαθμολογία" },
  "teams.hubCompareSub": { en: "Players head-to-head", el: "Παίκτες κόντρα-κόντρα" },
  "teams.hubStatsSub": { en: "Every player stat", el: "Όλα τα στατιστικά" },
  "teams.hubBuilderSub": { en: "Build your own views", el: "Φτιάξε τις δικές σου προβολές" },
  "teams.hubInjuriesSub": { en: "Who's out and who's back", el: "Ποιοι λείπουν, ποιοι επιστρέφουν" },
  "teams.subtitle": {
    en: "Every EuroLeague team this season — pick one for its full roster and stats.",
    el: "Κάθε ομάδα της EuroLeague φέτος — διάλεξε μία για το πλήρες ρόστερ και τα στατιστικά της.",
  },
  "teams.searchPlaceholder": { en: "Search teams…", el: "Αναζήτηση ομάδων…" },
  "teams.empty": { en: "No teams match your search.", el: "Καμία ομάδα δεν ταιριάζει με την αναζήτησή σου." },
  "teams.coach": { en: "Coach", el: "Προπονητής" },
};
