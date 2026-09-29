import { Lang } from "./lang";

// Admin-only "Users" panel (features/admin/admin-users.ts) — plain roster
// data plus at-a-glance numbers, so checking who's using the app doesn't
// need opening Drizzle Studio / the DB directly.
export const adminTranslations: Record<string, Record<Lang, string>> = {
  "admin.title": { en: "Users", el: "Χρήστες" },
  "admin.subtitle": {
    en: "Everyone registered in the app, and how signups trend over time.",
    el: "Όλοι οι εγγεγραμμένοι χρήστες της εφαρμογής, και πώς εξελίσσονται οι εγγραφές στον χρόνο.",
  },
  "admin.accessDenied": { en: "Admin access required", el: "Απαιτείται πρόσβαση διαχειριστή" },
  "admin.accessDeniedBody": {
    en: "This page is only visible to admin accounts.",
    el: "Αυτή η σελίδα είναι ορατή μόνο σε λογαριασμούς διαχειριστή.",
  },
  "admin.backToProfile": { en: "Back to profile", el: "Πίσω στο προφίλ" },
  "admin.loadError": { en: "Couldn't load users.", el: "Δεν ήταν δυνατή η φόρτωση χρηστών." },
  "admin.searchPlaceholder": { en: "Search name or email…", el: "Αναζήτηση ονόματος ή email…" },

  "admin.kpiTotal": { en: "Total users", el: "Σύνολο χρηστών" },
  "admin.kpiToday": { en: "New today", el: "Νέοι σήμερα" },
  "admin.kpiWeek": { en: "New this week", el: "Νέοι αυτή την εβδομάδα" },
  "admin.kpiMonth": { en: "New this month", el: "Νέοι αυτόν τον μήνα" },
  "admin.kpiAdmins": { en: "Admins", el: "Διαχειριστές" },

  "admin.chartTitle": { en: "Signups per day", el: "Εγγραφές ανά ημέρα" },
  "admin.chartSubtitle": { en: "Last 30 days", el: "Τελευταίες 30 ημέρες" },
  "admin.chartEmpty": { en: "No signups yet.", el: "Δεν υπάρχουν ακόμα εγγραφές." },

  "admin.colUser": { en: "User", el: "Χρήστης" },
  "admin.colEmail": { en: "Email", el: "Email" },
  "admin.colJoined": { en: "Joined", el: "Εγγραφή" },
  "admin.colTeam": { en: "Team", el: "Ομάδα" },
  "admin.colPoints": { en: "Points", el: "Πόντοι" },
  "admin.colCards": { en: "Cards", el: "Κάρτες" },
  "admin.colPredictions": { en: "Picks", el: "Προβλέψεις" },
  "admin.colReferrals": { en: "Referrals", el: "Παραπομπές" },
  "admin.noTeam": { en: "—", el: "—" },
  "admin.usersLabel": { en: "users", el: "χρήστες" },

  // "Tools" page (features/admin/admin-tools.ts) — reached from Profile's
  // admin section alongside "View all users".
  "admin.toolsTitle": { en: "Tools", el: "Εργαλεία" },
  "admin.toolsSubtitle": {
    en: "One-off maintenance actions, run on demand instead of from a terminal.",
    el: "Ενέργειες συντήρησης, εκτελούνται κατ' απαίτηση αντί από τερματικό.",
  },

  // "Sync images" button (2026-09-18) — pulls new real player/coach photos
  // from EuroLeague's live feed, then pushes any that changed into their
  // matching collectible card. See routes/admin.ts's own comment.
  // I18nService.t() takes no interpolation params, so the result summary
  // is composed in the template from these short labels + raw numbers
  // (same pattern the KPI tiles on the Users page already use), not a
  // single printf-style sentence.
  "admin.syncImages": { en: "Sync images", el: "Συγχρονισμός εικόνων" },
  "admin.syncImagesDescription": {
    en: "Pulls new real player/coach photos from EuroLeague's live feed, then updates any collectible cards whose image has fallen behind.",
    el: "Αντλεί νέες πραγματικές φωτογραφίες παικτών/προπονητών από το ζωντανό feed του EuroLeague, και ενημερώνει κάθε συλλεκτική κάρτα της οποίας η εικόνα έχει μείνει πίσω.",
  },
  "admin.syncImagesRunning": { en: "Syncing…", el: "Συγχρονισμός…" },
  "admin.syncImagesError": { en: "Sync failed — try again.", el: "Ο συγχρονισμός απέτυχε — δοκιμάστε ξανά." },
  "admin.syncImagesResultEmpty": { en: "Already up to date — nothing new to sync.", el: "Ήδη ενημερωμένο — δεν υπάρχει τίποτα νέο για συγχρονισμό." },
  "admin.syncImagesPlayers": { en: "player photo(s) updated", el: "φωτογραφία(-ες) παίκτη ενημερώθηκαν" },
  "admin.syncImagesCoaches": { en: "coach card(s) updated", el: "κάρτα(-ες) προπονητή ενημερώθηκαν" },
  "admin.syncImagesCollectibles": { en: "collectible(s) updated", el: "συλλεκτικό(-ά) αντικείμενο(-α) ενημερώθηκαν" },

  // Tools page boxes (admin-tools.ts's TOOLS) — one short line each; the
  // full form opens in a dialog.
  "admin.close": { en: "Close", el: "Κλείσιμο" },
  "admin.toolAnnounceDesc": {
    en: "Write a one-time \"What's new\" message for all users.",
    el: "Γράψε ένα μήνυμα «Τι νέο υπάρχει» που βλέπουν μία φορά όλοι οι χρήστες.",
  },
  "admin.toolPointsDesc": { en: "Give or take points from a user.", el: "Δώσε ή αφαίρεσε πόντους από έναν χρήστη." },
  "admin.toolCardDesc": { en: "Give a specific card to a user.", el: "Δώσε μια συγκεκριμένη κάρτα σε έναν χρήστη." },
  "admin.toolAddDesc": { en: "Add a new card to the catalog.", el: "Πρόσθεσε μια νέα κάρτα στον κατάλογο." },
  "admin.toolSyncDesc": { en: "Pull new player and coach photos.", el: "Φέρε νέες φωτογραφίες παικτών και προπονητών." },

  // "What's new" announcements editor (features/admin/admin-announcements.ts).
  "admin.announceTitle": { en: "Announcements", el: "Ανακοινώσεις" },
  "admin.announceDescription": {
    en: "Shown once to every logged-in user as a \"What's new\" toast. Every live announcement they haven't seen yet appears, each as its own toast.",
    el: "Εμφανίζεται μία φορά σε κάθε συνδεδεμένο χρήστη ως ειδοποίηση «Τι νέο υπάρχει». Κάθε ενεργή ανακοίνωση που δεν έχει δει ακόμα εμφανίζεται, η καθεμία σε δική της ειδοποίηση.",
  },
  "admin.announceEditing": { en: "Editing announcement", el: "Επεξεργασία ανακοίνωσης" },
  "admin.announceTitlePlaceholder": { en: "Title", el: "Τίτλος" },
  "admin.announceBodyPlaceholder": { en: "Message", el: "Μήνυμα" },
  "admin.announceCtaPlaceholder": { en: "Button label (optional)", el: "Κείμενο κουμπιού (προαιρετικό)" },
  "admin.announceLinkPlaceholder": { en: "Button link, e.g. /fantasy (optional)", el: "Σύνδεσμος κουμπιού, π.χ. /fantasy (προαιρετικό)" },
  "admin.announceIcon": { en: "Icon", el: "Εικονίδιο" },
  "admin.announcePublish": { en: "Publish", el: "Δημοσίευση" },
  "admin.announceExpires": { en: "Expires", el: "Λήξη" },
  "admin.announceActive": { en: "Active", el: "Ενεργή" },
  "admin.announcePreview": { en: "Preview", el: "Προεπισκόπηση" },
  "admin.announcePublishBtn": { en: "Publish announcement", el: "Δημοσίευση ανακοίνωσης" },
  "admin.announceSave": { en: "Save changes", el: "Αποθήκευση αλλαγών" },
  "admin.announceCancel": { en: "Cancel", el: "Ακύρωση" },
  "admin.announceSaved": { en: "Saved.", el: "Αποθηκεύτηκε." },
  "admin.announceList": { en: "All announcements", el: "Όλες οι ανακοινώσεις" },
  "admin.announceEmpty": { en: "No announcements yet.", el: "Δεν υπάρχουν ανακοινώσεις ακόμα." },
  "admin.announceEdit": { en: "Edit", el: "Επεξεργασία" },
  "admin.announceTurnOff": { en: "Turn off", el: "Απενεργοποίηση" },
  "admin.announceTurnOn": { en: "Turn on", el: "Ενεργοποίηση" },
  "admin.announceDelete": { en: "Delete", el: "Διαγραφή" },
  "admin.announceDeleteConfirm": {
    en: "Delete this announcement? Users who haven't seen it yet won't get it.",
    el: "Διαγραφή αυτής της ανακοίνωσης; Όσοι χρήστες δεν την έχουν δει δεν θα τη λάβουν.",
  },
  "admin.announceStatus.live": { en: "Live", el: "Ενεργή" },
  "admin.announceStatus.scheduled": { en: "Scheduled", el: "Προγραμματισμένη" },
  "admin.announceStatus.expired": { en: "Expired", el: "Έληξε" },
  "admin.announceStatus.off": { en: "Off", el: "Ανενεργή" },
  "admin.announceErr.MISSING_TEXT": {
    en: "Title and message are required in both languages.",
    el: "Ο τίτλος και το μήνυμα απαιτούνται και στις δύο γλώσσες.",
  },
  "admin.announceErr.TOO_LONG": { en: "Text is too long (400 characters max).", el: "Το κείμενο είναι πολύ μεγάλο (έως 400 χαρακτήρες)." },
  "admin.announceErr.INCOMPLETE_CTA": {
    en: "A button needs a link and a label in both languages — or leave all three empty.",
    el: "Ένα κουμπί χρειάζεται σύνδεσμο και κείμενο και στις δύο γλώσσες — ή άφησε και τα τρία κενά.",
  },
  "admin.announceErr.BAD_LINK": { en: "The link must be an in-app path, like /fantasy.", el: "Ο σύνδεσμος πρέπει να είναι διαδρομή της εφαρμογής, π.χ. /fantasy." },
  "admin.announceErr.BAD_ICON": { en: "Pick an icon.", el: "Διάλεξε εικονίδιο." },
  "admin.announceErr.BAD_DATE": { en: "Check the publish and expiry dates.", el: "Έλεγξε τις ημερομηνίες δημοσίευσης και λήξης." },
  "admin.announceErr.BAD_DATE_RANGE": { en: "Expiry must be after the publish time.", el: "Η λήξη πρέπει να είναι μετά τη δημοσίευση." },
  "admin.announceErr.NOT_FOUND": { en: "That announcement no longer exists.", el: "Αυτή η ανακοίνωση δεν υπάρχει πια." },
  "admin.announceErr.generic": { en: "Couldn't save — try again.", el: "Η αποθήκευση απέτυχε — δοκίμασε ξανά." },
};
