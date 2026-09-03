import { Lang } from "./lang";

// App shell: top bar, side/bottom nav, profile page.
export const chromeTranslations: Record<string, Record<Lang, string>> = {
  // shared/splash.ts — the brief brand moment shown on app load.
  "splash.tagline": { en: "Clutch it", el: "Clutch-ωσέ το" },

  "nav.home": { en: "Home", el: "Αρχική" },
  "nav.news": { en: "News", el: "Νέα" },
  "nav.schedule": { en: "Schedule", el: "Πρόγραμμα" },
  "nav.picks": { en: "Picks", el: "Προβλέψεις" },
  "nav.liveGame": { en: "A game is live now", el: "Ένας αγώνας είναι ζωντανά τώρα" },
  "nav.pendingTrades": { en: "You have a pending trade offer", el: "Έχεις μια εκκρεμή προσφορά ανταλλαγής" },
  "nav.cards": { en: "Cards", el: "Κάρτες" },
  "nav.teams": { en: "Teams", el: "Ομάδες" },
  "nav.standings": { en: "Standings", el: "Βαθμολογία" },
  "nav.more": { en: "More", el: "Περισσότερα" },
  "nav.profile": { en: "Profile", el: "Προφίλ" },
  "nav.login": { en: "Log in", el: "Σύνδεση" },
  "nav.register": { en: "Register", el: "Εγγραφή" },
  "nav.logout": { en: "Log out", el: "Αποσύνδεση" },
  "nav.admin": { en: "Admin", el: "Διαχειριστής" },

  // shared/page-hint.ts — dismiss button, reused across every page hint.
  "hint.dismiss": { en: "Dismiss", el: "Απόρριψη" },

  // shared/install-banner.ts — the "add to home screen" nudge.
  "install.title": { en: "Add Clutch to your home screen", el: "Πρόσθεσε το Clutch στην αρχική οθόνη" },
  "install.subtitle": {
    en: "Quicker access, opens full-screen like a real app.",
    el: "Πιο γρήγορη πρόσβαση, ανοίγει πλήρης οθόνη σαν κανονική εφαρμογή.",
  },
  "install.dismiss": { en: "Dismiss", el: "Απόρριψη" },
  "install.showMe": { en: "Show me how", el: "Δείξε μου πώς" },
  "install.installNow": { en: "Install", el: "Εγκατάσταση" },
  "install.iosStep1": { en: "Tap the Share icon", el: "Πάτησε το εικονίδιο Κοινοποίησης" },
  "install.iosStep2": { en: "Scroll down and tap \"Add to Home Screen\"", el: "Κύλισε κάτω και πάτησε \"Προσθήκη στην Αρχική οθόνη\"" },
  "install.iosStep3": { en: "Tap \"Add\" in the top corner", el: "Πάτησε \"Προσθήκη\" πάνω δεξιά" },
  "install.androidStep1": { en: "Tap the menu icon", el: "Πάτησε το εικονίδιο μενού" },
  "install.androidStep2": { en: "Tap \"Install app\" or \"Add to Home screen\"", el: "Πάτησε \"Εγκατάσταση εφαρμογής\" ή \"Προσθήκη στην Αρχική οθόνη\"" },

  // shared/open-in-browser-banner.ts — shown on the register page when a
  // referral/promo link is opened inside Messenger's/Instagram's in-app
  // browser, which can't offer "Add to Home Screen" at all.
  "openInBrowser.message": {
    en: "You're viewing this inside the app's built-in browser. Tap ⋯ (or the browser icon) above and choose \"Open in Browser\" to save Clutch to your home screen.",
    el: "Βλέπεις αυτή τη σελίδα μέσα στον ενσωματωμένο browser της εφαρμογής. Πάτησε ⋯ (ή το εικονίδιο browser) πάνω και επίλεξε \"Άνοιγμα σε Browser\" για να προσθέσεις το Clutch στην αρχική οθόνη.",
  },

  // shared/stat-legend.ts — the "what does this mean?" glossary popover,
  // reused by roster and game-detail's stat tables.
  "statLegend.title": { en: "What these mean", el: "Τι σημαίνουν" },
  "statLegend.close": { en: "Close", el: "Κλείσιμο" },

  "profile.backToDashboard": { en: "Dashboard", el: "Πίνακας" },
  "profile.title": { en: "Profile", el: "Προφίλ" },
  "profile.username": { en: "Username", el: "Όνομα χρήστη" },
  "profile.usernameHint": {
    en: "This is what other players see on leaderboards, leagues, and trades.",
    el: "Αυτό βλέπουν οι άλλοι παίκτες στις κατατάξεις, τις λίγκες και τις ανταλλαγές.",
  },
  "profile.email": { en: "Email", el: "Email" },
  "profile.favoriteTeam": { en: "Favorite team", el: "Αγαπημένη ομάδα" },
  "profile.clearHint": {
    en: "Tap your team again to clear it.",
    el: "Πάτησε ξανά την ομάδα σου για να την αφαιρέσεις.",
  },
  "profile.language": { en: "Language", el: "Γλώσσα" },
  "profile.languageEnglish": { en: "English", el: "Αγγλικά" },
  "profile.languageGreek": { en: "Greek", el: "Ελληνικά" },
  "profile.theme": { en: "Theme", el: "Θέμα" },
  "profile.themeLight": { en: "Light", el: "Φωτεινό" },
  "profile.themeDark": { en: "Dark", el: "Σκοτεινό" },
  "profile.logout": { en: "Log out", el: "Αποσύνδεση" },
  "profile.saveTeamFailed": {
    en: "Couldn't update your favorite team — try again.",
    el: "Δεν ήταν δυνατή η ενημέρωση της αγαπημένης σου ομάδας — δοκίμασε ξανά.",
  },

  "profile.referralTitle": { en: "Refer a friend", el: "Προσκάλεσε έναν φίλο" },
  "profile.referralHint": {
    en: "When they sign up and make their first correct prediction, you get a 400-point bonus.",
    el: "Όταν εγγραφούν και κάνουν τη πρώτη σωστή πρόβλεψή τους, κερδίζεις 400 πόντους.",
  },
  "profile.referralCopy": { en: "Copy link", el: "Αντιγραφή συνδέσμου" },
  "profile.referralCopied": { en: "Copied!", el: "Αντιγράφηκε!" },

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
