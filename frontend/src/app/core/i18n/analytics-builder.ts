import { Lang } from "./lang";

// The analytics builder (frontend/src/app/features/analytics-builder/) — a
// user's saved custom stat tables: pick players + columns, save, view as a
// sortable table. Free (not points-gated).
export const analyticsBuilderTranslations: Record<string, Record<Lang, string>> = {
  "builder.navTitle": { en: "Builder", el: "Δημιουργός" },
  "builder.title": { en: "Analytics Builder", el: "Δημιουργός Στατιστικών" },
  "builder.subtitle": {
    en: "Build your own stat table — pick the players and columns you actually care about, save it, come back anytime.",
    el: "Φτιάξε τον δικό σου πίνακα στατιστικών — διάλεξε τους παίκτες και τις στήλες που σε ενδιαφέρουν, αποθήκευσέ τον, επίστρεψε όποτε θες.",
  },
  "builder.loginPrompt": { en: "to build and save your own stat tables.", el: "για να φτιάξεις και να αποθηκεύσεις τους δικούς σου πίνακες στατιστικών." },
  "builder.newView": { en: "New view", el: "Νέα προβολή" },
  "builder.editView": { en: "Edit view", el: "Επεξεργασία προβολής" },
  "builder.empty": { en: "No saved views yet — build your first one.", el: "Δεν υπάρχουν αποθηκευμένες προβολές ακόμα — φτιάξε την πρώτη σου." },
  "builder.playersCount": { en: "players", el: "παίκτες" },
  "builder.columnsCount": { en: "columns", el: "στήλες" },
  "builder.nameLabel": { en: "Name", el: "Όνομα" },
  "builder.namePlaceholder": { en: "e.g. My watchlist", el: "π.χ. Η λίστα μου" },
  "builder.playersLabel": { en: "Players", el: "Παίκτες" },
  "builder.templatesLabel": { en: "Quick templates", el: "Γρήγορα πρότυπα" },
  "builder.templateGuards": { en: "Top 5 Guards", el: "Κορυφαίοι 5 Γκαρντ" },
  "builder.templateForwards": { en: "Top 5 Forwards", el: "Κορυφαίοι 5 Φόργουορντ" },
  "builder.templateCenters": { en: "Top 5 Centers", el: "Κορυφαίοι 5 Σέντερ" },
  "builder.templateHint": { en: "Ranked by PIR — swap players below anytime.", el: "Κατάταξη με βάση το PIR — άλλαξε παίκτες παρακάτω όποτε θες." },
  "builder.searchPlaceholder": { en: "Search to add a player…", el: "Αναζήτηση για προσθήκη παίκτη…" },
  "builder.columnsLabel": { en: "Columns", el: "Στήλες" },
  "builder.customColumnsLabel": { en: "Custom columns", el: "Προσαρμοσμένες στήλες" },
  "builder.customColumnLabelPlaceholder": { en: "Name", el: "Όνομα" },
  "builder.customColumnExpressionPlaceholder": { en: "e.g. pointsPerGame / possessionsPerGame", el: "π.χ. pointsPerGame / possessionsPerGame" },
  "builder.addCustomColumn": { en: "+ Add custom column", el: "+ Προσθήκη προσαρμοσμένης στήλης" },
  "builder.removeCustomColumn": { en: "Remove custom column", el: "Αφαίρεση προσαρμοσμένης στήλης" },
  "builder.customColumnFieldsHint": { en: "Fields you can use: ", el: "Πεδία που μπορείς να χρησιμοποιήσεις: " },
  "builder.customColumnErrorLabel": { en: "Give this column a name.", el: "Δώσε ένα όνομα σε αυτή τη στήλη." },
  "builder.customColumnErrorLabelLength": { en: "Name is too long (max 40 characters).", el: "Το όνομα είναι πολύ μεγάλο (μέγιστο 40 χαρακτήρες)." },
  "builder.customColumnErrorExpression": { en: "Give this column a formula.", el: "Δώσε έναν τύπο σε αυτή τη στήλη." },
  "builder.save": { en: "Save view", el: "Αποθήκευση προβολής" },
  "builder.cancel": { en: "Cancel", el: "Ακύρωση" },
  "builder.delete": { en: "Delete", el: "Διαγραφή" },
  "builder.deleteConfirmPrompt": { en: "Delete this view?", el: "Διαγραφή αυτής της προβολής;" },
  "builder.deleteConfirmYes": { en: "Yes, delete", el: "Ναι, διαγραφή" },
  "builder.edit": { en: "Edit", el: "Επεξεργασία" },
  "builder.backToViews": { en: "My views", el: "Οι προβολές μου" },
  "builder.viewTable": { en: "Table", el: "Πίνακας" },
  "builder.viewChart": { en: "Chart", el: "Γράφημα" },
  "builder.formErrorIncomplete": {
    en: "Give it a name, at least one player, and at least one column.",
    el: "Δώσε ένα όνομα, τουλάχιστον έναν παίκτη και τουλάχιστον μία στήλη.",
  },

  // The "what does this mean" legend next to a saved view's name — one
  // entry per built-in column (COLUMN_LEGEND_KEYS in analytics-builder.ts).
  // Custom columns don't need an entry here; their formula text is shown
  // as-is instead.
  "builder.legendGamesPlayed": { en: "Games played this season", el: "Αγώνες που έπαιξε φέτος" },
  "builder.legendMinutesPerGame": { en: "Minutes played per game", el: "Λεπτά συμμετοχής ανά αγώνα" },
  "builder.legendPointsPerGame": { en: "Points scored per game", el: "Πόντοι ανά αγώνα" },
  "builder.legendValuation": {
    en: "Performance Index Rating — EuroLeague's overall efficiency stat",
    el: "Performance Index Rating — ο συνολικός δείκτης απόδοσης της EuroLeague",
  },
  "builder.legendTrueShootingPct": {
    en: "True shooting % — scoring efficiency counting free throws and threes",
    el: "True shooting % — επιθετική απόδοση με βολές και τρίποντα",
  },
  "builder.legendEffectiveFieldGoalPct": {
    en: "Effective field goal % — weights three-pointers appropriately",
    el: "Effective field goal % — δίνει σωστή βαρύτητα στα τρίποντα",
  },
  "builder.legendOffensiveReboundPct": {
    en: "Share of available offensive rebounds grabbed while on court",
    el: "Ποσοστό διαθέσιμων επιθετικών ριμπάουντ που μάζεψε όσο ήταν στο παρκέ",
  },
  "builder.legendDefensiveReboundPct": {
    en: "Share of available defensive rebounds grabbed while on court",
    el: "Ποσοστό διαθέσιμων αμυντικών ριμπάουντ που μάζεψε όσο ήταν στο παρκέ",
  },
  "builder.legendAssistToTurnoverRatio": { en: "Assists per turnover — playmaking efficiency", el: "Ασίστ ανά λάθος — απόδοση στη δημιουργία παιχνιδιού" },
  "builder.legendTurnoverRatio": { en: "Turnovers per 100 plays", el: "Λάθη ανά 100 φάσεις" },
  "builder.legendPossessionsPerGame": { en: "Possessions per game", el: "Κατοχές ανά αγώνα" },
  "builder.legendUsagePercentage": {
    en: "Share of the team's plays used while on court",
    el: "Ποσοστό των φάσεων της ομάδας που χρησιμοποίησε όσο ήταν στο παρκέ",
  },
  "builder.legendReboundsPerGame": { en: "Rebounds per game", el: "Ριμπάουντ ανά αγώνα" },
  "builder.legendAssistsPerGame": { en: "Assists per game", el: "Ασίστ ανά αγώνα" },
  "builder.legendStealsPerGame": { en: "Steals per game", el: "Κλεψίματα ανά αγώνα" },
  "builder.legendBlocksPerGame": { en: "Blocks per game", el: "Τάπες ανά αγώνα" },
  "builder.legendTurnoversPerGame": { en: "Turnovers per game", el: "Λάθη ανά αγώνα" },
  "builder.legendFieldGoalPct": { en: "Field goal % — all shots from the field", el: "Ποσοστό εντός πεδιάς — όλα τα σουτ από το παρκέ" },
  "builder.legendThreePointPct": { en: "Three-point %", el: "Ποσοστό τριπόντων" },
  "builder.legendFreeThrowPct": { en: "Free throw %", el: "Ποσοστό βολών" },
  "builder.legendTotalReboundPct": {
    en: "Share of all available rebounds grabbed while on court",
    el: "Ποσοστό όλων των διαθέσιμων ριμπάουντ που μάζεψε όσο ήταν στο παρκέ",
  },
  "builder.legendAssistRatio": { en: "Assists per 100 plays", el: "Ασίστ ανά 100 φάσεις" },
  "builder.legendTwoPointAttemptRate": { en: "Share of shots taken from two", el: "Ποσοστό των σουτ που ήταν δίποντα" },
  "builder.legendThreePointAttemptRate": { en: "Share of shots taken from three", el: "Ποσοστό των σουτ που ήταν τρίποντα" },
  "builder.legendFreeThrowRate": { en: "Free throw attempts relative to shots", el: "Βολές σε σχέση με τα σουτ" },

  // Short column labels for stats without an existing stats.col* key.
  "builder.stat.REB": { en: "REB", el: "ΡΙΜ" },
  "builder.stat.AST": { en: "AST", el: "ΑΣΙΣ" },
  "builder.stat.STL": { en: "STL", el: "ΚΛΕ" },
  "builder.stat.BLK": { en: "BLK", el: "ΚΟΨ" },
  "builder.stat.TOV": { en: "TOV", el: "ΛΑΘ" },
  "builder.stat.FG_PCT": { en: "FG%", el: "FG%" },
  "builder.stat.TP_PCT": { en: "3P%", el: "3P%" },
  "builder.stat.FT_PCT": { en: "FT%", el: "FT%" },
  "builder.stat.TREB_PCT": { en: "TRB%", el: "TRB%" },
  "builder.stat.AST_RATIO": { en: "AST%", el: "AST%" },
  "builder.stat.TWO_PA_RATE": { en: "2PAr", el: "2PAr" },
  "builder.stat.THREE_PA_RATE": { en: "3PAr", el: "3PAr" },
  "builder.stat.FT_RATE": { en: "FTr", el: "FTr" },

  "builder.group.scoring": { en: "Scoring", el: "Σκοράρισμα" },
  "builder.group.shooting": { en: "Shooting", el: "Σουτ" },
  "builder.group.playmaking": { en: "Playmaking", el: "Δημιουργία" },
  "builder.group.rebounding": { en: "Rebounding", el: "Ριμπάουντ" },
  "builder.group.defense": { en: "Defense", el: "Άμυνα" },
  "builder.group.usage": { en: "Usage & pace", el: "Χρήση & ρυθμός" },
};
