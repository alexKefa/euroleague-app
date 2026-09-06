import { Lang } from "./lang";

export const fantasyTranslations: Record<string, Record<Lang, string>> = {
  "fantasy.navLink": { en: "Fantasy Team", el: "Fantasy Ομάδα" },
  "fantasy.title": { en: "Fantasy Five", el: "Fantasy Πεντάδα" },
  "fantasy.hint": {
    en: "Draft 5 real players under a budget cap, name a captain (2x points), and score off their real box-score performance each round.",
    el: "Διάλεξε 5 πραγματικούς παίκτες μέσα σε ένα όριο προϋπολογισμού, όρισε αρχηγό (διπλοί πόντοι) και βαθμολογήσου με βάση την πραγματική τους απόδοση κάθε αγωνιστική.",
  },
  "fantasy.loginToUse": { en: "Log in to build a fantasy lineup.", el: "Συνδέσου για να φτιάξεις τη fantasy ομάδα σου." },
  "fantasy.budgetLabel": { en: "Budget", el: "Προϋπολογισμός" },
  "fantasy.rosterTab": { en: "My Lineup", el: "Η Ομάδα μου" },
  "fantasy.leaderboardTab": { en: "Leaderboard", el: "Κατάταξη" },
  "fantasy.round": { en: "Round", el: "Αγωνιστική" },
  "fantasy.locked": { en: "Locked for this round", el: "Κλειδωμένη για αυτή την αγωνιστική" },
  "fantasy.lockCountdown": { en: "Locks at first tipoff:", el: "Κλειδώνει στο πρώτο τζάμπολ:" },
  "fantasy.captainLabel": { en: "Captain", el: "Αρχηγός" },
  "fantasy.setCaptain": { en: "Make captain", el: "Ορισμός αρχηγού" },
  "fantasy.selectPlayer": { en: "Add", el: "Προσθήκη" },
  "fantasy.removePlayer": { en: "Remove", el: "Αφαίρεση" },
  "fantasy.slotsFilled": { en: "players selected", el: "παίκτες επιλεγμένοι" },
  "fantasy.submit": { en: "Lock in lineup", el: "Κλείδωμα ομάδας" },
  "fantasy.submitting": { en: "Saving…", el: "Αποθήκευση…" },
  "fantasy.saved": { en: "Lineup saved.", el: "Η ομάδα αποθηκεύτηκε." },
  "fantasy.needFivePlayers": { en: "Pick exactly 5 players.", el: "Διάλεξε ακριβώς 5 παίκτες." },
  "fantasy.needCaptain": { en: "Pick a captain from your 5.", el: "Όρισε αρχηγό από τους 5." },
  "fantasy.overBudget": { en: "Over budget — remove or swap a player.", el: "Υπέρβαση προϋπολογισμού — αφαίρεσε ή άλλαξε παίκτη." },
  "fantasy.saveFailed": { en: "Failed to save your lineup.", el: "Η αποθήκευση της ομάδας απέτυχε." },
  "fantasy.searchPlaceholder": { en: "Search players…", el: "Αναζήτηση παικτών…" },
  "fantasy.allTeams": { en: "All teams", el: "Όλες οι ομάδες" },
  "fantasy.colPlayer": { en: "Player", el: "Παίκτης" },
  "fantasy.colTeam": { en: "Team", el: "Ομάδα" },
  "fantasy.colPrice": { en: "Price", el: "Τιμή" },
  "fantasy.colPpg": { en: "PPG", el: "Πόντοι" },
  "fantasy.colPir": { en: "PIR", el: "PIR" },
  "fantasy.globalBoard": { en: "Global", el: "Γενική" },
  "fantasy.myLeagueBoard": { en: "My league", el: "Η λίγκα μου" },
  "fantasy.pointsAbbrev": { en: "pts", el: "π." },
  "fantasy.noLineupYet": { en: "No lineup saved for this round yet.", el: "Δεν έχει αποθηκευτεί ομάδα για αυτή την αγωνιστική." },
  "fantasy.emptyLeaderboard": { en: "No fantasy points scored yet this season.", el: "Δεν έχουν σημειωθεί ακόμα fantasy πόντοι φέτος." },
  "fantasy.showMore": { en: "Show more", el: "Περισσότερα" },
  "fantasy.posAll": { en: "All", el: "Όλες" },
  // Position names/abbreviations stay English in both locales, by request
  // — "Guard"/"Forward"/"Center" (and G/F/C) are how these positions are
  // referred to on court regardless of language, unlike the rest of this
  // page's UI text.
  "fantasy.posGuard": { en: "Guard", el: "Guard" },
  "fantasy.posForward": { en: "Forward", el: "Forward" },
  "fantasy.posCenter": { en: "Center", el: "Center" },
  "fantasy.posGuardAbbrev": { en: "G", el: "G" },
  "fantasy.posForwardAbbrev": { en: "F", el: "F" },
  "fantasy.posCenterAbbrev": { en: "C", el: "C" },
  // dragHint shows at sm: and up, where the pool sits beside the court;
  // tapSlotHint shows below sm:, where the pool is hidden and a slot opens
  // the picker popup instead (see fantasy.html's two-column comment).
  "fantasy.dragHint": { en: "Tap a player's price to add them, or drag them onto the court.", el: "Πάτησε την τιμή ενός παίκτη για να τον προσθέσεις, ή σύρε τον στο γήπεδο." },
  "fantasy.tapSlotHint": { en: "Tap an empty slot to pick a player.", el: "Πάτησε μια άδεια θέση για να διαλέξεις παίκτη." },
  "fantasy.courtFull": { en: "Court full — drag a player off to swap.", el: "Το γήπεδο είναι γεμάτο — σύρε έναν παίκτη έξω για αλλαγή." },
  "fantasy.pickPlayerTitle": { en: "Choose a player", el: "Επίλεξε παίκτη" },
  "fantasy.pickerPositionHint": { en: "needed for this slot", el: "απαιτείται για αυτή τη θέση" },
  "fantasy.noPlayersFound": { en: "No players match these filters.", el: "Κανένας παίκτης δεν ταιριάζει με αυτά τα φίλτρα." },
  "fantasy.last5GamesTitle": { en: "Last 5 games", el: "Τελευταίοι 5 αγώνες" },
  "fantasy.noRecentGames": { en: "No recent games found.", el: "Δεν βρέθηκαν πρόσφατοι αγώνες." },
  "fantasy.fixturesButton": { en: "Fixtures", el: "Πρόγραμμα" },
  "fantasy.fixturesTitle": { en: "This round's fixtures", el: "Το πρόγραμμα της αγωνιστικής" },
  "fantasy.noFixtures": { en: "No fixtures found for this round.", el: "Δεν βρέθηκαν αγώνες για αυτή την αγωνιστική." },
  "fantasy.close": { en: "Close", el: "Κλείσιμο" },
  // Kept as the literal "vs"/"@" symbols in both locales, same precedent as
  // posGuard/posGuardAbbrev above — translating these as words ("με"/"εκτός
  // με") read awkwardly next to a team code and cost more horizontal space
  // than the symbol does.
  "fantasy.homeAbbrev": { en: "vs", el: "vs" },
  "fantasy.awayAbbrev": { en: "@", el: "@" },
  "fantasy.bye": { en: "No game", el: "Ρεπό" },
  "fantasy.sixthManLabel": { en: "Sixth Man (100%)", el: "6ος Παίκτης (100%)" },
  "fantasy.benchLabel": { en: "Bench (50%)", el: "Πάγκος (50%)" },
  "fantasy.coachLabel": { en: "Coach", el: "Προπονητής" },
  "fantasy.coachLocked": { en: "Coach locked for this round.", el: "Ο προπονητής κλείδωσε για αυτή την αγωνιστική." },
  "fantasy.formationTitle": { en: "Choose a formation", el: "Επιλογή σχηματισμού" },
};
