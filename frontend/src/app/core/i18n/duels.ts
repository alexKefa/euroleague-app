import { Lang } from "./lang";

// Four Quarters duels (Battles v6). Hub, builder, game screen and toast copy.
export const duelsTranslations: Record<string, Record<Lang, string>> = {
  // Categories (spec table).
  "duels.cat.scoring": { en: "Scoring", el: "Σκοράρισμα" },
  "duels.cat.boards": { en: "Boards", el: "Ριμπάουντ" },
  "duels.cat.playmaking": { en: "Playmaking", el: "Δημιουργία" },
  "duels.cat.defense": { en: "Defense", el: "Άμυνα" },
  "duels.cat.efficiency": { en: "Efficiency", el: "Αξιολόγηση" },
  "duels.cat.all_around": { en: "All-around", el: "Ολοκληρωμένος" },

  // Divisions.
  "duels.div.rookie": { en: "Rookie", el: "Πρωτάρης" },
  "duels.div.starter": { en: "Starter", el: "Βασικός" },
  "duels.div.sixth_man": { en: "Sixth Man", el: "Έκτος Παίκτης" },
  "duels.div.all_star": { en: "All-Star", el: "Ολ-Σταρ" },
  "duels.div.mvp": { en: "MVP", el: "MVP" },

  // Form badges.
  "duels.form.ice_cold": { en: "Ice cold", el: "Παγωμένος" },
  "duels.form.cold": { en: "Cold", el: "Κρύος" },
  "duels.form.steady": { en: "Steady", el: "Σταθερός" },
  "duels.form.hot": { en: "Hot", el: "Καυτός" },
  "duels.form.on_fire": { en: "On fire", el: "Φλέγεται" },

  // Hub.
  "duels.title": { en: "Four Quarters", el: "Τέσσερα Δεκάλεπτα" },
  "duels.loginToPlay": { en: "Log in to play duels.", el: "Συνδέσου για να παίξεις μονομαχίες." },
  "duels.rating": { en: "Rating", el: "Βαθμολογία" },
  "duels.monthRecord": { en: "This month", el: "Αυτόν τον μήνα" },
  "duels.paidWinsLeft": { en: "{n}/5 paid wins left today", el: "Απομένουν {n}/5 νίκες με έπαθλο σήμερα" },
  "duels.tab.games": { en: "Games", el: "Παιχνίδια" },
  "duels.tab.open": { en: "Open", el: "Ανοιχτές" },
  "duels.tab.ladder": { en: "Ladder", el: "Κατάταξη" },
  "duels.yourMove": { en: "Your move", el: "Σειρά σου" },
  "duels.waiting": { en: "Waiting", el: "Σε αναμονή" },
  "duels.waitingFor": { en: "Waiting for {name}", el: "Αναμονή για {name}" },
  "duels.finished": { en: "Finished", el: "Ολοκληρωμένα" },
  "duels.noGames": {
    en: "No duels yet. Challenge a league-mate or post an open challenge.",
    el: "Δεν έχεις μονομαχίες ακόμα. Προκάλεσε ένα μέλος της λίγκας σου ή ανάρτησε ανοιχτή πρόκληση.",
  },
  "duels.newDuel": { en: "Challenge a friend", el: "Πρόκληση σε φίλο" },
  "duels.postOpen": { en: "Post open challenge", el: "Ανοιχτή πρόκληση" },
  "duels.quarterYourMove": { en: "Q{n} · your move", el: "Δ{n} · σειρά σου" },
  "duels.quarterWaiting": { en: "Q{n} · waiting", el: "Δ{n} · αναμονή" },
  "duels.challengedYou": { en: "challenged you", el: "σε προκάλεσε" },
  "duels.openChallenge": { en: "Open challenge", el: "Ανοιχτή πρόκληση" },
  "duels.waitingForOpponent": { en: "Waiting for an opponent", el: "Αναμονή για αντίπαλο" },
  "duels.timeLeft": { en: "{t} left", el: "απομένουν {t}" },
  "duels.expired": { en: "Expired", el: "Έληξε" },
  "duels.play": { en: "Play", el: "Παίξε" },
  "duels.view": { en: "View", el: "Προβολή" },
  "duels.accept": { en: "Accept", el: "Αποδοχή" },
  "duels.cancel": { en: "Cancel", el: "Ακύρωση" },
  "duels.legacyBattle": { en: "Old battle", el: "Παλιά μάχη" },
  "duels.win": { en: "Won", el: "Νίκη" },
  "duels.loss": { en: "Lost", el: "Ήττα" },
  "duels.draw": { en: "Draw", el: "Ισοπαλία" },
  "duels.winShort": { en: "W", el: "Ν" },
  "duels.lossShort": { en: "L", el: "Η" },
  "duels.drawShort": { en: "D", el: "Ι" },
  "duels.vs": { en: "vs", el: "εναντίον" },

  // Open tab.
  "duels.openEmpty": {
    en: "No open challenges right now. Post one and anyone can take it.",
    el: "Δεν υπάρχουν ανοιχτές προκλήσεις αυτή τη στιγμή. Ανάρτησε μία και οποιοσδήποτε μπορεί να τη δεχτεί.",
  },
  "duels.openRating": { en: "{n} rating", el: "βαθμολογία {n}" },
  "duels.openHint": {
    en: "Sorted by rating closest to yours.",
    el: "Ταξινομημένες με βάση την πιο κοντινή βαθμολογία στη δική σου.",
  },

  // Ladder tab.
  "duels.ladderGlobal": { en: "Global", el: "Παγκόσμια" },
  "duels.ladderEmpty": { en: "No one has played this month yet.", el: "Κανείς δεν έχει παίξει αυτόν τον μήνα ακόμα." },
  "duels.ladderYou": { en: "You", el: "Εσύ" },
  "duels.ladderMonth": { en: "Month: {season}", el: "Μήνας: {season}" },

  // Lineup builder / game screen (Tasks 7-8 reuse these).
  "duels.lineup": { en: "Lineup", el: "Σύνθεση" },
  "duels.lockLineup": { en: "Lock lineup", el: "Κλείδωμα σύνθεσης" },
  "duels.autoFill": { en: "Auto-fill best 5", el: "Αυτόματα οι καλύτεροι 5" },
  "duels.commit": { en: "Commit", el: "Επιβεβαίωση" },
  "duels.rematch": { en: "Rematch", el: "Ρεβάνς" },
  "duels.overtime": { en: "Overtime", el: "Παράταση" },
  "duels.bench": { en: "Bench", el: "Πάγκος" },
  "duels.finalScore": { en: "Full time", el: "Τελικό σκορ" },
  "duels.youWon": { en: "You won!", el: "Κέρδισες!" },
  "duels.youLost": { en: "You lost.", el: "Έχασες." },
  "duels.itsADraw": { en: "It's a draw.", el: "Ισοπαλία." },
  "duels.forfeit": { en: "Forfeit", el: "Εγκατάλειψη" },
  "duels.prizePaid": { en: "+15 points", el: "+15 πόντοι" },
  "duels.prizeLimit": { en: "Daily prize limit reached", el: "Έφτασες το ημερήσιο όριο επάθλων" },
  "duels.ratingChange": { en: "Rating {n}", el: "Βαθμολογία {n}" },

  // Lineup builder.
  "duels.builder.back": { en: "Back", el: "Πίσω" },
  "duels.builder.accepting": { en: "Accept the challenge", el: "Αποδοχή πρόκλησης" },
  "duels.builder.hint": {
    en: "Pick 5 cards, one per player. Scores include rarity, form and injury.",
    el: "Διάλεξε 5 κάρτες, μία ανά παίκτη. Τα σκορ περιλαμβάνουν σπανιότητα, φόρμα και τραυματισμό.",
  },
  "duels.builder.notEnough": {
    en: "You need at least 5 player cards to duel.",
    el: "Χρειάζεσαι τουλάχιστον 5 κάρτες παικτών για να παίξεις.",
  },
  "duels.builder.sortBy": { en: "Sort by", el: "Ταξινόμηση" },
  "duels.builder.sortTotal": { en: "Total", el: "Σύνολο" },
  "duels.builder.needMore": { en: "Pick {n} more", el: "Διάλεξε ακόμα {n}" },
  "duels.builder.samePlayer": {
    en: "You already have a card of that player in your lineup.",
    el: "Έχεις ήδη κάρτα αυτού του παίκτη στη σύνθεση.",
  },
  "duels.builder.lineupFull": {
    en: "Your lineup is full. Tap a slot to remove a card.",
    el: "Η σύνθεση είναι πλήρης. Πάτα μια θέση για να αφαιρέσεις κάρτα.",
  },

  // Errors (backend `code`).
  "duels.error.INVALID_LINEUP": {
    en: "That lineup isn't valid: pick 5 cards you own, no coaches, and no player twice.",
    el: "Η σύνθεση δεν είναι έγκυρη: διάλεξε 5 κάρτες που έχεις, χωρίς προπονητές και χωρίς τον ίδιο παίκτη δύο φορές.",
  },
  "duels.error.NOT_A_MEMBER": { en: "You're not a member of that league.", el: "Δεν είσαι μέλος αυτής της λίγκας." },
  "duels.error.TOO_MANY_DUELS": {
    en: "You already have 5 duels going. Finish one first.",
    el: "Έχεις ήδη 5 μονομαχίες σε εξέλιξη. Ολοκλήρωσε πρώτα μία.",
  },
  "duels.error.NOT_AVAILABLE": {
    en: "This challenge is no longer available.",
    el: "Αυτή η πρόκληση δεν είναι πια διαθέσιμη.",
  },
  "duels.error.QUARTER_CHANGED": {
    en: "The quarter has moved on. Refreshing.",
    el: "Το δεκάλεπτο προχώρησε. Γίνεται ανανέωση.",
  },
  "duels.error.SLOT_USED": { en: "You've already played that card.", el: "Έχεις ήδη παίξει αυτή την κάρτα." },
  "duels.error.NOT_PARTICIPANT": { en: "This isn't your duel.", el: "Αυτή δεν είναι δική σου μονομαχία." },
  "duels.error.NOT_FOUND": { en: "Duel not found.", el: "Η μονομαχία δεν βρέθηκε." },
  "duels.error.INVALID_SLOT": { en: "That card can't be played.", el: "Αυτή η κάρτα δεν μπορεί να παιχτεί." },
  "duels.error.INVALID_REQUEST_BODY": { en: "Something was wrong with the request.", el: "Κάτι δεν πήγε καλά με το αίτημα." },
  "duels.error.generic": { en: "Something went wrong. Try again.", el: "Κάτι πήγε στραβά. Δοκίμασε ξανά." },

  // Global toast (shared/battle-challenge-toast) and nav badge.
  "duels.toastChallenged": { en: "challenged you to a duel!", el: "σε προκάλεσε σε μονομαχία!" },
  "duels.toastYourMove": { en: "Your move in your duel", el: "Σειρά σου στη μονομαχία" },
  "duels.toastView": { en: "Open", el: "Άνοιγμα" },
  "duels.pendingChallenges": { en: "Duels waiting on you", el: "Μονομαχίες που σε περιμένουν" },
};
