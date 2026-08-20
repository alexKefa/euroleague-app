import { Lang } from "./lang";

// App shell: top bar, side/bottom nav, profile page.
export const chromeTranslations: Record<string, Record<Lang, string>> = {
  "nav.home": { en: "Home", el: "Αρχική" },
  "nav.news": { en: "News", el: "Νέα" },
  "nav.schedule": { en: "Schedule", el: "Πρόγραμμα" },
  "nav.picks": { en: "Picks", el: "Προγνωστικά" },
  "nav.store": { en: "Store", el: "Κατάστημα" },
  "nav.profile": { en: "Profile", el: "Προφίλ" },
  "nav.login": { en: "Log in", el: "Σύνδεση" },
  "nav.register": { en: "Register", el: "Εγγραφή" },
  "nav.logout": { en: "Log out", el: "Αποσύνδεση" },
  "nav.admin": { en: "Admin", el: "Διαχειριστής" },

  "profile.backToDashboard": { en: "Dashboard", el: "Πίνακας" },
  "profile.title": { en: "Profile", el: "Προφίλ" },
  "profile.email": { en: "Email", el: "Email" },
  "profile.favoriteTeam": { en: "Favorite team", el: "Αγαπημένη ομάδα" },
  "profile.clearHint": {
    en: "Tap your team again to clear it.",
    el: "Πάτησε ξανά την ομάδα σου για να την αφαιρέσεις.",
  },
  "profile.language": { en: "Language", el: "Γλώσσα" },
  "profile.languageEnglish": { en: "English", el: "Αγγλικά" },
  "profile.languageGreek": { en: "Greek", el: "Ελληνικά" },
  "profile.logout": { en: "Log out", el: "Αποσύνδεση" },
};
