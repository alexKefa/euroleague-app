import { Lang } from "./lang";

// shared/whats-new.ts — one-time "what's new" announcement toasts.
export const whatsNewTranslations: Record<string, Record<Lang, string>> = {
  "whatsNew.label": { en: "What's new", el: "Τι νέο υπάρχει" },
  "whatsNew.fantasyImport.title": {
    en: "Import your EuroLeague Fantasy team",
    el: "Φέρε την ομάδα σου από το EuroLeague Fantasy",
  },
  "whatsNew.fantasyImport.body": {
    en: "Screenshot your squad in EuroLeague Fantasy, then tap Import in Fantasy Five — we'll copy it over for you to check and save.",
    el: "Τράβηξε στιγμιότυπο της ομάδας σου στο EuroLeague Fantasy και πάτα Εισαγωγή στο Fantasy Five — θα την αντιγράψουμε για να την ελέγξεις και να την αποθηκεύσεις.",
  },
  "whatsNew.fantasyImport.cta": { en: "Try it", el: "Δοκίμασέ το" },
};
