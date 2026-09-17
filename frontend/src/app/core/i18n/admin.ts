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
};
