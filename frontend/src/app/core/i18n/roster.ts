import { Lang } from "./lang";

export const rosterTranslations: Record<string, Record<Lang, string>> = {
  "roster.backToDashboard": { en: "Dashboard", el: "Πίνακας" },
  "roster.teamProfileVsLeague": {
    en: "Team profile vs league average",
    el: "Προφίλ ομάδας έναντι μέσου όρου πρωταθλήματος",
  },
  "roster.teamProfileHint": {
    en: "Points scored, points allowed and rebounding compared to the EuroLeague average.",
    el: "Πόντοι που πέτυχε, πόντοι που δέχτηκε και ριμπάουντ σε σύγκριση με τον μέσο όρο της EuroLeague.",
  },
  "roster.vsLeagueAvg": { en: "vs league avg", el: "έναντι μ.ό." },
  "roster.upcomingGames": { en: "Upcoming games", el: "Επερχόμενοι αγώνες" },
  "roster.predictOnPredictionsPage": {
    en: "Predict this round's games on the Predictions page",
    el: "Πρόβλεψε τους αγώνες της αγωνιστικής στη σελίδα Προβλέψεις",
  },
  "roster.headCoach": { en: "Head coach", el: "Αρχιπροπονητής" },
  "roster.title": { en: "Roster", el: "Ρόστερ" },
  "roster.traditional": { en: "Traditional", el: "Απλά" },
  "roster.advanced": { en: "Advanced", el: "Προχωρημένα" },
  "roster.colPlayer": { en: "Player", el: "Παίκτης" },
  "roster.colGP": { en: "GP", el: "ΑΓ" },
  "roster.colMIN": { en: "MIN", el: "ΛΕΠ" },
  "roster.colPPG": { en: "PPG", el: "ΠΟΝ" },
  "roster.colRPG": { en: "RPG", el: "ΡΙΜΠ" },
  "roster.colAPG": { en: "APG", el: "ΑΣΙ" },
  "roster.colSPG": { en: "SPG", el: "ΚΛΕ" },
  "roster.colPIR": { en: "PIR", el: "PIR" },
  "roster.colTS": { en: "TS%", el: "TS%" },
  "roster.colEFG": { en: "eFG%", el: "eFG%" },
  "roster.colREB": { en: "REB%", el: "REB%" },
  "roster.colAST": { en: "AST%", el: "AST%" },
  "roster.colTOV": { en: "TOV%", el: "TOV%" },
  "roster.colPOSS": { en: "POSS", el: "ΚΑΤ" },
  "roster.colUSG": { en: "USG%", el: "USG%" },
  "roster.noRosterData": { en: "No roster data yet.", el: "Δεν υπάρχουν ακόμα στοιχεία ρόστερ." },
  "roster.recentResults": { en: "Recent results", el: "Πρόσφατα αποτελέσματα" },
  "roster.noTeamSpecified": { en: "No team specified.", el: "Δεν έχει οριστεί ομάδα." },
  "roster.loadError": { en: "Couldn't load the roster.", el: "Δεν ήταν δυνατή η φόρτωση του ρόστερ." },
  "roster.axisOffense": { en: "Offense", el: "Επίθεση" },
  "roster.axisDefense": { en: "Defense", el: "Άμυνα" },
  "roster.axisRebounding": { en: "Rebounding", el: "Ριμπάουντ" },

  // Glossary entries for shared/stat-legend.ts — one full sentence per
  // column abbreviation, shown in the "what these mean" popover.
  "roster.legendGP": { en: "Games played", el: "Αγώνες που έπαιξε" },
  "roster.legendMIN": { en: "Minutes per game", el: "Λεπτά ανά αγώνα" },
  "roster.legendPPG": { en: "Points per game", el: "Πόντοι ανά αγώνα" },
  "roster.legendRPG": { en: "Rebounds per game", el: "Ριμπάουντ ανά αγώνα" },
  "roster.legendAPG": { en: "Assists per game", el: "Ασίστ ανά αγώνα" },
  "roster.legendSPG": { en: "Steals per game", el: "Κλεψίματα ανά αγώνα" },
  "roster.legendPIR": {
    en: "Performance Index Rating — EuroLeague's overall efficiency stat",
    el: "Performance Index Rating — ο συνολικός δείκτης απόδοσης της EuroLeague",
  },
  "roster.legendTS": {
    en: "True shooting % — scoring efficiency counting free throws and threes",
    el: "True shooting % — επιθετική απόδοση με βολές και τρίποντα",
  },
  "roster.legendEFG": {
    en: "Effective field goal % — weights three-pointers appropriately",
    el: "Effective field goal % — δίνει σωστή βαρύτητα στα τρίποντα",
  },
  "roster.legendREB": {
    en: "Share of available rebounds grabbed while on court",
    el: "Ποσοστό διαθέσιμων ριμπάουντ που μάζεψε όσο ήταν στο παρκέ",
  },
  "roster.legendAST": {
    en: "Share of teammates' baskets assisted while on court",
    el: "Ποσοστό καλαθιών συμπαικτών που ασίσταρε όσο ήταν στο παρκέ",
  },
  "roster.legendTOV": { en: "Turnovers per 100 plays", el: "Λάθη ανά 100 φάσεις" },
  "roster.legendPOSS": { en: "Possessions per game", el: "Κατοχές ανά αγώνα" },
  "roster.legendUSG": {
    en: "Share of the team's plays used while on court",
    el: "Ποσοστό των φάσεων της ομάδας που χρησιμοποίησε όσο ήταν στο παρκέ",
  },
};
