import { Lang } from "./lang";

// Copy for the multi-page "Take a tour" walkthrough (shared/tour-overlay.ts,
// core/tour/). Step bodies are written so they still read fine as a
// centered card with no spotlight, since a step's target can fall back to
// that (see TourService) for a guest or a slow/empty page.
export const tourTranslations: Record<string, Record<Lang, string>> = {
  "tour.takeTour": { en: "Take a tour", el: "Ξενάγηση" },
  "tour.stepLabel": { en: "Step", el: "Βήμα" },
  "tour.next": { en: "Next", el: "Επόμενο" },
  "tour.back": { en: "Back", el: "Πίσω" },
  "tour.skip": { en: "Skip tour", el: "Παράλειψη" },
  "tour.finish": { en: "Finish", el: "Τέλος" },
  "tour.cta.register": { en: "Create free account", el: "Δημιούργησε δωρεάν λογαριασμό" },

  "tour.step.welcome.title": { en: "Welcome to Clutch", el: "Καλώς ήρθες στο Clutch" },
  "tour.step.welcome.body": {
    en: "A quick tour of the app — standings, win/loss predictions, and the points-powered cards economy. Hit Next to walk through it.",
    el: "Μια σύντομη ξενάγηση στην εφαρμογή — βαθμολογία, προβλέψεις νίκης/ήττας και η οικονομία καρτών με πόντους. Πάτα Επόμενο για να ξεκινήσουμε.",
  },

  "tour.step.predictions.title": { en: "Predict winners, earn points", el: "Πρόβλεψε νικητές, κέρδισε πόντους" },
  "tour.step.predictions.body": {
    en: "Pick a winner before tip-off. Each correct call is worth 10 points, and a perfect round earns a free legendary card.",
    el: "Διάλεξε νικητή πριν την έναρξη. Κάθε σωστή πρόβλεψη αξίζει 10 πόντους, και μια τέλεια αγωνιστική χαρίζει μια δωρεάν θρυλική κάρτα.",
  },

  "tour.step.leagues.title": { en: "Compete with friends", el: "Διαγωνίσου με φίλους" },
  "tour.step.leagues.body": {
    en: "Create a private league or join one with an invite code — the same prediction points rank you here, just against a smaller group of friends.",
    el: "Δημιούργησε ένα ιδιωτικό league ή μπες σε ένα με κωδικό πρόσκλησης — οι ίδιοι πόντοι προβλέψεων σε κατατάσσουν εδώ, απλά ανάμεσα σε μια μικρότερη παρέα φίλων.",
  },

  "tour.step.cards.title": { en: "The Cards hub", el: "Ο κόμβος Κάρτες" },
  "tour.step.cards.body": {
    en: "Spend those points here: open card packs, spin the daily Jump Ball wheel, or trade with other players. This is your collection.",
    el: "Ξόδεψε τους πόντους σου εδώ: άνοιξε πακέτα καρτών, γύρισε τον καθημερινό τροχό Jump Ball, ή αντάλλαξε με άλλους παίκτες. Αυτή είναι η συλλογή σου.",
  },

  "tour.step.storeCards.title": { en: "Browse the collection", el: "Περιήγηση στη συλλογή" },
  "tour.step.storeCards.body": {
    en: "Every collectible card in Clutch lives here — filter by team or tier, and see at a glance which ones you've already unlocked.",
    el: "Όλες οι συλλεκτικές κάρτες του Clutch βρίσκονται εδώ — φίλτραρε ανά ομάδα ή σπανιότητα, και δες με μια ματιά ποιες έχεις ήδη ξεκλειδώσει.",
  },

  "tour.step.wheel.title": { en: "Jump Ball — free daily spin", el: "Jump Ball — δωρεάν καθημερινή περιστροφή" },
  "tour.step.wheel.body": {
    en: "One free spin every 24 hours, no points needed. It wins you an unopened pack — common, rare, or a guaranteed legendary.",
    el: "Μία δωρεάν περιστροφή κάθε 24 ώρες, χωρίς πόντους. Κερδίζεις ένα κλειστό πακέτο — κοινό, σπάνιο, ή εγγυημένα θρυλικό.",
  },

  "tour.step.packs.title": { en: "Open packs", el: "Άνοιξε πακέτα" },
  "tour.step.packs.body": {
    en: "Buy a pack with points for a shot at rare and legendary cards, or open one you already won from the wheel.",
    el: "Αγόρασε ένα πακέτο με πόντους για μια ευκαιρία σε σπάνιες και θρυλικές κάρτες, ή άνοιξε ένα που κέρδισες ήδη από τον τροχό.",
  },

  "tour.step.trades.title": { en: "Trade with other players", el: "Αντάλλαξε με άλλους παίκτες" },
  "tour.step.trades.body": {
    en: "Browse cards other players have listed and propose a many-for-one swap. Once you own a card yourself, list it as tradeable above to offer it back.",
    el: "Δες τις κάρτες που έχουν διαθέσει άλλοι παίκτες και πρότεινε μια ανταλλαγή πολλών προς μία. Μόλις αποκτήσεις μια κάρτα, δήλωσέ τη διαθέσιμη για ανταλλαγή παραπάνω για να την προσφέρεις κι εσύ.",
  },

  "tour.step.profile.title": { en: "Invite friends", el: "Κάλεσε φίλους" },
  "tour.step.profile.body": {
    en: "Share your referral link from Profile — once someone you invite lands a correct prediction, you get a 400-point bonus.",
    el: "Μοιράσου τον σύνδεσμο παραπομπής σου από το Προφίλ — μόλις κάποιος που κάλεσες πετύχει μια σωστή πρόβλεψη, κερδίζεις μπόνους 400 πόντων.",
  },

  "tour.step.guestCta.title": { en: "There's more once you're in", el: "Υπάρχουν πολλά περισσότερα μόλις συνδεθείς" },
  "tour.step.guestCta.body": {
    en: "Log in to earn points from predictions, spin the daily Jump Ball, open packs, trade cards, and invite friends for bonus points. It's free — takes a minute.",
    el: "Συνδέσου για να κερδίζεις πόντους από τις προβλέψεις, να γυρίζεις τον καθημερινό τροχό Jump Ball, να ανοίγεις πακέτα, να ανταλλάσσεις κάρτες και να καλείς φίλους για μπόνους πόντους. Είναι δωρεάν — παίρνει ένα λεπτό.",
  },

  "tour.step.done.title": { en: "That's Clutch", el: "Αυτό είναι το Clutch" },
  "tour.step.done.body": {
    en: "You've seen the whole loop: predict, earn, open, trade. And there's plenty more to explore — standings, league-wide stats, player comparisons, news, and the full schedule. Jump back in anytime — this tour is one tap away on the dashboard.",
    el: "Είδες όλο τον κύκλο: πρόβλεψε, κέρδισε, άνοιξε, αντάλλαξε. Υπάρχουν όμως κι άλλα πολλά να ανακαλύψεις — βαθμολογία, στατιστικά όλου του πρωταθλήματος, συγκρίσεις παικτών, νέα, και το πλήρες πρόγραμμα. Ξαναμπές όποτε θες — αυτή η ξενάγηση είναι πάντα διαθέσιμη στο dashboard.",
  },
};
