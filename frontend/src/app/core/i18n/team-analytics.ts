import { Lang } from "./lang";

// Team page analytics (2026-10-06): shot profile, lineups, on/off, clutch,
// plus the Stats page's clutch leaders card.
export const teamAnalyticsTranslations: Record<string, Record<Lang, string>> = {
  "ta.title": { en: "Analytics", el: "Ανάλυση" },
  "ta.basedOn": { en: "Based on {n} games this season", el: "Με βάση {n} αγώνες της σεζόν" },
  "ta.basedOnOne": { en: "Based on 1 game this season", el: "Με βάση 1 αγώνα της σεζόν" },
  "ta.empty": {
    en: "Analytics show up after this team's first game of the season.",
    el: "Η ανάλυση εμφανίζεται μετά τον πρώτο αγώνα της ομάδας στη σεζόν.",
  },
  "ta.failed": { en: "Couldn't load analytics.", el: "Δεν ήταν δυνατή η φόρτωση της ανάλυσης." },
  "ta.smallSample": {
    en: "Early-season sample: numbers will swing a lot until more games are played.",
    el: "Μικρό δείγμα: τα νούμερα θα αλλάζουν πολύ μέχρι να παιχτούν περισσότεροι αγώνες.",
  },

  // Shot profile
  "ta.shotProfile": { en: "Shot profile", el: "Προφίλ σουτ" },
  "ta.shotProfileHint": {
    en: "Where the team shoots from and how well, against the league average.",
    el: "Από πού σουτάρει η ομάδα και με τι ποσοστό, σε σχέση με τον μέσο όρο της λίγκας.",
  },
  "ta.zone.rim": { en: "At the rim", el: "Κάτω από το καλάθι" },
  "ta.zone.paint": { en: "Paint", el: "Ρακέτα" },
  "ta.zone.mid": { en: "Mid-range", el: "Μέση απόσταση" },
  "ta.zone.corner3": { en: "Corner 3", el: "Τρίποντο γωνίας" },
  "ta.zone.above3": { en: "Above-the-break 3", el: "Τρίποντο από κορυφή/πλάγια" },
  "ta.ofShots": { en: "of shots", el: "των σουτ" },
  "ta.avg": { en: "avg", el: "μ.ό." },

  // Lineups
  "ta.lineups": { en: "Most-used lineups", el: "Πιο συχνές πεντάδες" },
  "ta.lineupsHint": {
    en: "Net rating = point difference per 100 possessions with that five on court.",
    el: "Net rating = διαφορά πόντων ανά 100 κατοχές με αυτή την πεντάδα στο παρκέ.",
  },
  "ta.min": { en: "MIN", el: "ΛΕΠ" },
  "ta.gp": { en: "GP", el: "ΑΓ" },
  "ta.net": { en: "Net", el: "Net" },
  "ta.noLineups": { en: "No lineup data yet.", el: "Δεν υπάρχουν ακόμα δεδομένα πεντάδων." },

  // On/off
  "ta.onOff": { en: "On / off court", el: "Μέσα / έξω από το παρκέ" },
  "ta.onOffHint": {
    en: "Team net rating with each player on the court vs on the bench. Players with 5+ minutes both ways.",
    el: "Net rating της ομάδας με κάθε παίκτη στο παρκέ και στον πάγκο. Παίκτες με 5+ λεπτά και στα δύο.",
  },
  "ta.player": { en: "Player", el: "Παίκτης" },
  "ta.on": { en: "On", el: "Μέσα" },
  "ta.off": { en: "Off", el: "Έξω" },
  "ta.diff": { en: "Diff", el: "Διαφ." },

  // Clutch
  "ta.clutch": { en: "Clutch", el: "Clutch" },
  "ta.clutchHint": {
    en: "Last 5 minutes of the 4th quarter or overtime, with the score within 5.",
    el: "Τελευταία 5 λεπτά της 4ης περιόδου ή της παράτασης, με διαφορά έως 5 πόντους.",
  },
  "ta.clutchGames": { en: "Clutch games", el: "Αγώνες clutch" },
  "ta.clutchRecord": { en: "Record", el: "Ρεκόρ" },
  "ta.clutchPoints": { en: "Points +/-", el: "Πόντοι +/-" },
  "ta.noClutch": { en: "No clutch minutes yet this season.", el: "Δεν υπάρχουν ακόμα λεπτά clutch φέτος." },
  "ta.colPTS": { en: "PTS", el: "ΠΟΝ" },
  "ta.colFG": { en: "FG", el: "ΣΟΥΤ" },
  "ta.col3P": { en: "3P", el: "3Π" },
  "ta.colFT": { en: "FT", el: "ΒΟΛ" },
  "ta.colAST": { en: "AST", el: "ΑΣΙ" },
  "ta.colTO": { en: "TO", el: "ΛΑΘ" },

  // Stats page
  "ta.clutchLeaders": { en: "Clutch leaders", el: "Κορυφαίοι στο clutch" },
  "ta.showAll": { en: "Show top 15", el: "Εμφάνιση top 15" },
  "ta.showLess": { en: "Show less", el: "Λιγότερα" },

  // Short-rest splits (2026-10-06)
  "rest.title": { en: "Rest", el: "Ξεκούραση" },
  "rest.hint": {
    en: "Short rest = 2 or fewer days since the previous game (double-round weeks). Since {s}.",
    el: "Λίγη ξεκούραση = έως 2 μέρες από τον προηγούμενο αγώνα (διπλές αγωνιστικές). Από τη σεζόν {s}.",
  },
  "rest.smallSample": {
    en: "Double-round weeks are rare, so short-rest samples are small.",
    el: "Οι διπλές αγωνιστικές είναι λίγες, οπότε τα δείγματα είναι μικρά.",
  },
  "rest.short": { en: "Short rest", el: "Λίγη ξεκούραση" },
  "rest.normal": { en: "Normal rest", el: "Κανονική ξεκούραση" },
  "rest.edge": { en: "Rested vs tired opponent", el: "Ξεκούραστη vs κουρασμένο αντίπαλο" },
  "rest.disadvantage": { en: "Tired vs rested opponent", el: "Κουρασμένη vs ξεκούραστο αντίπαλο" },
  "rest.bothShort": { en: "Both on short rest", el: "Και οι δύο με λίγη ξεκούραση" },
  "rest.record": { en: "W-L", el: "Ν-Η" },
  "rest.ppg": { en: "PPG", el: "Π/Α" },
  "rest.opp": { en: "Opp", el: "Αντ." },
  "rest.margin": { en: "+/-", el: "+/-" },
  "rest.byMatchup": { en: "By rest matchup", el: "Ανά συνδυασμό ξεκούρασης" },
  "rest.players": { en: "Players: short vs normal rest", el: "Παίκτες: λίγη vs κανονική ξεκούραση" },
  "rest.colShortGp": { en: "GP short", el: "ΑΓ λίγη" },
  "rest.colPts": { en: "PTS", el: "ΠΟΝ" },
  "rest.colPir": { en: "PIR", el: "PIR" },
  "rest.noData": { en: "No rest data yet.", el: "Δεν υπάρχουν ακόμα δεδομένα ξεκούρασης." },
  "rest.playerTitle": { en: "Rest (since {s})", el: "Ξεκούραση (από {s})" },
  "rest.fgPct": { en: "FG%", el: "FG%" },

  // Referee tracker (2026-10-06)
  "ref.title": { en: "Referees", el: "Διαιτητές" },
  "ref.subtitle": { en: "How games go with each referee", el: "Πώς κυλούν τα παιχνίδια με κάθε διαιτητή" },
  "ref.hint": {
    en: "Per game, both teams, compared with every game in the sample. Since {s}. Home − away: positive means the home team was called for more.",
    el: "Ανά αγώνα, και για τις δύο ομάδες, σε σύγκριση με όλους τους αγώνες του δείγματος. Από τη σεζόν {s}. Γηπεδούχος − φιλοξενούμενος: θετικό σημαίνει περισσότερα σφυρίγματα κατά του γηπεδούχου.",
  },
  "ref.noBias": {
    en: "Numbers vary with the teams a referee happens to work. They describe games, not intent.",
    el: "Τα νούμερα εξαρτώνται και από τις ομάδες που έτυχε να σφυρίξει κάθε διαιτητής. Περιγράφουν αγώνες, όχι προθέσεις.",
  },
  "ref.colRef": { en: "Referee", el: "Διαιτητής" },
  "ref.colGp": { en: "GP", el: "ΑΓ" },
  "ref.colFouls": { en: "Fouls", el: "Φάουλ" },
  "ref.colFta": { en: "FTA", el: "Βολές" },
  "ref.colHomeWin": { en: "Home W%", el: "Νίκες γηπ.%" },
  "ref.colFoulDiff": { en: "Fouls H−A", el: "Φάουλ Γ−Φ" },
  "ref.colFtaDiff": { en: "FTA H−A", el: "Βολές Γ−Φ" },
  "ref.league": { en: "All games", el: "Όλοι οι αγώνες" },
  "ref.minGames": { en: "10+ games", el: "10+ αγώνες" },
  "ref.all": { en: "All", el: "Όλοι" },
  "ref.empty": { en: "No referee data yet.", el: "Δεν υπάρχουν ακόμα δεδομένα διαιτητών." },
  "ref.failed": { en: "Couldn't load referee stats.", el: "Δεν ήταν δυνατή η φόρτωση των στατιστικών διαιτητών." },
  "ref.crew": { en: "Referees", el: "Διαιτητές" },
};
