import { Lang } from "./lang";

export const gameTranslations: Record<string, Record<Lang, string>> = {
  "game.round": { en: "Round", el: "Γύρος" },
  "game.final": { en: "Final", el: "Τελικό" },
  "game.vs": { en: "vs", el: "vs" },
  "game.topPerformers": { en: "Top Performers", el: "Κορυφαίες Εμφανίσεις" },
  "game.doubleDouble": { en: "double-double", el: "double-double" },
  "game.onFire": { en: "On fire", el: "Στα κάγκελα" },
  "game.playersToWatch": { en: "Players to Watch", el: "Παίκτες να Προσέξεις" },
  "game.keyPlayer": { en: "Key player", el: "Βασικός παίκτης" },
  "game.playersWhoStoodOut": { en: "Players Who Stood Out This Season", el: "Παίκτες που Ξεχώρισαν Φέτος" },
  "game.noStatsYet": { en: "No stats yet.", el: "Δεν υπάρχουν στατιστικά ακόμα." },
  "game.noSeasonStatsYet": { en: "No season stats yet.", el: "Δεν υπάρχουν ακόμα στατιστικά σεζόν." },
  "game.teamComparison": { en: "Team Comparison", el: "Σύγκριση Ομάδων" },
  "game.teamStats": { en: "Team Stats", el: "Στατιστικά Ομάδων" },
  "game.record": { en: "Record", el: "Ρεκόρ" },
  "game.standing": { en: "Standing", el: "Θέση" },
  "game.ppg": { en: "PPG", el: "Πόντοι/Αγώνα" },
  "game.oppPpg": { en: "Opp PPG", el: "Πόντοι Αντ./Αγώνα" },
  "game.offRating": { en: "Off Rating", el: "Επιθετική Αξιολ." },
  "game.defRating": { en: "Def Rating", el: "Αμυντική Αξιολ." },
  "game.boxScore": { en: "Box Score", el: "Στατιστικά Αγώνα" },
  "game.highlights": { en: "Highlights", el: "Στιγμιότυπα" },
  "game.setHighlight": { en: "Set", el: "Ορισμός" },
  "game.playerColumn": { en: "Player", el: "Παίκτης" },

  // Box-score column headers — same abbreviations roster.ts's own colMIN/
  // colPPG/colRPG/colAPG/colPIR already use, for consistency across the app
  // rather than a second, differently-worded set for the same stats.
  "game.colMIN": { en: "MIN", el: "ΛΕΠ" },
  "game.colPTS": { en: "PTS", el: "ΠΟΝ" },
  "game.colREB": { en: "REB", el: "ΡΙΜΠ" },
  "game.colAST": { en: "AST", el: "ΑΣΙ" },
  "game.colPIR": { en: "PIR", el: "PIR" },
  // Team Stats comparison widget's own turnovers label ("TO", not player.ts's
  // "TOV") — same Greek meaning (ΛΑΘ), matching that widget's exact EN text.
  "game.colTO": { en: "TO", el: "ΛΑΘ" },
  // Shooting percentages stay untranslated in both languages — same
  // convention as roster.ts's TS%/eFG%/TOV%/USG% columns.
  "game.colFG": { en: "FG%", el: "FG%" },
  "game.colFT": { en: "FT%", el: "FT%" },
  // Free throws made/attempted, e.g. "5/7" (2026-09-29).
  "game.colFTMA": { en: "FT", el: "ΒΟΛ" },

  // Game roundup additions (2026-10-06): box score Full view, grouped Team
  // Stats, "Where the game was won".
  "game.col2P": { en: "2P", el: "2Π" },
  "game.col3P": { en: "3P", el: "3Π" },
  "game.colOR": { en: "OR", el: "ΕΠΙΘ" },
  "game.colDR": { en: "DR", el: "ΑΜ" },
  "game.colPF": { en: "PF", el: "ΦΑΟΥΛ" },
  "game.colPM": { en: "+/-", el: "+/-" },
  "game.colEFG": { en: "eFG%", el: "eFG%" },
  "game.colTS": { en: "TS%", el: "TS%" },
  "game.boxBasic": { en: "Basic", el: "Βασικά" },
  "game.boxFull": { en: "Full", el: "Πλήρη" },
  "game.groupShooting": { en: "Shooting", el: "Σουτ" },
  "game.groupRebounding": { en: "Rebounding", el: "Ριμπάουντ" },
  "game.groupBallDefense": { en: "Ball & defense", el: "Μπάλα & άμυνα" },
  "game.whereWon": { en: "Where the game was won", el: "Πού κρίθηκε ο αγώνας" },
  "game.whereBeingWon": { en: "Where it's being won", el: "Πού κρίνεται ο αγώνας" },
  "game.edge.turnovers": { en: "Turnovers", el: "Λάθη" },
  "game.edge.steals": { en: "Steals", el: "Κλεψίματα" },
  "game.edge.offReb": { en: "Offensive rebounds", el: "Επιθετικά ριμπάουντ" },
  "game.edge.reb": { en: "Rebounds", el: "Ριμπάουντ" },
  "game.edge.assists": { en: "Assists", el: "Ασίστ" },
  "game.edge.blocks": { en: "Blocks", el: "Τάπες" },
  "game.edge.threeMade": { en: "Threes made", el: "Εύστοχα τρίποντα" },
  "game.edge.threePct": { en: "3P%", el: "3Π%" },
  "game.edge.twoPct": { en: "2P%", el: "2Π%" },
  "game.edge.ftMade": { en: "Free throws made", el: "Εύστοχες βολές" },
  // {team} is the display code, {w}/{l} the winner's and loser's values.
  "game.edgeCaption.turnovers": { en: "{team}: fewer turnovers, {w} vs {l}", el: "{team}: λιγότερα λάθη, {w} έναντι {l}" },
  "game.edgeCaption.steals": { en: "{team}: more steals, {w} vs {l}", el: "{team}: περισσότερα κλεψίματα, {w} έναντι {l}" },
  "game.edgeCaption.offReb": {
    en: "{team}: won the offensive glass, {w} vs {l}",
    el: "{team}: κυριαρχία στα επιθετικά ριμπάουντ, {w} έναντι {l}",
  },
  "game.edgeCaption.reb": { en: "{team}: won the boards, {w} vs {l}", el: "{team}: κυριαρχία στα ριμπάουντ, {w} έναντι {l}" },
  "game.edgeCaption.assists": { en: "{team}: moved the ball better, {w} assists vs {l}", el: "{team}: καλύτερη κυκλοφορία, {w} ασίστ έναντι {l}" },
  "game.edgeCaption.blocks": { en: "{team}: protected the rim, {w} blocks vs {l}", el: "{team}: προστασία ρακέτας, {w} τάπες έναντι {l}" },
  "game.edgeCaption.threeMade": { en: "{team}: won from deep, {w} threes vs {l}", el: "{team}: διαφορά από τα 6,75, {w} τρίποντα έναντι {l}" },
  "game.edgeCaption.threePct": { en: "{team}: hotter from three, {w} vs {l}", el: "{team}: καλύτερο τρίποντο, {w} έναντι {l}" },
  "game.edgeCaption.twoPct": { en: "{team}: more efficient inside, {w} vs {l} on twos", el: "{team}: καλύτερη ευστοχία στα δίποντα, {w} έναντι {l}" },
  "game.edgeCaption.ftMade": { en: "{team}: won at the line, {w} free throws vs {l}", el: "{team}: διαφορά στις βολές, {w} έναντι {l}" },
  "game.legend2P": { en: "Two-pointers made/attempted", el: "Εύστοχα/συνολικά δίποντα" },
  "game.legend3P": { en: "Three-pointers made/attempted", el: "Εύστοχα/συνολικά τρίποντα" },
  "game.legendOR": { en: "Offensive rebounds", el: "Επιθετικά ριμπάουντ" },
  "game.legendDR": { en: "Defensive rebounds", el: "Αμυντικά ριμπάουντ" },
  "game.legendSTL": { en: "Steals", el: "Κλεψίματα" },
  "game.legendBLK": { en: "Blocks", el: "Τάπες" },
  "game.legendTO": { en: "Turnovers", el: "Λάθη" },
  "game.legendPF": { en: "Personal fouls", el: "Προσωπικά φάουλ" },
  "game.legendPM": { en: "Point differential while on court", el: "Διαφορά πόντων όσο ήταν στο παρκέ" },

  // Glossary entries for shared/stat-legend.ts, box-score columns.
  "game.legendMIN": { en: "Minutes played", el: "Λεπτά συμμετοχής" },
  "game.legendPTS": { en: "Points", el: "Πόντοι" },
  "game.legendREB": { en: "Rebounds", el: "Ριμπάουντ" },
  "game.legendAST": { en: "Assists", el: "Ασίστ" },
  "game.legendFTMA": { en: "Free throws made/attempted", el: "Εύστοχες/συνολικές βολές" },
  "game.legendPIR": {
    en: "Performance Index Rating — EuroLeague's overall efficiency stat",
    el: "Performance Index Rating — ο συνολικός δείκτης απόδοσης της EuroLeague",
  },
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

  // "Other live games" quick-view dialog (2026-09-24).
  "game.topScorers": { en: "Top scorers", el: "Κορυφαίοι σκόρερ" },
  "game.pointsByQuarter": { en: "Points by quarter", el: "Πόντοι ανά περίοδο" },
  "game.viewFullGame": { en: "View full game", el: "Πλήρης αγώνας" },
  "game.couldntLoadGame": { en: "Couldn't load this game.", el: "Δεν ήταν δυνατή η φόρτωση του αγώνα." },

  // Live redesign (2026-09-25): momentum bar + scoring feed, both derived
  // client-side from the SSE scoringEvents stream — see events.service.ts.
  "game.momentum": { en: "Momentum", el: "Δυναμική" },
  "game.liveFeed": { en: "Live Feed", el: "Ζωντανή Ροή" },
  "game.watchingForNextBasket": {
    en: "Watching for the next basket…",
    el: "Αναμονή για το επόμενο καλάθι…",
  },
};
