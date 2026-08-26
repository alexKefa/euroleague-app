import { Lang } from "./lang";

export const newsTranslations: Record<string, Record<Lang, string>> = {
  "news.title": { en: "News", el: "Νέα" },
  "news.loadError": { en: "Couldn't load news right now.", el: "Δεν ήταν δυνατή η φόρτωση των νέων αυτή τη στιγμή." },
  "news.empty": {
    en: "No articles yet — the sync may not have run.",
    el: "Δεν υπάρχουν άρθρα ακόμα — ο συγχρονισμός μπορεί να μην έχει τρέξει.",
  },
  "news.previewAriaPrefix": { en: "Open article:", el: "Άνοιγμα άρθρου:" },
  "news.closePreview": { en: "Close article", el: "Κλείσιμο άρθρου" },
  "news.readFullArticle": { en: "Read full article", el: "Διάβασε ολόκληρο το άρθρο" },
  "news.lastUpdated": { en: "Updated", el: "Ενημερώθηκε" },
  "news.justNow": { en: "just now", el: "μόλις τώρα" },
  "news.minAgo": { en: "min ago", el: "λεπτά πριν" },
  "news.hAgo": { en: "h ago", el: "ώρες πριν" },
  "news.dAgo": { en: "d ago", el: "μέρες πριν" },
  "news.allSources": { en: "All sources", el: "Όλες οι πηγές" },
  "news.previousStory": { en: "Previous story", el: "Προηγούμενη ιστορία" },
  "news.nextStory": { en: "Next story", el: "Επόμενη ιστορία" },
};
