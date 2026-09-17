import { Lang } from "./lang";

// The public /welcome landing page — reached cold, via the QR card or a
// shared link, by someone with zero context on what this app even is.
export const landingTranslations: Record<string, Record<Lang, string>> = {
  "landing.tagline": { en: "Everything for EuroLeague.", el: "Τα πάντα για την Euroleague." },
  "landing.heroHeadline": {
    en: "Your team. Your colors. Your EuroLeague.",
    el: "Η ομάδα σου. Τα χρώματά σου. Η Euroleague σου.",
  },
  "landing.ctaRegister": { en: "Get started — it's free", el: "Ξεκίνα δωρεάν" },
  "landing.ctaLogin": { en: "I already have an account", el: "Έχω ήδη λογαριασμό" },

  "landing.featureTeamTitle": { en: "Made for your team", el: "Φτιαγμένο για την ομάδα σου" },
  "landing.featureTeamBody": {
    en: "Pick a favorite team and the whole app repaints itself in its colors — try it below.",
    el: "Διάλεξε αγαπημένη ομάδα και όλη η εφαρμογή ξαναβάφεται στα χρώματά της — δοκίμασέ το παρακάτω.",
  },
  "landing.featureScoresTitle": { en: "Live scores & standings", el: "Ζωντανά σκορ & βαθμολογίες" },
  "landing.featureScoresBody": {
    en: "Every game, every round, updating live — full box scores, top performers, and the complete standings table.",
    el: "Κάθε αγώνας, κάθε αγωνιστική, ζωντανά — πλήρη στατιστικά, κορυφαίες εμφανίσεις και ολόκληρος ο πίνακας βαθμολογίας.",
  },
  "landing.featurePredictionsTitle": { en: "Predictions & points", el: "Προβλέψεις & πόντοι" },
  "landing.featurePredictionsBody": {
    en: "Call the winner before tipoff, earn points weighted by real odds, climb the leaderboard, and unlock badges — completely free to play.",
    el: "Διάλεξε τον νικητή πριν την έναρξη, κέρδισε πόντους βάσει πραγματικών αποδόσεων, ανέβα στην κατάταξη και ξεκλείδωσε παράσημα — εντελώς δωρεάν.",
  },
  // "Clutch Fantasy" here, not "Fantasy Five" (the real feature's actual
  // in-app name, unchanged everywhere else — core/i18n/fantasy.ts) — this
  // landing-page pitch uses the brand-first name on request.
  "landing.featureFantasyTitle": { en: "Clutch Fantasy", el: "Clutch Fantasy" },
  "landing.featureFantasyBody": {
    en: "Build a 10-player squad plus a coach under a budget cap, set your lineup every round, and score all season long.",
    el: "Έφτιαξε ρόστερ 10 παικτών και προπονητή μέσα στο budget, όρισε τη σύνθεσή σου κάθε αγωνιστική και βαθμολογήσου όλη τη σεζόν.",
  },
  "landing.featureCardsTitle": { en: "Cards & collectibles", el: "Κάρτες & συλλεκτικά" },
  "landing.featureCardsBody": {
    en: "Spin the daily Jump Ball, open packs with your points, chase legendary pulls, and trade with other players to complete the album.",
    el: "Γύρισε τον τροχό κάθε μέρα, άνοιξε πακέτα με τους πόντους σου, κυνήγησε τις θρυλικές κάρτες και αντάλλαξε με άλλους παίκτες για να ολοκληρώσεις το άλμπουμ.",
  },
  "landing.featureLeaguesTitle": { en: "Leagues with friends", el: "Λίγκες με φίλους" },
  "landing.featureLeaguesBody": {
    en: "Create a private league, invite your friends with a link, and settle who really knows EuroLeague best.",
    el: "Δημιούργησε ιδιωτική λίγκα, κάλεσε τους φίλους σου με ένα link, και δείξε ποιος ξέρει καλύτερα από όλους την Euroleague.",
  },
  "landing.finalTitle": {
    en: "Become part of the Clutchers community",
    el: "Γίνε μέλος της κοινότητας των Clutchers",
  },
  "landing.finalCta": { en: "Become a Clutcher", el: "Γίνε Clutcher" },

  "landing.demoPrompt": {
    en: "Tap a team",
    el: "Πάτησε μια ομάδα",
  },
  "landing.mockLive": { en: "Live", el: "Ζωντανά" },
  "landing.stepPrev": { en: "Previous", el: "Προηγούμενο" },
  "landing.stepNext": { en: "Next", el: "Επόμενο" },
};
