import { Lang } from "./lang";

// The advanced-stats leaderboard (frontend/src/app/features/stats/) — a
// sortable/filterable table over playerSeasonStats for the whole league.
export const statsTranslations: Record<string, Record<Lang, string>> = {
  "stats.viewFull": { en: "Full stats table", el: "Πλήρης πίνακας" },
  "stats.title": { en: "Advanced Stats", el: "Προχωρημένα Στατιστικά" },
  "stats.subtitle": {
    en: "Every player, sorted and filtered your way — shooting efficiency, rebound/assist/turnover rates, and pace.",
    el: "Κάθε παίκτης, ταξινομημένος και φιλτραρισμένος όπως θέλεις — απόδοση σουτ, ρυθμοί ριμπάουντ/ασίστ/λαθών, και ρυθμός παιχνιδιού.",
  },
  "stats.searchPlaceholder": { en: "Search players…", el: "Αναζήτηση παικτών…" },
  "stats.allTeams": { en: "All teams", el: "Όλες οι ομάδες" },
  "stats.minGamesLabel": { en: "Min. games", el: "Ελάχ. αγώνες" },
  "stats.minMinutesLabel": { en: "Min. MPG", el: "Ελάχ. λεπτά" },
  "stats.empty": { en: "No players match your filters.", el: "Κανένας παίκτης δεν ταιριάζει με τα φίλτρα σου." },
  "stats.clearFilters": { en: "Clear filters", el: "Καθαρισμός φίλτρων" },
  "stats.colPlayer": { en: "Player", el: "Παίκτης" },
  "stats.colGp": { en: "GP", el: "ΑΓ" },
  "stats.colMin": { en: "MIN", el: "ΛΕΠ" },
  "stats.colPts": { en: "PTS", el: "ΠΟΝ" },
  "stats.colPir": { en: "PIR", el: "PIR" },
  "stats.colTs": { en: "TS%", el: "TS%" },
  "stats.colEfg": { en: "eFG%", el: "eFG%" },
  "stats.colOreb": { en: "OREB%", el: "OREB%" },
  "stats.colDreb": { en: "DREB%", el: "DREB%" },
  "stats.colAstTo": { en: "AST/TO", el: "ASS/ΛΑΘ" },
  "stats.colTov": { en: "TOV%", el: "TOV%" },
  "stats.colPace": { en: "POSS", el: "ΚΑΤ" },
  "stats.colUsg": { en: "USG%", el: "USG%" },

  "stats.legendOreb": {
    en: "Share of available offensive rebounds grabbed while on court",
    el: "Ποσοστό διαθέσιμων επιθετικών ριμπάουντ που μάζεψε όσο ήταν στο παρκέ",
  },
  "stats.legendDreb": {
    en: "Share of available defensive rebounds grabbed while on court",
    el: "Ποσοστό διαθέσιμων αμυντικών ριμπάουντ που μάζεψε όσο ήταν στο παρκέ",
  },
  "stats.legendAstTo": { en: "Assists per turnover — ball security on offense", el: "Ασίστ ανά λάθος — ασφάλεια στην επίθεση" },
  "stats.legendUsg": {
    en: "Share of the team's plays used by this player while on court",
    el: "Ποσοστό των φάσεων της ομάδας που χρησιμοποίησε ο παίκτης όσο ήταν στο παρκέ",
  },

  // Player head-to-head (frontend/src/app/features/compare/).
  "stats.compare.navTitle": { en: "Compare players", el: "Σύγκριση παικτών" },
  "stats.compare.title": { en: "Player Head-to-Head", el: "Παίκτης εναντίον Παίκτη" },
  "stats.compare.subtitle": {
    en: "Pick any two players to see how their season stacks up, category by category.",
    el: "Διάλεξε δύο παίκτες για να δεις πώς συγκρίνεται η σεζόν τους, κατηγορία προς κατηγορία.",
  },
  "stats.compare.searchPlaceholder": { en: "Search a player…", el: "Αναζήτηση παίκτη…" },
  "stats.compare.pickPrompt": {
    en: "Pick two players above to see their head-to-head.",
    el: "Διάλεξε δύο παίκτες παραπάνω για να δεις τη σύγκρισή τους.",
  },
  "stats.compare.change": { en: "Change", el: "Αλλαγή" },
  "stats.compare.vs": { en: "VS", el: "VS" },
  "stats.compare.categoryScore": { en: "Category score", el: "Σκορ κατηγοριών" },
  "stats.compare.statPts": { en: "Points", el: "Πόντοι" },
  "stats.compare.statReb": { en: "Rebounds", el: "Ριμπάουντ" },
  "stats.compare.statAst": { en: "Assists", el: "Ασίστ" },
  "stats.compare.statStl": { en: "Steals", el: "Κλεψίματα" },
  "stats.compare.statBlk": { en: "Blocks", el: "Κοψίματα" },
  "stats.compare.statTov": { en: "Turnovers", el: "Λάθη" },
  "stats.compare.statFg": { en: "Field Goal %", el: "Ευστοχία Σουτ %" },
  "stats.compare.statPir": { en: "PIR", el: "PIR" },
  "stats.compare.statTs": { en: "True Shooting %", el: "True Shooting %" },
  "stats.compare.statAstTo": { en: "Assist/Turnover", el: "Ασίστ/Λάθος" },
};
