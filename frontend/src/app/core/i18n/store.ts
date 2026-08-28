import { Lang } from "./lang";

// Store, its card-preview modal, the daily wheel, and packs — the
// collectibles economy pages.
export const storeTranslations: Record<string, Record<Lang, string>> = {
  "store.title": { en: "Store", el: "Κατάστημα" },
  "store.pointsBadge": { en: "PTS", el: "ΠΟΝ" },
  "store.loginToCollect": {
    en: "to collect cards from packs and the wheel.",
    el: "για να συλλέξεις κάρτες από τα πακέτα και τον τροχό.",
  },
  "store.jumpBall": { en: "Jump Ball", el: "Τζάμπολ" },
  "store.packs": { en: "Packs", el: "Πακέτα" },
  "store.myCards": { en: "My Cards", el: "Οι Κάρτες μου" },
  "store.trades": { en: "Trades", el: "Ανταλλαγές" },
  "store.searchPlaceholder": { en: "Search players…", el: "Αναζήτηση παικτών…" },
  "store.allTeams": { en: "All teams", el: "Όλες οι ομάδες" },
  "store.tierAll": { en: "All", el: "Όλα" },
  "store.tierCommon": { en: "Common", el: "Κοινή" },
  "store.tierRare": { en: "Rare", el: "Σπάνια" },
  "store.tierLegendary": { en: "Legendary", el: "Θρυλική" },
  "store.previewPrefix": { en: "Preview", el: "Προεπισκόπηση" },
  "store.unlocked": { en: "Unlocked", el: "Ξεκλειδωμένη" },
  "store.tapToView": { en: "Tap to view", el: "Πάτησε για προβολή" },
  "store.winOnWheel": { en: "Win it on the wheel →", el: "Κέρδισέ την στον τροχό →" },
  "store.getFromPack": { en: "Get from a pack →", el: "Απόκτησέ την από πακέτο →" },
  "store.buyFor": { en: "Buy for", el: "Αγορά για" },
  "store.emptyStore": { en: "Nothing in the store yet.", el: "Δεν υπάρχει ακόμα τίποτα στο κατάστημα." },
  "store.emptySearch": { en: "No cards match your search.", el: "Καμία κάρτα δεν ταιριάζει με την αναζήτησή σου." },
  "store.clearFilters": { en: "Clear filters", el: "Καθαρισμός φίλτρων" },
  "store.namePlaceholder": { en: "Player / item name", el: "Όνομα παίκτη / αντικειμένου" },
  "store.teamPlaceholder": { en: "Team", el: "Ομάδα" },
  "store.pointsPlaceholder": { en: "Points", el: "Πόντοι" },
  "store.imageUrlPlaceholder": { en: "Image URL (optional)", el: "URL εικόνας (προαιρετικό)" },
  "store.adding": { en: "Adding…", el: "Προσθήκη…" },
  "store.add": { en: "Add", el: "Προσθήκη" },
  "store.setImage": { en: "Set image", el: "Ορισμός εικόνας" },
  "store.adminEdit": { en: "Admin", el: "Διαχειριστής" },
  "store.closePreview": { en: "Close preview", el: "Κλείσιμο προεπισκόπησης" },
  "store.tapToFlip": { en: "Tap the card to flip it", el: "Πάτησε την κάρτα για να τη γυρίσεις" },
  "store.statsNotLinked": {
    en: "This card isn't linked to a player record yet — no stats to show.",
    el: "Αυτή η κάρτα δεν έχει συνδεθεί ακόμα με στοιχεία παίκτη — δεν υπάρχουν στατιστικά.",
  },
  "store.noStatsYet": { en: "No stats recorded yet this season.", el: "Δεν έχουν καταγραφεί στατιστικά αυτή τη σεζόν." },
  "store.gamesPlayed": { en: "Games played", el: "Αγώνες" },

  "wheel.title": { en: "Daily Jump Ball", el: "Καθημερινό Τζάμπολ" },
  "wheel.subtitle": {
    en: "One free jump ball a day — you always walk away with a pack, with a shot at a legendary one.",
    el: "Ένα δωρεάν τζάμπολ την ημέρα — φεύγεις πάντα με ένα πακέτο, με πιθανότητα για θρυλικό.",
  },
  "wheel.loginToSpin": {
    en: "to take your jump ball — always a pack, with a shot at a legendary one.",
    el: "για να κάνεις το τζάμπολ σου — πάντα ένα πακέτο, με πιθανότητα για θρυλικό.",
  },
  "wheel.takeJumpBall": { en: "Take the jump ball", el: "Πήδα για το τζάμπολ" },
  "wheel.spinning": { en: "Jump ball…", el: "Τζάμπολ…" },
  "wheel.nextAvailable": { en: "Next jump ball available", el: "Επόμενο τζάμπολ διαθέσιμο" },
  "wheel.cheatAdmin": { en: "Cheat jump ball (admin)", el: "Τζάμπολ απάτης (διαχειριστής)" },
  "wheel.cheatFoilAdmin": { en: "Cheat foil legendary (admin)", el: "Θρυλική foil απάτης (διαχειριστής)" },
  "wheel.gotPack": { en: "You won a pack!", el: "Κέρδισες ένα πακέτο!" },
  "wheel.legendaryPackWon": { en: "Legendary pack!", el: "Θρυλικό πακέτο!" },
  "wheel.rarePackWon": { en: "Rare pack!", el: "Σπάνιο πακέτο!" },
  "wheel.openInPacks": { en: "Open it anytime from the Packs page.", el: "Άνοιξέ το όποτε θες από τη σελίδα Πακέτα." },
  "wheel.goToPacks": { en: "Go to Packs", el: "Πήγαινε στα Πακέτα" },
  "wheel.hint": {
    en: "Your tier is locked in the moment you spin, but the pack stays unopened — head to Packs afterward, under \"My Packs\", to reveal what's inside.",
    el: "Το επίπεδο κλειδώνει τη στιγμή του τζάμπολ, αλλά το πακέτο μένει κλειστό — πήγαινε μετά στα Πακέτα, στην ενότητα \"Τα Πακέτα μου\", για να δεις τι κρύβει.",
  },

  "packs.title": { en: "Packs", el: "Πακέτα" },
  "packs.pointsBadge": { en: "PTS", el: "ΠΟΝ" },
  "packs.subtitle": {
    en: "Spend points on a pack for a run of random cards — duplicates can be sold on the spot.",
    el: "Ξόδεψε πόντους σε ένα πακέτο για μια σειρά τυχαίων καρτών — τα διπλά μπορούν να πουληθούν επιτόπου.",
  },
  "packs.loginToOpen": { en: "to open packs with your points.", el: "για να ανοίξεις πακέτα με τους πόντους σου." },
  "packs.hint": {
    en: "Buying a pack reveals its cards right away. Pull one you already own and it's auto-sold on the spot for half its point cost — nothing goes to waste.",
    el: "Η αγορά πακέτου αποκαλύπτει τις κάρτες αμέσως. Αν βγει κάρτα που ήδη έχεις, πουλιέται αυτόματα για τους μισούς πόντους της — τίποτα δεν πάει χαμένο.",
  },
  "packs.card": { en: "Card", el: "Κάρτα" },
  "packs.of": { en: "of", el: "από" },
  "packs.tapToContinue": { en: "Tap for the next card", el: "Πάτησε για την επόμενη κάρτα" },
  "packs.tapToFinish": { en: "Tap to see your pack", el: "Πάτησε για να δεις το πακέτο σου" },
  "packs.duplicate": { en: "Duplicate", el: "Διπλή" },
  "packs.sold": { en: "Sold", el: "Πουλήθηκε" },
  // Duplicates are auto-sold the instant they're rolled — no button, no
  // chance to forget and lose the points — so this is a statement, not a
  // call to action.
  "packs.soldForPrefix": { en: "Sold for", el: "Πουλήθηκε για" },
  "packs.ptsLower": { en: "pts", el: "πόν." },
  "packs.legendaryBang": { en: "Legendary!", el: "Θρυλική!" },
  "packs.foilBang": { en: "Foil!", el: "Foil!" },
  "packs.rareBang": { en: "Rare!", el: "Σπάνια!" },
  "packs.newBang": { en: "New!", el: "Νέα!" },
  "packs.packOpened": { en: "Pack opened!", el: "Το πακέτο άνοιξε!" },
  "packs.openAnother": { en: "Open another", el: "Άνοιξε άλλο" },
  "packs.myCards": { en: "My cards", el: "Οι κάρτες μου" },
  "packs.myPacksTitle": { en: "My Packs", el: "Τα Πακέτα μου" },
  "packs.myPacksSubtitle": {
    en: "Won from the wheel — open whenever you want.",
    el: "Κερδισμένα από τον τροχό — άνοιξέ τα όποτε θες.",
  },
  "packs.openNow": { en: "Open", el: "Άνοιγμα" },
  "packs.opening": { en: "Opening…", el: "Άνοιγμα…" },
  // Backend PACKS labels (services/packs.ts) are English-only internal
  // display strings, not translated — the frontend never renders them
  // directly, it looks up the pack's `type` here instead (packLabel() in
  // packs.ts) so Greek users don't see "Regular Season Pack" verbatim.
  "packs.label.starter": { en: "Regular Season Pack", el: "Πακέτο Κανονικής Περιόδου" },
  "packs.label.pro": { en: "Playoffs Pack", el: "Πακέτο Play-Off" },
  "packs.label.elite": { en: "Final Four Pack", el: "Πακέτο Final Four" },
  "packs.label.wheelStarter": { en: "Jump Ball — Common Pull", el: "Τζάμπολ — Κοινή Κλήρωση" },
  "packs.label.wheelPro": { en: "Jump Ball — Rare Pull", el: "Τζάμπολ — Σπάνια Κλήρωση" },
  "packs.label.wheelLegendary": { en: "Jump Ball — Legendary Pull", el: "Τζάμπολ — Θρυλική Κλήρωση" },
  "packs.tagline.starter": { en: "Where every run starts", el: "Εκεί ξεκινά κάθε προσπάθεια" },
  "packs.tagline.pro": { en: "Win or go home", el: "Νίκη ή τίποτα" },
  "packs.tagline.elite": { en: "The biggest stage in EuroLeague", el: "Η μεγαλύτερη σκηνή της EuroLeague" },
  "packs.blurb.starter": {
    en: "5 cards — mostly commons, with a real shot at a rare in either of the last two slots.",
    el: "5 κάρτες — κυρίως κοινές, αλλά με πραγματική πιθανότητα για σπάνια σε μία από τις δύο τελευταίες θέσεις.",
  },
  "packs.blurb.pro": {
    en: "5 cards — guaranteed 2 rares + 1 common, plus two bonus slots that could go either way.",
    el: "5 κάρτες — εγγυημένα 2 σπάνιες + 1 κοινή, συν δύο μπόνους θέσεις που μπορεί να πάνε είτε έτσι είτε αλλιώς.",
  },
  "packs.blurb.elite": {
    en: "5 cards — guaranteed 3 rares + 1 common, plus a shot at the last slot upgrading to legendary.",
    el: "5 κάρτες — εγγυημένα 3 σπάνιες + 1 κοινή, συν πιθανότητα η τελευταία θέση να αναβαθμιστεί σε θρυλική.",
  },
};
