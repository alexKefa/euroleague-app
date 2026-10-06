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
};
