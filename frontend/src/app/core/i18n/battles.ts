import { Lang } from "./lang";

export const battlesTranslations: Record<string, Record<Lang, string>> = {
  "battles.tab": { en: "Battles", el: "Μάχες" },
  "battles.challengeButton": { en: "Challenge", el: "Πρόκληση" },
  "battles.myBattlesTitle": { en: "Battles in this league", el: "Μάχες σε αυτή τη λίγκα" },
  "battles.emptyBattles": {
    en: "No battles yet — challenge a member above.",
    el: "Δεν υπάρχουν ακόμα μάχες — προκάλεσε ένα μέλος παραπάνω.",
  },
  "battles.status.pending": { en: "Pending", el: "Σε αναμονή" },
  "battles.status.finished": { en: "Finished", el: "Ολοκληρώθηκε" },
  "battles.status.declined": { en: "Declined", el: "Απορρίφθηκε" },
  "battles.status.cancelled": { en: "Cancelled", el: "Ακυρώθηκε" },
  "battles.wonBadge": { en: "Won", el: "Νίκη" },
  "battles.lostBadge": { en: "Lost", el: "Ήττα" },
  "battles.backToLeague": { en: "Back", el: "Πίσω" },
  "battles.goToBattles": { en: "Go to Battles", el: "Μετάβαση στις Μάχες" },
  "battles.pendingChallenges": { en: "Pending battle challenges", el: "Εκκρεμείς προκλήσεις μάχης" },
  "battles.notFound": { en: "Battle not found, or it's not yours to see.", el: "Η μάχη δεν βρέθηκε, ή δεν έχεις πρόσβαση." },

  // Card picker — shared by the "challenge" composer and accepting an
  // incoming challenge. A single card each (2026-09-22 v3).
  "battles.deckPickerTitle": { en: "Pick your card", el: "Διάλεξε την κάρτα σου" },
  "battles.deckPickerHint": {
    en: "One card each, resolved instantly — the stronger card is favored but never a sure thing. No risk: you keep your card no matter who wins. Coach cards can't be picked.",
    el: "Μία κάρτα ο καθένας, με άμεσο αποτέλεσμα — η πιο δυνατή κάρτα ευνοείται αλλά ποτέ δεν είναι σίγουρη. Καμία απώλεια: κρατάς την κάρτα σου ανεξαρτήτως αποτελέσματος. Οι κάρτες προπονητή δεν μπορούν να επιλεγούν.",
  },
  "battles.deckPickerEmpty": {
    en: "You need at least 1 non-coach card to battle. Open some packs first!",
    el: "Χρειάζεσαι τουλάχιστον 1 κάρτα (εκτός προπονητή) για να παίξεις. Άνοιξε μερικά πακέτα πρώτα!",
  },
  "battles.confirmChallenge": { en: "Send challenge", el: "Αποστολή πρόκλησης" },
  "battles.sending": { en: "Sending…", el: "Αποστολή…" },
  "battles.acceptButton": { en: "Accept & duel", el: "Αποδοχή & μονομαχία" },
  "battles.accepting": { en: "Dueling…", el: "Μονομαχία…" },
  "battles.theirCardLabel": { en: "Their card", el: "Η κάρτα τους" },
  "battles.powerAbbrev": { en: "PWR", el: "ΙΣΧ" },
  "battles.winChanceLabel": { en: "Your win chance", el: "Πιθανότητα νίκης" },
  "battles.ptsIfWin": { en: "pts if you win", el: "πόντοι αν κερδίσεις" },
  "battles.ptsIfLose": { en: "pts if you lose", el: "πόντοι αν χάσεις" },
  "battles.declineButton": { en: "Decline", el: "Απόρριψη" },
  "battles.cancelButton": { en: "Cancel challenge", el: "Ακύρωση πρόκλησης" },
  "battles.waitingForOpponent": { en: "Waiting for them to accept…", el: "Αναμονή αποδοχής…" },
  "battles.challengeFailed": { en: "Failed to send challenge.", el: "Η αποστολή της πρόκλησης απέτυχε." },
  "battles.acceptFailed": { en: "Failed to accept battle.", el: "Η αποδοχή της μάχης απέτυχε." },

  // Stake (2026-09-22 fix — the win reward used to be minted from nothing,
  // a real infinite-farming exploit; now it's a genuine points transfer
  // from the loser, so both sides need to actually be able to cover it —
  // and 2026-09-23: variable, not flat, scaled by how big an underdog the
  // winner was, same odds-weighted shape as predictions' own points).
  "battles.stakeLabel": { en: "Stake", el: "Στοίχημα" },
  "battles.yourPointsLabel": { en: "Your points", el: "Οι πόντοι σου" },
  "battles.insufficientPoints": {
    en: "You need more points to duel — win some predictions or open fewer packs first.",
    el: "Χρειάζεσαι περισσότερους πόντους για μονομαχία — κέρδισε μερικές προβλέψεις ή άνοιξε λιγότερα πακέτα πρώτα.",
  },
  "battles.challengerInsufficientPoints": {
    en: "The challenger no longer has enough points to cover this duel.",
    el: "Ο προκαλών δεν έχει πλέον αρκετούς πόντους για αυτή τη μονομαχία.",
  },

  // 3D reveal (2026-09-22 v3) — cards fly in and clash, the loser flips
  // face-down, the winner is highlighted. Plain CSS 3D transforms, no
  // library.
  "battles.vsLabel": { en: "vs", el: "εναντίον" },
  "battles.youWon": { en: "You won the duel!", el: "Κέρδισες τη μονομαχία!" },
  "battles.youLost": { en: "You lost the duel.", el: "Έχασες τη μονομαχία." },
  "battles.ptsSuffix": { en: "pts", el: "πόντοι" },

  // "How duels work" info popup (2026-09-23, features/battles/battles-info.ts)
  // — plain-language version of the mechanic (services/battles.ts's
  // computeCardPowers/resolveDuel/computeStakeForWinProb).
  "battles.howItWorksTitle": { en: "How duels work", el: "Πώς λειτουργούν οι μονομαχίες" },
  "battles.howItWorksStep1": {
    en: "Each card's strength comes from its rarity plus the real player's current form (their actual PIR this season) — a legendary with a rough season and a common on a hot streak can be closer than you'd think.",
    el: "Η δύναμη κάθε κάρτας προέρχεται από τη σπανιότητά της και την πραγματική φόρμα του παίκτη (το πραγματικό του PIR φέτος) — μια θρυλική κάρτα σε κακή σεζόν και μια κοινή σε φόρμα μπορεί να είναι πιο κοντά απ' όσο νομίζεις.",
  },
  "battles.howItWorksStep2": {
    en: "The stronger card is favored to win, but it's a weighted coin flip, not a sure thing — an underdog can always pull off the upset.",
    el: "Η πιο δυνατή κάρτα ευνοείται να κερδίσει, αλλά είναι ζυγισμένο στρίψιμο νομίσματος, όχι σίγουρο πράγμα — το φαβορί μπορεί πάντα να ηττηθεί.",
  },
  "battles.howItWorksStep3": {
    en: "The reward scales with the upset: winning as the favorite pays close to the base stake, winning as the underdog pays much more.",
    el: "Η ανταμοιβή κλιμακώνεται με την έκπληξη: η νίκη ως φαβορί πληρώνει κοντά στο βασικό στοίχημα, η νίκη ως αουτσάιντερ πληρώνει πολύ περισσότερο.",
  },
  "battles.howItWorksStep4": {
    en: "No risk to your card — only points change hands. You need enough points to cover what you could lose before you can challenge or accept.",
    el: "Καμία απώλεια για την κάρτα σου — μόνο πόντοι αλλάζουν χέρια. Χρειάζεσαι αρκετούς πόντους για να καλύψεις ό,τι μπορεί να χάσεις πριν προκαλέσεις ή αποδεχτείς.",
  },

  // Global real-time challenge toast (2026-09-22) — app.component.html,
  // pops up over whatever page you're on the instant a challenge arrives.
  "battles.toastChallenged": { en: "challenged you to a duel!", el: "σε προκάλεσε σε μονομαχία!" },
  "battles.toastView": { en: "View challenge", el: "Προβολή πρόκλησης" },
};
