import { Lang } from "./lang";

export const predictionsTranslations: Record<string, Record<Lang, string>> = {
  "predictions.spendPoints": { en: "Spend points", el: "Ξόδεψε πόντους" },
  "predictions.upcomingGames": { en: "Upcoming games", el: "Επερχόμενοι αγώνες" },
  "predictions.vs": { en: "vs", el: "vs" },
  "predictions.tapToClearHint": {
    en: "Tap your pick again to remove it.",
    el: "Πάτησε ξανά την επιλογή σου για να την αφαιρέσεις.",
  },
  "predictions.myPicks": { en: "My picks", el: "Οι προβλέψεις μου" },
  "predictions.loginPromptSuffix": {
    en: "to make predictions and track your accuracy.",
    el: "για να κάνεις προβλέψεις και να παρακολουθείς την πρόοδό σου.",
  },
  "predictions.perfectRoundPrefix": { en: "Perfect round! You won", el: "Τέλειος γύρος! Κέρδισες" },
  "predictions.perfectRoundSuffix": { en: "— check your", el: "— δες τη" },
  "predictions.collection": { en: "collection", el: "συλλογή σου" },
  "predictions.legendaryCards": { en: "legendary cards", el: "θρυλικές κάρτες" },
  "predictions.pts": { en: "pts", el: "πόντοι" },
  "predictions.noBadgesYet": { en: "No badges yet", el: "Δεν υπάρχουν μετάλλια ακόμα" },
  "predictions.pending": { en: "Pending", el: "Εκκρεμεί" },
  "predictions.correct": { en: "Correct", el: "Σωστό" },
  "predictions.wrong": { en: "Wrong", el: "Λάθος" },
  "predictions.noPredictionsYet": {
    en: "No predictions yet — pick a winner from any team's upcoming games list.",
    el: "Δεν υπάρχουν προβλέψεις ακόμα — διάλεξε νικητή από τη λίστα επερχόμενων αγώνων μιας ομάδας.",
  },
  "predictions.leaderboard": { en: "Leaderboard", el: "Κατάταξη" },
  "predictions.noResolvedYet": {
    en: "No resolved predictions yet.",
    el: "Δεν υπάρχουν ολοκληρωμένες προβλέψεις ακόμα.",
  },

  "predictions.hint": {
    en: "Pick a winner before tip-off. Each correct call earns 10 points, and a perfect round unlocks badges plus a bonus card.",
    el: "Διάλεξε νικητή πριν το τζάμπολ. Με κάθε σωστή πρόβλεψη κερδίζεις 10 πόντους και ένας τέλειος γύρος ξεκλειδώνει μετάλλια και μια δωρεάν θρυλική κάρτα.",
  },

  // Badge legend — a tap-to-open key explaining every badge glyph (locked
  // ones included), since hover-only titles never reach mobile touch.
  // Label/description text mirrors backend/src/routes/predictions.ts's
  // BADGES array; keep the two in sync if a badge rule ever changes.
  "predictions.whatDoTheseMean": { en: "What do these mean?", el: "Τι σημαίνουν αυτά;" },
  "predictions.hideBadgeLegend": { en: "Hide", el: "Απόκρυψη" },
  "predictions.badge.first-call.label": { en: "First Call", el: "Πρώτη Πρόβλεψη" },
  "predictions.badge.first-call.description": {
    en: "Made your first prediction.",
    el: "Έκανες την πρώτη σου πρόβλεψη.",
  },
  "predictions.badge.on-a-roll.label": { en: "On a Roll", el: "Σερί Νικών" },
  "predictions.badge.on-a-roll.description": {
    en: "5 correct predictions in a row.",
    el: "5 σωστές προβλέψεις στη σειρά.",
  },
  "predictions.badge.perfect-round.label": { en: "Perfect Round", el: "Τέλειος Γύρος" },
  "predictions.badge.perfect-round.description": {
    en: "Got every prediction right in a single round.",
    el: "Πέτυχες όλες τις προβλέψεις σου σε έναν γύρο.",
  },
  "predictions.badge.century.label": { en: "Century", el: "Εκατοντάδα" },
  "predictions.badge.century.description": {
    en: "Earned 100+ points from predictions.",
    el: "Κέρδισες 100+ πόντους από προβλέψεις.",
  },
  "predictions.badge.sharpshooter.label": { en: "Sharpshooter", el: "Σκοπευτής" },
  "predictions.badge.sharpshooter.description": {
    en: "75%+ accuracy across at least 10 resolved predictions.",
    el: "75%+ ακρίβεια σε τουλάχιστον 10 ολοκληρωμένες προβλέψεις.",
  },

  // features/predictions-analytics/ — community-wide pick accuracy, linked
  // from the main Predictions page.
  "predictions.analytics.navTitle": { en: "See how the clutchers predict", el: "Δες πως προβλέπουν οι clutchers" },
  "predictions.analytics.title": { en: "Pick Accuracy", el: "Ακρίβεια Προβλέψεων" },
  "predictions.analytics.subtitle": {
    en: "How good is the crowd at picking winners?",
    el: "Πόσο καλά διαλέγει νικητές το κοινό;",
  },
  "predictions.analytics.overallAccuracy": { en: "Community accuracy", el: "Ακρίβεια κοινού" },
  "predictions.analytics.resolvedPicksLabel": { en: "resolved picks", el: "ολοκληρωμένες προβλέψεις" },
  "predictions.analytics.byTeamTitle": { en: "When the crowd picks…", el: "Όταν το κοινό διαλέγει…" },
  "predictions.analytics.byTeamHint": {
    en: "How often a team wins after being picked to win.",
    el: "Πόσο συχνά μια ομάδα κερδίζει αφού επιλεγεί ως νικήτρια.",
  },
  "predictions.analytics.colTeam": { en: "Team", el: "Ομάδα" },
  "predictions.analytics.colPicked": { en: "Picked", el: "Επιλογές" },
  "predictions.analytics.colAccuracy": { en: "Accuracy", el: "Ακρίβεια" },
  "predictions.analytics.noTeamData": {
    en: "Not enough resolved games yet.",
    el: "Δεν υπάρχουν αρκετοί ολοκληρωμένοι αγώνες ακόμα.",
  },
  "predictions.analytics.upsetsTitle": { en: "Biggest Upsets", el: "Μεγαλύτερες Ανατροπές" },
  "predictions.analytics.upsetsHint": {
    en: "Games where most of the crowd picked wrong.",
    el: "Αγώνες όπου οι περισσότεροι διάλεξαν λάθος νικητή.",
  },
  "predictions.analytics.noUpsetsYet": {
    en: "No upsets yet — the crowd's been right so far.",
    el: "Καμία ανατροπή ακόμα — το κοινό έχει πέσει μέσα μέχρι στιγμής.",
  },
  "predictions.analytics.pickedThem": { en: "picked them", el: "τους διάλεξαν" },
};
