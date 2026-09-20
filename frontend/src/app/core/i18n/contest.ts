import { Lang } from "./lang";

// The €100 "first to complete the album" cash prize (2026-09-20) — one
// shared dictionary rather than duplicating this copy per feature file,
// since the exact same terms (split, deadline) are shown on three different
// pages (the /welcome landing page, the dashboard, and Album itself) and
// should only ever need updating in one place.
export const contestTranslations: Record<string, Record<Lang, string>> = {
  "contest.prizeTagline": { en: "€100 CASH PRIZE", el: "ΕΠΑΘΛΟ €100" },
  "contest.prizeTitle": {
    en: "Be first to complete the album — win real money",
    el: "Γίνε ο πρώτος που θα ολοκληρώσει το άλμπουμ — κέρδισε πραγματικά χρήματα",
  },
  "contest.prizeBody": {
    en: "The first 3 Clutchers to fully complete the collectibles album this season split a €100 cash prize — €50 for 1st, €30 for 2nd, €20 for 3rd. Runs through the end of the 2026-27 season.",
    el: "Οι πρώτοι 3 Clutchers που θα ολοκληρώσουν πλήρως το άλμπουμ συλλεκτικών φέτος μοιράζονται έπαθλο €100 — €50 για το 1ο, €30 για το 2ο, €20 για το 3ο. Ισχύει μέχρι το τέλος της σεζόν 2026-27.",
  },
  "contest.prizeCta": { en: "Check your progress", el: "Δες την πρόοδό σου" },
};
