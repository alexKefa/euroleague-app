import { Lang } from "./lang";

// Achievements page (2026-09-30, features/achievements).
export const achievementsTranslations: Record<string, Record<Lang, string>> = {
  "achievements.title": { en: "Achievements", el: "Επιτεύγματα" },
  "achievements.subtitle": {
    en: "Every reward you can earn and how close you are.",
    el: "Όλες οι ανταμοιβές που μπορείς να κερδίσεις και πόσο κοντά είσαι.",
  },
  "achievements.loginPrompt": { en: "Log in to track your achievements.", el: "Συνδέσου για να δεις τα επιτεύγματά σου." },
  "achievements.navLink": { en: "Achievements", el: "Επιτεύγματα" },
  "achievements.hubSub": { en: "Rewards and badges to chase", el: "Ανταμοιβές και σήματα να κυνηγήσεις" },

  "achievements.statCorrect": { en: "correct picks", el: "σωστές προβλέψεις" },
  "achievements.statRewards": { en: "rewards earned", el: "ανταμοιβές" },
  "achievements.statBadges": { en: "badges", el: "σήματα" },

  "achievements.nextRewards": { en: "Next rewards", el: "Επόμενες ανταμοιβές" },
  "achievements.milestone.rareCard": { en: "Rare card", el: "Σπάνια κάρτα" },
  "achievements.milestone.legendaryPack": { en: "Legendary Pack", el: "Θρυλικό Πακέτο" },
  "achievements.milestone.coachPack": { en: "Coach Pack", el: "Πακέτο Προπονητή" },
  "achievements.milestone.fantasyCoachCard": { en: "Your coach's card", el: "Η κάρτα του προπονητή σου" },
  "achievements.milestone.fantasyCaptainCard": { en: "Captain's rare card", el: "Σπάνια κάρτα αρχηγού" },
  // Winner and top-scorer picks both count (services/cards.ts's
  // topScorerCorrectCountSql), so the text says so.
  "achievements.milestoneHow.rareCard": {
    en: "Every 2 correct picks (winners + top scorers)",
    el: "Κάθε 2 σωστές προβλέψεις (νικητές + πρώτοι σκόρερ)",
  },
  "achievements.milestoneHow.legendaryPack": {
    en: "Every 9 correct picks (winners + top scorers)",
    el: "Κάθε 9 σωστές προβλέψεις (νικητές + πρώτοι σκόρερ)",
  },
  "achievements.milestoneHow.coachPack": {
    en: "Every 45 correct picks (winners + top scorers)",
    el: "Κάθε 45 σωστές προβλέψεις (νικητές + πρώτοι σκόρερ)",
  },
  "achievements.statCorrectHint": { en: "winners + top scorers", el: "νικητές + πρώτοι σκόρερ" },
  "achievements.milestoneHow.fantasyCoachCard": {
    en: "Every 4 Fantasy rounds your coach wins: that coach's card",
    el: "Κάθε 4 γύρους Fantasy που κερδίζει ο προπονητής σου: η κάρτα του",
  },
  "achievements.milestoneHow.fantasyCaptainCard": {
    en: "Every 3 Fantasy rounds your captain scores: his rare card",
    el: "Κάθε 3 γύρους Fantasy που σκοράρει ο αρχηγός σου: η σπάνια κάρτα του",
  },
  "achievements.pickLeft": { en: "correct pick to go", el: "σωστή πρόβλεψη ακόμα" },
  "achievements.picksLeft": { en: "correct picks to go", el: "σωστές προβλέψεις ακόμα" },
  "achievements.roundLeft": { en: "round to go", el: "γύρος ακόμα" },
  "achievements.roundsLeft": { en: "rounds to go", el: "γύροι ακόμα" },
  "achievements.earnedSoFar": { en: "Earned", el: "Κέρδισες" },

  "achievements.thisRound": { en: "Round", el: "Γύρος" },
  "achievements.roundCorrect": { en: "Correct winners this round", el: "Σωστοί νικητές σε αυτόν τον γύρο" },
  "achievements.correctArrow": { en: "correct →", el: "σωστές →" },
  "achievements.allCorrect": { en: "All correct →", el: "Όλες σωστές →" },
  "achievements.done": { en: "Done ✓", el: "Έγινε ✓" },
  "achievements.stillPossible": { en: "Still possible", el: "Ακόμα εφικτό" },
  "achievements.outOfReach": { en: "Out of reach", el: "Εκτός εμβέλειας" },
  "achievements.makePicks": { en: "Make your picks", el: "Κάνε τις προβλέψεις σου" },

  "achievements.badges": { en: "Badges", el: "Σήματα" },
  "achievements.earned": { en: "Earned", el: "Κερδίθηκε" },
  "achievements.need75": { en: "need 75%", el: "χρειάζεται 75%" },

  "achievements.moreWays": { en: "More ways to earn", el: "Περισσότεροι τρόποι να κερδίσεις" },
  "achievements.wheelHow": { en: "A free pack every day", el: "Ένα δωρεάν πακέτο κάθε μέρα" },
  "achievements.spinReady": { en: "Ready!", el: "Έτοιμο!" },
  "achievements.inviteTitle": { en: "Invite a friend", el: "Κάλεσε έναν φίλο" },
  "achievements.inviteHow": {
    en: "packs for you when they get their first correct pick",
    el: "πακέτα για σένα όταν πετύχουν την πρώτη τους σωστή πρόβλεψη",
  },
  "achievements.invited": { en: "invited", el: "προσκλήθηκαν" },
  "achievements.rewarded": { en: "rewarded", el: "σου έδωσαν πακέτα" },
  "achievements.invite": { en: "Invite", el: "Πρόσκληση" },
  "achievements.copied": { en: "Copied!", el: "Αντιγράφηκε!" },
  "achievements.inviteText": {
    en: "Join me on Clutch: predict EuroLeague games, collect cards and battle!",
    el: "Έλα στο Clutch: προβλέψεις για την EuroLeague, κάρτες και μάχες!",
  },
  "achievements.battlesHow": { en: "Win points from your friends in stat duels", el: "Κέρδισε πόντους από τους φίλους σου σε μονομαχίες" },
  "achievements.promoTitle": { en: "Promo codes", el: "Κωδικοί προσφοράς" },
  "achievements.promoHow": {
    en: "Scan a Clutch QR code at events or in our posts for bonus packs",
    el: "Σκάναρε έναν κωδικό QR του Clutch σε εκδηλώσεις ή στις αναρτήσεις μας για δώρο πακέτα",
  },

  // "Next reward" strip on Predictions.
  "achievements.nextRewardStrip": { en: "Next reward", el: "Επόμενη ανταμοιβή" },
  "achievements.seeAll": { en: "All achievements", el: "Όλα τα επιτεύγματα" },
};
