import { Lang } from "./lang";

// shared/whats-new.ts — one-time "what's new" announcement toasts. The
// announcements themselves (in both languages) are written from the admin
// Tools page and stored in the database, not here.
export const whatsNewTranslations: Record<string, Record<Lang, string>> = {
  "whatsNew.label": { en: "What's new", el: "Τι νέο υπάρχει" },
};
