import { Lang } from "./lang";

// Dashboard hero + widget section labels. Stat abbreviations (PPG, PIR,
// PTS/REB/AST/STL/BLK) are left untranslated — they're internationally
// recognized short-codes, same treatment as team codes.
export const dashboardTranslations: Record<string, Record<Lang, string>> = {
  "dashboard.next": { en: "Next", el: "Επόμενο" },
  "dashboard.viewAll": { en: "ALL", el: "ΟΛΑ" },
  "dashboard.myLeagues": { en: "My Leagues", el: "Οι Λίγκες μου" },
  "dashboard.leaguesEmptyHint": {
    en: "Create a private league and compete with friends.",
    el: "Δημιούργησε μια ιδιωτική λίγκα και παίξε με τους φίλους σου.",
  },

  // Consolidated (2026-09-13) — this used to be two separate stacked
  // hints (a welcome-bonus one and a points/economy one), which read as
  // clutter/nagging right after the next-game card rather than a single
  // clear orientation. Merged into one, and fixed a real bug in the
  // process: the old welcome-bonus copy said "100-point", stale since the
  // 2026-08-25 repricing pass bumped it to 150 (backend/src/routes/
  // auth.ts's WELCOME_BONUS_POINTS) — never updated here.



  "dashboard.sponsorTag": { en: "SPONSOR", el: "ΧΟΡΗΓΟΣ" },

  // Round header (2026-10-07 dashboard redesign, round-header.ts).
  "dashboard.roundHeader.round": { en: "Round {n}", el: "Αγωνιστική {n}" },
  "dashboard.roundHeader.progress": { en: "{done} of {total} done", el: "{done} από {total} έτοιμα" },
  "dashboard.roundHeader.ready": { en: "Round {n} ready", el: "Η αγωνιστική {n} είναι έτοιμη" },
  "dashboard.roundHeader.complete": { en: "Round {n} complete", el: "Η αγωνιστική {n} ολοκληρώθηκε" },
  "dashboard.roundHeader.pointsSoFar": { en: "{n} pts so far", el: "{n} πόντοι ως τώρα" },
  "dashboard.roundHeader.points": { en: "{n} pts", el: "{n} πόντοι" },
  "dashboard.roundHeader.picksLockIn": { en: "picks lock in", el: "οι προβλέψεις κλειδώνουν σε" },
  "dashboard.roundHeader.fantasyLocksIn": { en: "fantasy locks in", el: "το fantasy κλειδώνει σε" },
  "dashboard.roundHeader.firstGameIn": { en: "first game in", el: "πρώτος αγώνας σε" },
  "dashboard.roundHeader.signUp": { en: "Sign up to play", el: "Γράψου για να παίξεις" },
  "dashboard.roundHeader.unitD": { en: "d", el: "μ" },
  "dashboard.roundHeader.unitH": { en: "h", el: "ώ" },
  "dashboard.roundHeader.error": { en: "Couldn't load this round. Try again.", el: "Δεν φόρτωσε η αγωνιστική. Δοκίμασε ξανά." },
  "dashboard.roundHeader.retry": { en: "Try again", el: "Ξανά" },
  // Round checklist (2026-10-07 dashboard redesign, round-checklist.ts).
  "dashboard.checklist.pickMany": { en: "Pick {n} more games", el: "Διάλεξε άλλους {n} αγώνες" },
  "dashboard.checklist.pickOne": { en: "Pick 1 more game", el: "Διάλεξε άλλον 1 αγώνα" },
  "dashboard.checklist.pickedOf": { en: "{done} of {total} picked", el: "{done} από {total}" },
  "dashboard.checklist.picksDone": { en: "All games picked", el: "Όλοι οι αγώνες επιλέχθηκαν" },
  "dashboard.checklist.topScorer": { en: "Pick a top scorer", el: "Διάλεξε πρώτο σκόρερ" },
  "dashboard.checklist.bonus": { en: "Bonus", el: "Μπόνους" },
  "dashboard.checklist.topScorerCount": { en: "{n} this round", el: "{n} αυτή την αγωνιστική" },
  "dashboard.checklist.topScorerDone": { en: "Top scorer picked", el: "Επέλεξες πρώτο σκόρερ" },
  "dashboard.checklist.fantasy": { en: "Set your fantasy squad", el: "Φτιάξε την ομάδα Fantasy" },
  "dashboard.checklist.fantasyDetail": { en: "Locks with the first game", el: "Κλειδώνει με τον πρώτο αγώνα" },
  "dashboard.checklist.fantasyDone": { en: "Fantasy squad saved", el: "Η ομάδα Fantasy αποθηκεύτηκε" },
  "dashboard.checklist.fantasyCarried": { en: "Carried over from round {n} · Review", el: "Μεταφέρθηκε από την αγωνιστική {n} · Έλεγξε" },
  "dashboard.checklist.fullTimeout": { en: "Full Timeout available", el: "Το τάιμ άουτ είναι διαθέσιμο" },
  "dashboard.checklist.spin": { en: "Spin the Jump Ball", el: "Γύρνα το Τζάμπολ" },
  "dashboard.checklist.spinDetail": { en: "Free packs every day", el: "Δωρεάν πακέτα κάθε μέρα" },
  "dashboard.checklist.spinDone": { en: "Jump Ball spun", el: "Το Τζάμπολ γύρισε" },
  "dashboard.checklist.spinNext": { en: "Next spin in {t}", el: "Επόμενο σε {t}" },
  "dashboard.checklist.btnPick": { en: "Pick", el: "Επιλογή" },
  "dashboard.checklist.btnChoose": { en: "Choose", el: "Διάλεξε" },
  "dashboard.checklist.btnOpen": { en: "Open", el: "Άνοιγμα" },
  "dashboard.checklist.btnSpin": { en: "Spin", el: "Γύρνα" },
  "dashboard.checklist.allSet": { en: "All set for round {n}", el: "Όλα έτοιμα για την αγωνιστική {n}" },
  "dashboard.checklist.guestStep1": { en: "Pick winners and top scorers before tip-off", el: "Διάλεξε νικητές και πρώτους σκόρερ πριν το τζάμπολ" },
  "dashboard.checklist.guestStep2": { en: "Earn points: riskier picks pay more", el: "Κέρδισε πόντους: οι πιο ρισκαδόρικες επιλογές δίνουν περισσότερους" },
  "dashboard.checklist.guestStep3": { en: "Spend them on card packs and climb the leaderboard", el: "Ξόδεψέ τους σε πακέτα καρτών και ανέβα στην κατάταξη" },
  "dashboard.checklist.guestCta": { en: "Create free account", el: "Δημιούργησε δωρεάν λογαριασμό" },
  // League block (2026-10-07 dashboard redesign, league-block.ts).
  "dashboard.league.title": { en: "League", el: "Λίγκα" },
  "dashboard.league.news": { en: "News", el: "Ειδήσεις" },
  "dashboard.league.standings": { en: "Standings", el: "Βαθμολογία" },
  "dashboard.league.stats": { en: "Stats", el: "Στατιστικά" },
};
