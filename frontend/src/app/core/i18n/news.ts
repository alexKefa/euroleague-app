import { Lang } from "./lang";

export const newsTranslations: Record<string, Record<Lang, string>> = {
  "news.title": { en: "News", el: "Νέα" },
  "news.loadError": { en: "Couldn't load news right now.", el: "Δεν ήταν δυνατή η φόρτωση των νέων αυτή τη στιγμή." },
  "news.empty": {
    en: "No articles yet — the sync may not have run.",
    el: "Δεν υπάρχουν άρθρα ακόμα — ο συγχρονισμός μπορεί να μην έχει τρέξει.",
  },
};
