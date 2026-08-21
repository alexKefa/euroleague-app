import { Lang } from "./lang";

// App shell: top bar, side/bottom nav, profile page.
export const chromeTranslations: Record<string, Record<Lang, string>> = {
  "nav.home": { en: "Home", el: "Αρχική" },
  "nav.news": { en: "News", el: "Νέα" },
  "nav.schedule": { en: "Schedule", el: "Πρόγραμμα" },
  "nav.picks": { en: "Picks", el: "Προγνωστικά" },
  "nav.cards": { en: "Cards", el: "Κάρτες" },
  "nav.profile": { en: "Profile", el: "Προφίλ" },
  "nav.login": { en: "Log in", el: "Σύνδεση" },
  "nav.register": { en: "Register", el: "Εγγραφή" },
  "nav.logout": { en: "Log out", el: "Αποσύνδεση" },
  "nav.admin": { en: "Admin", el: "Διαχειριστής" },
  "nav.switchToLightTheme": { en: "Switch to light theme", el: "Εναλλαγή σε φωτεινό θέμα" },
  "nav.switchToDarkTheme": { en: "Switch to dark theme", el: "Εναλλαγή σε σκοτεινό θέμα" },
  "nav.switchToGreek": { en: "Switch to Greek", el: "Αλλαγή σε Ελληνικά" },
  "nav.switchToEnglish": { en: "Switch to English", el: "Αλλαγή σε Αγγλικά" },

  // shared/page-hint.ts — dismiss button, reused across every page hint.
  "hint.dismiss": { en: "Dismiss", el: "Απόρριψη" },

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
  "profile.saveTeamFailed": {
    en: "Couldn't update your favorite team — try again.",
    el: "Δεν ήταν δυνατή η ενημέρωση της αγαπημένης σου ομάδας — δοκίμασε ξανά.",
  },

  // Admin-only tools, consolidated here rather than scattered across the
  // pages they act on (except the wheel's cheat-spin, which stays there).
  "profile.adminSectionTitle": { en: "Admin tools", el: "Εργαλεία διαχειριστή" },
  "profile.userEmailPlaceholder": { en: "User email", el: "Email χρήστη" },
  "profile.grantedPrefix": { en: "Granted", el: "Δόθηκαν" },

  "profile.grantPointsTitle": { en: "Grant points", el: "Παραχώρηση πόντων" },
  "profile.pointsPlaceholder": { en: "Points", el: "Πόντοι" },
  "profile.reasonPlaceholder": { en: "Reason", el: "Αιτιολογία" },
  "profile.granting": { en: "Granting…", el: "Παραχώρηση…" },
  "profile.grant": { en: "Grant", el: "Παραχώρηση" },
  "profile.grantedPointsTo": { en: "pts to", el: "πόντοι στον/στην" },
  "profile.grantPointsFailed": { en: "Failed to grant points.", el: "Αποτυχία παραχώρησης πόντων." },

  "profile.grantCardTitle": { en: "Grant a card", el: "Παραχώρηση κάρτας" },
  "profile.collectiblePlaceholder": { en: "Choose a card", el: "Επίλεξε κάρτα" },
  "profile.grantCardButton": { en: "Grant card", el: "Παραχώρηση κάρτας" },
  "profile.grantingCard": { en: "Granting…", el: "Παραχώρηση…" },
  "profile.grantedCardTo": { en: "to", el: "στον/στην" },
  "profile.grantCardFailed": { en: "Failed to grant that card.", el: "Η παραχώρηση της κάρτας απέτυχε." },

  "profile.addCollectibleTitle": { en: "Add to catalog", el: "Προσθήκη στον κατάλογο" },
  "profile.addCollectibleFailed": { en: "Failed to add card.", el: "Η προσθήκη της κάρτας απέτυχε." },

  // Keyed by the backend's error `code` field (routes/predictions.ts,
  // routes/collectibles.ts) — same pattern as trades.ts's tradeErrorMessage.
  "profile.adminErr.INVALID_REQUEST_BODY": {
    en: "Fill in all the fields.",
    el: "Συμπλήρωσε όλα τα πεδία.",
  },
  "profile.adminErr.REASON_REQUIRED": { en: "A reason is required.", el: "Απαιτείται αιτιολογία." },
  "profile.adminErr.USER_NOT_FOUND": { en: "No user with that email.", el: "Δεν βρέθηκε χρήστης με αυτό το email." },
  "profile.adminErr.COLLECTIBLE_NOT_FOUND": { en: "Card not found.", el: "Η κάρτα δεν βρέθηκε." },
  "profile.adminErr.ALREADY_OWNED": {
    en: "That user already owns this card.",
    el: "Ο χρήστης κατέχει ήδη αυτή την κάρτα.",
  },
  "profile.adminErr.TEAM_NOT_FOUND": { en: "Team not found.", el: "Η ομάδα δεν βρέθηκε." },
};
