import { Lang } from "./lang";

// App shell: top bar, side/bottom nav, profile page.
export const chromeTranslations: Record<string, Record<Lang, string>> = {
  // Round names (shared/round-label.ts, 2026-10-15): regular season by
  // number, then the postseason by stage.
  "round.regular": { en: "Round {n}", el: "Αγωνιστική {n}" },
  "round.playIn": { en: "Play-in", el: "Πλέι-ιν" },
  "round.playoffs": { en: "Playoffs · Game {n}", el: "Πλέι οφ · Αγώνας {n}" },
  "round.semifinals": { en: "Final Four · Semifinals", el: "Φάιναλ Φορ · Ημιτελικοί" },
  "round.final": { en: "Final Four · Final", el: "Φάιναλ Φορ · Τελικός" },
  "round.short.regular": { en: "R{n}", el: "Γ{n}" },
  "round.short.playIn": { en: "PI", el: "ΠΙ" },
  "round.short.playoffs": { en: "G{n}", el: "Α{n}" },
  "round.short.semifinals": { en: "SF", el: "ΗΜ" },
  "round.short.final": { en: "F", el: "ΤΕΛ" },
  // Page header eyebrows (shared/page-header.ts, 2026-10-01): which part of
  // the app a page belongs to.
  "section.play": { en: "Play", el: "Παιχνίδι" },
  "section.cards": { en: "Cards", el: "Κάρτες" },
  "section.season": { en: "Season", el: "Σεζόν" },
  "section.stats": { en: "Stats", el: "Στατιστικά" },
  "section.you": { en: "You", el: "Εσύ" },
  // shared/splash.ts — the brief brand moment shown on app load. Just the
  // part after the literal "Clutch" (rendered separately, in brand orange,
  // by splash.html) — concatenating "Clutch" + this reconstructs the
  // exact original phrase in both languages ("Clutch it" / "Clutch-ωσέ το").
  "splash.taglineSuffix": { en: " it", el: "-ωσέ το" },

  "nav.home": { en: "Home", el: "Αρχική" },
  "nav.news": { en: "News", el: "Νέα" },
  "nav.leaderboard": { en: "Leaderboard", el: "Κατάταξη" },
  "nav.fanMap": { en: "Fan map", el: "Χάρτης" },
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
  // Generic back-link label (nav-history.service.ts) — shown instead of a
  // page's own hardcoded "back to X" label whenever there's a real in-app
  // previous page to return to, since that page isn't necessarily "X"
  // anymore once a drill-down page is reachable from several places.
  "nav.back": { en: "Back", el: "Πίσω" },
  "common.today": { en: "Today", el: "Σήμερα" },

  // shared/page-hint.ts — dismiss button, reused across every page hint.
  "hint.dismiss": { en: "Dismiss", el: "Απόρριψη" },
  // Page hint restyle (2026-09-30, shared/page-hint.ts).
  "hint.label": { en: "How it works", el: "Πώς λειτουργεί" },
  "hint.gotIt": { en: "Got it", el: "Κατάλαβα" },

  // shared/install-banner.ts — the "add to home screen" nudge.
  // Watch Pill (2026-09-25) — the global pinned game/player live tracker.
  // See core/watchlist.service.ts's doc comment for the full design.
  "watchPill.unpin": { en: "Unpin", el: "Ξεκαρφίτσωμα" },
  // Floating watch bubble (2026-10-12).
  "watchPill.open": { en: "Pinned games and players", el: "Καρφιτσωμένοι αγώνες και παίκτες" },
  "watchPill.title": { en: "Watching", el: "Παρακολουθείς" },
  "watchPill.final": { en: "Final", el: "Τελικό" },
  "watchPill.pinGame": { en: "Watch this game", el: "Παρακολούθησε αυτόν τον αγώνα" },
  "watchPill.unpinGame": { en: "Stop watching this game", el: "Σταμάτα να παρακολουθείς αυτόν τον αγώνα" },
  "watchPill.pinPlayer": { en: "Watch this player", el: "Παρακολούθησε αυτόν τον παίκτη" },
  "watchPill.unpinPlayer": { en: "Stop watching this player", el: "Σταμάτα να παρακολουθείς αυτόν τον παίκτη" },
  "watchPill.limitReached": {
    en: "You can watch up to 3 at once — unpin one first",
    el: "Μπορείς να παρακολουθείς έως 3 ταυτόχρονα — ξεκαρφίτσωσε πρώτα ένα",
  },

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
  "profile.usernameEdit": { en: "Change", el: "Αλλαγή" },
  "profile.usernameSave": { en: "Save", el: "Αποθήκευση" },
  "profile.usernameSaving": { en: "Saving…", el: "Αποθήκευση…" },
  "profile.usernameCancel": { en: "Cancel", el: "Ακύρωση" },
  "profile.usernameSaveFailed": {
    en: "Couldn't update your username — try again.",
    el: "Δεν ήταν δυνατή η ενημέρωση του ονόματος χρήστη — δοκίμασε ξανά.",
  },
  "profile.email": { en: "Email", el: "Email" },
  "profile.favoriteTeam": { en: "Favorite team", el: "Αγαπημένη ομάδα" },
  "profile.noFavoriteTeam": { en: "No team picked yet", el: "Δεν έχει επιλεγεί ομάδα" },
  "profile.changeTeam": { en: "Change", el: "Αλλαγή" },
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
  "profile.pinchZoom": { en: "Pinch zoom", el: "Ζουμ με τσίμπημα" },
  "profile.pinchZoomOff": { en: "Off", el: "Ανενεργό" },
  "profile.pinchZoomOn": { en: "On", el: "Ενεργό" },
  "profile.featureInClips": { en: "Feature me in Clutch videos", el: "Εμφάνισέ με στα βίντεο του Clutch" },
  "profile.featureInClipsHint": {
    en: "Round recap videos are posted publicly on TikTok and Instagram. Off: you appear as a nickname instead of your username.",
    el: "Τα βίντεο με τα αποτελέσματα κάθε αγωνιστικής δημοσιεύονται στο TikTok και στο Instagram. Αν το κλείσεις, εμφανίζεσαι με ψευδώνυμο αντί για το username σου.",
  },
  // Push notifications (core/push.service.ts, 2026-10-05).
  "profile.notifications": { en: "Notifications", el: "Ειδοποιήσεις" },
  "profile.notificationsOff": { en: "Off", el: "Ανενεργές" },
  "profile.notificationsOn": { en: "On", el: "Ενεργές" },
  "profile.notificationsHint": {
    en: "Pick and Fantasy reminders before they lock, round results, and trade offers.",
    el: "Υπενθυμίσεις για προβλέψεις και Fantasy πριν κλειδώσουν, αποτελέσματα αγωνιστικής και προτάσεις ανταλλαγής.",
  },
  "profile.notificationsNeedsInstall": {
    en: "On iPhone, add Clutch to your Home Screen and open it from there to turn on notifications.",
    el: "Στο iPhone, πρόσθεσε το Clutch στην οθόνη αφετηρίας και άνοιξέ το από εκεί για να ενεργοποιήσεις τις ειδοποιήσεις.",
  },
  "profile.notificationsDenied": {
    en: "Notifications are blocked. Allow them for Clutch in your phone or browser settings.",
    el: "Οι ειδοποιήσεις είναι μπλοκαρισμένες. Επίτρεψέ τες για το Clutch από τις ρυθμίσεις του κινητού ή του browser.",
  },
  // shared/push-prompt.ts: one-time pop-up in the installed app.
  "pushPrompt.title": { en: "Turn on notifications?", el: "Ενεργοποίηση ειδοποιήσεων;" },
  "pushPrompt.text": {
    en: "Get a heads-up before your picks and Fantasy squad lock, when round results are in, and when someone sends you a trade offer. You can change this anytime in Profile.",
    el: "Μάθε πριν κλειδώσουν οι προβλέψεις και η Fantasy πεντάδα σου, όταν βγουν τα αποτελέσματα της αγωνιστικής και όταν σου στείλουν πρόταση ανταλλαγής. Μπορείς να το αλλάξεις όποτε θες από το Προφίλ.",
  },
  "pushPrompt.cta": { en: "Turn on", el: "Ενεργοποίηση" },
  "pushPrompt.later": { en: "Not now", el: "Όχι τώρα" },
  "profile.logout": { en: "Log out", el: "Αποσύνδεση" },
  "profile.saveTeamFailed": {
    en: "Couldn't update your favorite team — try again.",
    el: "Δεν ήταν δυνατή η ενημέρωση της αγαπημένης σου ομάδας — δοκίμασε ξανά.",
  },

  "profile.referralTitle": { en: "Refer a friend", el: "Προσκάλεσε έναν φίλο" },
  "profile.referralHint": {
    en: "When they sign up and make their first correct prediction, you get 3 bonus packs.",
    el: "Όταν εγγραφούν και κάνουν τη πρώτη σωστή πρόβλεψή τους, κερδίζεις 3 μπόνους πακέτα.",
  },
  "profile.referralCopy": { en: "Copy link", el: "Αντιγραφή συνδέσμου" },
  "profile.referralCopied": { en: "Copied!", el: "Αντιγράφηκε!" },

  // Admin-only tools, consolidated here rather than scattered across the
  // pages they act on (except the wheel's cheat-spin, which stays there).
  "profile.adminSectionTitle": { en: "Admin tools", el: "Εργαλεία διαχειριστή" },
  "profile.adminUsersLink": { en: "View all users", el: "Προβολή όλων των χρηστών" },
  "profile.adminToolsLink": { en: "Tools", el: "Εργαλεία" },
  // Replaces the old "User email" placeholder (2026-09-18, "autofill
  // usernames instead of me typing whole email") — app-user-search
  // (shared/user-search.ts) searches by username OR email, so the
  // placeholder no longer promises only one works.
  "profile.userSearchPlaceholder": { en: "Search username or email…", el: "Αναζήτηση ονόματος χρήστη ή email…" },
  "profile.grantedPrefix": { en: "Granted", el: "Δόθηκαν" },
  "profile.foilFinish": { en: "Foil finish", el: "Φινίρισμα foil" },

  "profile.grantPointsTitle": { en: "Grant points", el: "Παραχώρηση πόντων" },
  "profile.pointsPlaceholder": { en: "Points", el: "Πόντοι" },
  "profile.reasonPlaceholder": { en: "Reason", el: "Αιτιολογία" },
  "profile.granting": { en: "Granting…", el: "Παραχώρηση…" },
  "profile.grant": { en: "Grant", el: "Παραχώρηση" },
  "profile.grantedPointsTo": { en: "pts to", el: "πόντοι στον/στην" },
  "profile.grantPointsFailed": { en: "Failed to grant points.", el: "Αποτυχία παραχώρησης πόντων." },

  "profile.grantCardTitle": { en: "Grant a card", el: "Παραχώρηση κάρτας" },
  // "Choose a card" -> "Search cards…" (2026-09-18, "have a search for
  // players to give not just list") — this now labels a type-to-filter
  // search input, not a <select>-style dropdown.
  "profile.collectiblePlaceholder": { en: "Search cards…", el: "Αναζήτηση καρτών…" },
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
  // Per-type push toggles (2026-10-12).
  "profile.pushTypes": { en: "What to notify me about", el: "Για τι να με ειδοποιεί" },
  "profile.pushLock": { en: "Pick lock reminders", el: "Υπενθυμίσεις πριν κλειδώσουν οι προβλέψεις" },
  "profile.pushRound": { en: "Round results", el: "Αποτελέσματα αγωνιστικής" },
  "profile.pushTipoff": { en: "My team: tip-off", el: "Η ομάδα μου: έναρξη αγώνα" },
  "profile.pushClose": { en: "My team: close finish", el: "Η ομάδα μου: θρίλερ στο φινάλε" },
  "profile.pushFinal": { en: "My team: final score", el: "Η ομάδα μου: τελικό σκορ" },
  "profile.pushPinned": { en: "Pinned games and players", el: "Καρφιτσωμένοι αγώνες και παίκτες" },
  // "Your data" card (2026-10-12): data export and account deletion.
  "profile.yourData": { en: "Your data", el: "Τα δεδομένα σου" },
  "profile.downloadData": { en: "Download my data", el: "Λήψη των δεδομένων μου" },
  "profile.downloadDataHint": {
    en: "Everything Clutch keeps about you, as a JSON file.",
    el: "Ό,τι κρατά το Clutch για σένα, σε αρχείο JSON.",
  },
  "profile.deleteAccount": { en: "Delete account", el: "Διαγραφή λογαριασμού" },
  "profile.deleteAccountHint": {
    en: "Erases your email, username and sign-in. Your picks and cards stay in the game's history under an anonymous name. This can't be undone.",
    el: "Διαγράφει το email, το όνομα χρήστη και τη σύνδεσή σου. Οι προβλέψεις και οι κάρτες σου μένουν στο ιστορικό με ανώνυμο όνομα. Δεν αναιρείται.",
  },
  "profile.deleteConfirmLabel": {
    en: "Type your username to confirm: {username}",
    el: "Γράψε το όνομα χρήστη σου για επιβεβαίωση: {username}",
  },
  "profile.deleteConfirmButton": { en: "Delete my account", el: "Διαγραφή του λογαριασμού μου" },
  "profile.deleteFailed": { en: "Couldn't delete your account. Try again.", el: "Η διαγραφή απέτυχε. Δοκίμασε ξανά." },
  "profile.exportFailed": {
    en: "Couldn't prepare your data. Try again later.",
    el: "Δεν ήταν δυνατή η προετοιμασία των δεδομένων σου. Δοκίμασε αργότερα.",
  },
  "toast.accountDeleted": { en: "Your account was deleted.", el: "Ο λογαριασμός σου διαγράφηκε." },
};
