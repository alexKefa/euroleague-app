import { Lang } from "./lang";

export const fantasyTranslations: Record<string, Record<Lang, string>> = {
  "fantasy.navLink": { en: "Fantasy Team", el: "Fantasy Ομάδα" },
  "fantasy.title": { en: "Clutch Fantasy", el: "Clutch Fantasy" },
  "fantasy.hint": {
    en: "Draft 10 real players (starters + bench) and a coach under a budget cap, name a captain (2x points), and score off their real box-score performance each round.",
    el: "Διάλεξε 10 πραγματικούς παίκτες (βασικούς και αναπληρωματικούς) και προπονητή μέσα σε ένα όριο προϋπολογισμού, όρισε αρχηγό (διπλοί πόντοι) και βαθμολογήσου με βάση την πραγματική τους απόδοση κάθε αγωνιστική.",
  },
  "fantasy.loginToUse": { en: "Log in to build a fantasy lineup.", el: "Συνδέσου για να φτιάξεις τη fantasy ομάδα σου." },
  "fantasy.budgetLabel": { en: "Budget", el: "Προϋπολογισμός" },
  "fantasy.rosterTab": { en: "My Lineup", el: "Η Ομάδα μου" },
  "fantasy.leaderboardTab": { en: "Leaderboard", el: "Κατάταξη" },
  "fantasy.round": { en: "Round", el: "Αγωνιστική" },
  "fantasy.locked": { en: "Locked for this round", el: "Κλειδωμένη για αυτή την αγωνιστική" },
  "fantasy.subsOnly": { en: "Subs only", el: "Μόνο αλλαγές" },
  "fantasy.subsWindowOpen": {
    en: "Round in progress — transfers and coach are closed, but you can still swap any of your players between starters and bench, change formation, and move the captaincy to a player who hasn't played yet.",
    el: "Η αγωνιστική είναι σε εξέλιξη — οι μεταγραφές και ο προπονητής έκλεισαν, αλλά μπορείς ακόμα να αλλάξεις θέση σε οποιονδήποτε παίκτη σου μεταξύ βασικών και πάγκου, να αλλάξεις σχηματισμό και να δώσεις το περιβραχιόνιο σε παίκτη που δεν έχει αγωνιστεί ακόμα.",
  },
  "fantasy.lockCountdown": { en: "Locks at first tipoff:", el: "Κλειδώνει στο πρώτο τζάμπολ:" },
  "fantasy.daysWord": { en: "days", el: "ημέρες" },
  "fantasy.transfersOpen": { en: "Transfers open", el: "Ανοικτές μεταγραφές" },
  "fantasy.transferWindowIcon": { en: "Transfer window", el: "Παράθυρο μεταγραφών" },
  "fantasy.locksToday": { en: "Locks today", el: "Κλειδώνει σήμερα" },
  "fantasy.dayAbbrev": { en: "Day", el: "Ημέρα" },
  "fantasy.captainLabel": { en: "Captain", el: "Αρχηγός" },
  "fantasy.setCaptain": { en: "Make captain", el: "Ορισμός αρχηγού" },
  "fantasy.selectPlayer": { en: "Add", el: "Προσθήκη" },
  "fantasy.removePlayer": { en: "Remove", el: "Αφαίρεση" },
  "fantasy.slotsFilled": { en: "players selected", el: "παίκτες επιλεγμένοι" },
  "fantasy.submitting": { en: "Saving…", el: "Αποθήκευση…" },
  "fantasy.saved": { en: "Lineup saved.", el: "Η ομάδα αποθηκεύτηκε." },
  "fantasy.unsavedChanges": { en: "Unsaved changes", el: "Μη αποθηκευμένες αλλαγές" },
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
  "fantasy.cpAbbrev": { en: "CP", el: "CP" },
  "fantasy.cpInfoTitle": { en: "What are Clutch Points?", el: "Τι είναι τα Clutch Points;" },
  "fantasy.cpInfoBody": {
    en: "CP (Clutch Points) reflect your Fantasy Five squad's real performance each round, based on player PIR. They aren't spendable on their own — once a round completes, half of that round's CP (rounded down) is automatically added to your real app Points, which is what counts toward the Predictions and Total rankings.",
    el: "Τα CP (Clutch Points) δείχνουν την πραγματική απόδοση της ομάδας σου στο Fantasy Five κάθε αγωνιστική, με βάση το PIR των παικτών. Δεν είναι από μόνα τους αξιοποιήσιμα — μόλις ολοκληρωθεί μια αγωνιστική, οι μισοί πόντοι CP (στρογγυλοποιημένοι προς τα κάτω) προστίθενται αυτόματα στους πραγματικούς σου Πόντους, που μετράνε στις κατατάξεις Προβλέψεων και Συνόλου.",
  },
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
  "fantasy.seasonAverageTitle": { en: "Season average", el: "Μέσος όρος σεζόν" },
  "fantasy.last5GamesTitle": { en: "Last 5 games", el: "Τελευταίοι 5 αγώνες" },
  "fantasy.noRecentGames": { en: "No recent games found.", el: "Δεν βρέθηκαν πρόσφατοι αγώνες." },
  "fantasy.fixturesButton": { en: "Fixtures", el: "Πρόγραμμα" },
  "fantasy.fixturesTitle": { en: "This round's games", el: "Οι αγώνες της αγωνιστικής" },
  "fantasy.noFixtures": { en: "No fixtures found for this round.", el: "Δεν βρέθηκαν αγώνες για αυτή την αγωνιστική." },
  "fantasy.liveNow": { en: "Live", el: "Ζωντανά" },
  "fantasy.gameFinal": { en: "Final", el: "Τέλος" },
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
  "fantasy.saveShort": { en: "Save", el: "Αποθήκευση" },
  "fantasy.swapPlayer": { en: "Swap", el: "Αλλαγή" },
  "fantasy.swapPickerTitle": { en: "Swap with…", el: "Αλλαγή με…" },
  "fantasy.swapPickerHint": { en: "Choose who trades places with", el: "Διάλεξε ποιος θα αλλάξει θέση με τον" },
  "fantasy.noSwapCandidates": {
    en: "No one available to swap with right now.",
    el: "Κανείς δεν είναι διαθέσιμος για αλλαγή αυτή τη στιγμή.",
  },
  "fantasy.swapFormationChange": { en: "Formation becomes", el: "Ο σχηματισμός γίνεται" },
  "fantasy.captainPickerTitle": { en: "Choose your captain", el: "Επίλεξε αρχηγό" },
  "fantasy.captainPickerEmpty": { en: "Fill your starting five first.", el: "Συμπλήρωσε πρώτα την πεντάδα σου." },
  "fantasy.whatsMissingTitle": { en: "What's missing", el: "Τι λείπει" },
  "fantasy.missingSquadFull": { en: "Fill all 10 squad slots.", el: "Συμπλήρωσε και τις 10 θέσεις της ομάδας." },
  "fantasy.missingPositionQuota": {
    en: "Position quota not met — need 4 Guards, 4 Forwards, 2 Centers.",
    el: "Δεν καλύφθηκε η αναλογία θέσεων — χρειάζονται 4 Guards, 4 Forwards, 2 Centers.",
  },
  "fantasy.missingCaptain": { en: "Pick a captain.", el: "Όρισε αρχηγό." },
  "fantasy.missingCoach": { en: "Pick a coach.", el: "Επίλεξε προπονητή." },
  "fantasy.missingRoundLocked": {
    en: "This round has already locked — no changes can be made.",
    el: "Αυτή η αγωνιστική έχει ήδη κλειδώσει — δεν μπορούν να γίνουν αλλαγές.",
  },
  "fantasy.pastRound": { en: "Past round", el: "Παλιότερη αγωνιστική" },
  // Randomize-squad dice trigger, round 1 only (2026-09-17) — any logged-in
  // user can use this on their own squad, not just admins (see
  // fantasy.html's doc comment on the button itself for why that changed).
  "fantasy.autoFillSquad": { en: "Randomize squad", el: "Τυχαία συμπλήρωση" },
  "fantasy.autoFillConfirm": {
    en: "Your team is going to be randomized. Are you sure?",
    el: "Η ομάδα σου θα συμπληρωθεί τυχαία. Είσαι σίγουρος/η;",
  },
  "fantasy.autoFillConfirmButton": { en: "Randomize", el: "Τυχαία συμπλήρωση" },
  "fantasy.cancel": { en: "Cancel", el: "Ακύρωση" },
  "fantasy.autoFillNotice": { en: "Squad randomized!", el: "Η ομάδα συμπληρώθηκε τυχαία!" },
  "fantasy.swapNoFormation": { en: "That swap doesn't fit any formation", el: "Αυτή η αλλαγή δεν ταιριάζει σε κανέναν σχηματισμό" },
  "fantasy.turnAbbrev": { en: "T", el: "Η" },
  "fantasy.turnHint": { en: "Plays on day", el: "Αγωνίζεται την ημέρα" },
  "fantasy.turnPlayedHint": { en: "Already played on day", el: "Αγωνίστηκε ήδη την ημέρα" },
  "fantasy.simulateRoundAdmin": { en: "Admin: simulate whole round", el: "Διαχειριστής: προσομοίωση όλου του γύρου" },
  "fantasy.pointsLabel": { en: "Points", el: "Πόντοι" },
  "fantasy.creditsChangeLabel": { en: "Credits (CR)", el: "Credits (CR)" },
  // Same "stays English in both locales" precedent as posGuard/homeAbbrev
  // above — a currency-style abbreviation, not a translatable word.
  "fantasy.creditsAbbrev": { en: "CR", el: "CR" },
  // Shown next to a player/coach's price while picking (2026-09-12) — the
  // budget line in the status bar shows spent/cap, but neither picker
  // screen previously surfaced "how much do I actually have left to
  // spend" at the moment it matters most.
  "fantasy.creditsAvailable": { en: "available", el: "διαθέσιμα" },
  // Tooltip on the ▲/▼ next to a price (2026-09-22) — the daily reprice job
  // already moves prices every round, this just surfaces which way the last
  // move went.
  "fantasy.priceTrendHint": { en: "Price rose/fell in the last daily update", el: "Η τιμή ανέβηκε/έπεσε στην τελευταία ημερήσια ενημέρωση" },
  "fantasy.transfersLabel": { en: "Transfers", el: "Μεταγραφές" },
  "fantasy.roundCompleteTitle": { en: "Round complete!", el: "Η αγωνιστική ολοκληρώθηκε!" },
  // Shown in the round-complete modal when this round also earned Clutch
  // points into the shared economy (2026-09-16) — a fraction of the
  // round's fantasy score, on top of the fantasy leaderboard points shown
  // right above it.
  "fantasy.economyPointsEarned": { en: "Clutch points earned", el: "Πόντοι Clutch που κέρδισες" },
  "fantasy.rulesButton": { en: "How points work", el: "Πώς μετράνε οι πόντοι" },
  "fantasy.rulesTitle": { en: "How Fantasy Five scoring works", el: "Πώς μετράνε οι πόντοι στο Fantasy Πεντάδα" },
  "fantasy.rulesSquadTitle": { en: "Your squad", el: "Η ομάδα σου" },
  "fantasy.rulesSquadBody": {
    en: "10 outfield players (4 Guards, 4 Forwards, 2 Centers) plus 1 head coach, all under a 100-credit budget cap.",
    el: "10 παίκτες (4 Guards, 4 Forwards, 2 Centers) συν 1 προπονητής, μέσα σε όριο προϋπολογισμού 100 credits.",
  },
  "fantasy.rulesScoringTitle": { en: "Scoring", el: "Βαθμολόγηση" },
  "fantasy.rulesScoringBody": {
    en: "Once a round locks, each player's game is scored +1 per point/rebound/assist/steal, -1 per turnover, +1/-1 for blocks for/against, +1/-1 for fouls drawn/committed, and -1 per missed field goal or free throw — plus a 10% bonus if their team won. Your 5 starters and Sixth Man score 100% of that; your 4 Bench players score 50%. A player with no game that round scores 0.",
    el: "Μόλις κλειδώσει μια αγωνιστική, κάθε αγώνας βαθμολογείται +1 ανά πόντο/ριμπάουντ/ασίστ/κλέψιμο, -1 ανά λάθος, +1/-1 για τάπες υπέρ/κατά, +1/-1 για φάουλ που δέχτηκε/έκανε, και -1 ανά αστοχία σε σουτ ή βολή — συν 10% μπόνους αν κέρδισε η ομάδα του. Οι 5 βασικοί σου και ο 6ος παίκτης μετράνε το 100% αυτού. Οι 4 παίκτες του πάγκου μετράνε το 50%. Παίκτης χωρίς αγώνα εκείνη την αγωνιστική μετράει 0.",
  },
  "fantasy.rulesCaptainTitle": { en: "Captain", el: "Αρχηγός" },
  "fantasy.rulesCaptainBody": {
    en: "Pick one of your 5 starters as captain — their points for the round are doubled.",
    el: "Όρισε έναν από τους 5 βασικούς σου ως αρχηγό — οι πόντοι του διπλασιάζονται για την αγωνιστική.",
  },
  "fantasy.rulesCoachTitle": { en: "Coach", el: "Προπονητής" },
  "fantasy.rulesCoachBody": {
    en: "Scores off their real team's result and its margin, not a stat line: a win by 0-10 (or in OT) is +10, by 11-20 is +20, by 21+ is +25. A loss scores -5/-10/-20 the same way. Always counts at full value.",
    el: "Βαθμολογείται με βάση το πραγματικό αποτέλεσμα της ομάδας του και τη διαφορά, όχι στατιστικά: νίκη με 0-10 (ή σε παράταση) δίνει +10, με 11-20 δίνει +20, με 21+ δίνει +25. Η ήττα βαθμολογείται αντίστοιχα -5/-10/-20. Πάντα μετράει στο 100%.",
  },
  "fantasy.rulesTransfersTitle": { en: "Transfers", el: "Μεταγραφές" },
  "fantasy.rulesTransfersBody": {
    en: "Your squad carries over round to round. You can swap up to 4 players against last round's squad before each round locks — moving an already-picked player between starter/Sixth Man/Bench is free. Transfers are unlimited on rounds 7, 14, 19, 24, 29, and from round 35 (playoffs) onward. Your coach pick can change every round with no limit. Round 1 is a free, unlimited draft. At most 6 players from the same real club are allowed.",
    el: "Η ομάδα σου μεταφέρεται από αγωνιστική σε αγωνιστική. Μπορείς να αλλάξεις έως 4 παίκτες σε σχέση με την προηγούμενη αγωνιστική πριν κλειδώσει η επόμενη — η μετακίνηση ήδη επιλεγμένου παίκτη μεταξύ βασικής πεντάδας/6ου/πάγκου είναι δωρεάν. Οι μεταγραφές είναι απεριόριστες στις αγωνιστικές 7, 14, 19, 24, 29, και από την 35η (πλέι οφ) και μετά. Ο προπονητής μπορεί να αλλάξει κάθε αγωνιστική χωρίς όριο. Η 1η αγωνιστική είναι ελεύθερη κατασκευή χωρίς όριο. Επιτρέπονται έως 6 παίκτες από την ίδια πραγματική ομάδα.",
  },
  "fantasy.rulesEconomyTitle": { en: "Clutch points", el: "Πόντοι Clutch" },
  "fantasy.rulesEconomyBody": {
    en: "Once a round completes, half of your fantasy score for it is added to your Clutch points too — the same points Predictions earns and Store/Packs/Wheel spend. It doesn't count toward the Century badge, which stays scoped to prediction accuracy.",
    el: "Μόλις ολοκληρωθεί μια αγωνιστική, οι μισοί πόντοι fantasy που πέτυχες προστίθενται και στους πόντους Clutch — τους ίδιους πόντους που κερδίζεις από τις Προβλέψεις και ξοδεύεις στο Κατάστημα/Πακέτα/Τζάμπολ. Δεν μετράνε για το βραβείο Century, που παραμένει βασισμένο μόνο στην ακρίβεια προβλέψεων.",
  },
  "fantasy.rulesLockTitle": { en: "Lock", el: "Κλείδωμα" },
  "fantasy.rulesLockBody": {
    en: "The whole round locks the moment its first game tips off — lineup, formation, captain, and coach all become read-only until the next round.",
    el: "Όλη η αγωνιστική κλειδώνει μόλις ξεκινήσει ο πρώτος αγώνας — η ομάδα, ο σχηματισμός, ο αρχηγός και ο προπονητής κλειδώνουν μέχρι την επόμενη αγωνιστική.",
  },
  "fantasy.roundPirAbbrev": { en: "Round PIR", el: "PIR Αγωνιστικής" },
  "fantasy.totalPirAbbrev": { en: "Total PIR", el: "Σύνολο PIR" },
  "fantasy.squadPreviewTitle": { en: "Squad", el: "Ομάδα" },
  "fantasy.squadPreviewLocked": {
    en: "This squad reveals once the round starts.",
    el: "Η ομάδα αποκαλύπτεται μόλις ξεκινήσει η αγωνιστική.",
  },
  "fantasy.noTeamYet": { en: "No team set up yet", el: "Δεν έχει φτιάξει ομάδα ακόμα" },
  // Completed-rounds milestone banner (2026-09-21) — same wording pattern
  // as predictions.ts's own milestone banners.
  "fantasy.milestonePrefix": { en: "Fantasy milestone! You won", el: "Ορόσημο Fantasy! Κέρδισες" },
  "fantasy.openFromPrefix": { en: "— open from", el: "— άνοιξέ το από" },
  "fantasy.myPacksLink": { en: "My Packs", el: "Τα Πακέτα μου" },
  "fantasy.aLegendaryPack": { en: "a Legendary Pack", el: "ένα Θρυλικό Πακέτο" },
  "fantasy.legendaryPacks": { en: "Legendary Packs", el: "Θρυλικά Πακέτα" },
};
