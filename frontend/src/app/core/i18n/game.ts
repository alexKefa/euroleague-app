import { Lang } from "./lang";

export const gameTranslations: Record<string, Record<Lang, string>> = {
  "game.round": { en: "Round", el: "Γύρος" },
  "game.final": { en: "Final", el: "Τελικό" },
  "game.vs": { en: "vs", el: "vs" },
  "game.topPerformers": { en: "Top Performers", el: "Κορυφαίες Εμφανίσεις" },
  "game.doubleDouble": { en: "double-double", el: "double-double" },
  "game.playersToWatch": { en: "Players to Watch", el: "Παίκτες να Προσέξεις" },
  "game.playersWhoStoodOut": { en: "Players Who Stood Out This Season", el: "Παίκτες που Ξεχώρισαν Φέτος" },
  "game.noStatsYet": { en: "No stats yet.", el: "Δεν υπάρχουν στατιστικά ακόμα." },
  "game.noSeasonStatsYet": { en: "No season stats yet.", el: "Δεν υπάρχουν ακόμα στατιστικά σεζόν." },
  "game.teamComparison": { en: "Team Comparison", el: "Σύγκριση Ομάδων" },
  "game.record": { en: "Record", el: "Ρεκόρ" },
  "game.standing": { en: "Standing", el: "Θέση" },
  "game.ppg": { en: "PPG", el: "Πόντοι/Αγώνα" },
  "game.oppPpg": { en: "Opp PPG", el: "Πόντοι Αντ./Αγώνα" },
  "game.offRating": { en: "Off Rating", el: "Επιθετική Αξιολ." },
  "game.defRating": { en: "Def Rating", el: "Αμυντική Αξιολ." },
  "game.boxScore": { en: "Box Score", el: "Στατιστικά Αγώνα" },
  "game.playerColumn": { en: "Player", el: "Παίκτης" },
  "game.seasonNotStarted": {
    en: "hasn't started yet — stats below are from",
    el: "δεν έχει ξεκινήσει ακόμα — τα στατιστικά παρακάτω είναι από",
  },
  "game.close": { en: "Close", el: "Κλείσιμο" },
  "game.fullPlayerPage": { en: "Full player page", el: "Πλήρης σελίδα παίκτη" },
  "game.couldntLoadPlayer": {
    en: "Couldn't load this player.",
    el: "Δεν ήταν δυνατή η φόρτωση αυτού του παίκτη.",
  },
  "game.gameNotFound": { en: "Game not found.", el: "Ο αγώνας δεν βρέθηκε." },
  "game.failedToLoad": { en: "Failed to load this game.", el: "Αποτυχία φόρτωσης του αγώνα." },
};
