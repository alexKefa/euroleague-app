import { Lang } from "./lang";

export const tradesTranslations: Record<string, Record<Lang, string>> = {
  "trades.backToCards": { en: "My Cards", el: "Οι Κάρτες μου" },
  "trades.title": { en: "Trades", el: "Ανταλλαγές" },
  "trades.hint": {
    en: "Mark a card \"tradeable\" below to list it, then browse the marketplace for a card you want and propose a swap — the other collector has to accept before it's final.",
    el: "Σήμανε μια κάρτα ως \"για ανταλλαγή\" για να την καταχωρίσεις, μετά ψάξε στην αγορά για μια κάρτα που θέλεις και πρότεινε ανταλλαγή — ο άλλος συλλέκτης πρέπει να την αποδεχτεί για να οριστικοποιηθεί.",
  },
  "trades.logInLinkText": { en: "Log in", el: "Σύνδεση" },
  "trades.loginToTradeSuffix": {
    en: "to trade legendary cards with other collectors.",
    el: "για να ανταλλάξεις θρυλικές κάρτες με άλλους συλλέκτες.",
  },
  "trades.noCardsPrefix": {
    en: "You don't have any legendary cards to trade yet. Win one from the",
    el: "Δεν έχεις ακόμα θρυλικές κάρτες για ανταλλαγή. Κέρδισε μία από τον",
  },
  "trades.wheelLinkText": { en: "wheel", el: "τροχό" },
  "trades.noCardsSuffix": { en: "or a perfect prediction round.", el: "ή με τέλειο γύρο προγνωστικών." },
  "trades.myCardsTitle": { en: "My cards", el: "Οι κάρτες μου" },
  "trades.myCardsHint": {
    en: "List a card in the marketplace so other collectors can see it and offer a trade. Only cards you list are visible to anyone else.",
    el: "Καταχώρισε μια κάρτα στην αγορά ώστε άλλοι συλλέκτες να τη δουν και να προτείνουν ανταλλαγή. Μόνο οι κάρτες που καταχωρείς είναι ορατές σε άλλους.",
  },
  "trades.listed": { en: "Listed", el: "Καταχωρημένη" },
  "trades.listForTrade": { en: "List for trade", el: "Καταχώριση για ανταλλαγή" },
  "trades.marketplaceTitle": { en: "Marketplace", el: "Αγορά" },
  "trades.noListings": { en: "No cards listed for trade right now.", el: "Δεν υπάρχουν κάρτες για ανταλλαγή αυτή τη στιγμή." },
  "trades.alreadyOwned": { en: "Already owned", el: "Ήδη στη συλλογή σου" },
  "trades.offerForPrefix": {
    en: "Offer one or more of your cards for",
    el: "Πρόσφερε μία ή περισσότερες κάρτες σου για",
  },
  "trades.multiSelectHint": {
    en: "Tap to select as many cards as you like — the other side sees them all as one offer.",
    el: "Πάτησε για να επιλέξεις όσες κάρτες θέλεις — η άλλη πλευρά τις βλέπει όλες ως μία προσφορά.",
  },
  "trades.sending": { en: "Sending…", el: "Αποστολή…" },
  "trades.sendOffer": { en: "Send offer", el: "Αποστολή προσφοράς" },
  "trades.offerSent": { en: "Offer sent.", el: "Η προσφορά στάλθηκε." },
  "trades.myOffersTitle": { en: "My trade offers", el: "Οι προσφορές μου" },
  "trades.to": { en: "To", el: "Προς" },
  "trades.from": { en: "From", el: "Από" },
  "trades.youOffered": { en: "You offered", el: "Πρόσφερες" },
  "trades.theyOffered": { en: "They offered", el: "Πρόσφεραν" },
  "trades.forWord": { en: "for", el: "για" },
  "trades.accept": { en: "Accept", el: "Αποδοχή" },
  "trades.decline": { en: "Decline", el: "Απόρριψη" },
  "trades.cancel": { en: "Cancel", el: "Ακύρωση" },
  "trades.noOffers": { en: "No trade offers yet.", el: "Δεν υπάρχουν προσφορές ανταλλαγής ακόμα." },
  "trades.statusPending": { en: "pending", el: "εκκρεμεί" },
  "trades.statusAccepted": { en: "accepted", el: "έγινε αποδεκτή" },
  "trades.statusDeclined": { en: "declined", el: "απορρίφθηκε" },
  "trades.statusCancelled": { en: "cancelled", el: "ακυρώθηκε" },
  "trades.proposeFallbackError": { en: "Failed to send trade offer.", el: "Η αποστολή της προσφοράς απέτυχε." },
  "trades.actionFallbackError": { en: "That didn't work — try again.", el: "Κάτι πήγε στραβά — δοκίμασε ξανά." },

  // Keyed by the backend's error `code` field (routes/trades.ts) rather than
  // matching its English `error` message text — lets the frontend translate
  // server-side errors without the backend knowing about languages at all.
  "trades.err.FAILED_TO_LOAD_CARDS": { en: "Failed to load your cards.", el: "Η φόρτωση των καρτών σου απέτυχε." },
  "trades.err.INVALID_TRADEABLE_VALUE": {
    en: "Something went wrong updating that card.",
    el: "Κάτι πήγε στραβά κατά την ενημέρωση της κάρτας.",
  },
  "trades.err.CARD_NOT_OWNED": { en: "You don't own that card.", el: "Δεν κατέχεις αυτή την κάρτα." },
  "trades.err.FAILED_TO_UPDATE_CARD": { en: "Failed to update that card.", el: "Η ενημέρωση της κάρτας απέτυχε." },
  "trades.err.FAILED_TO_LOAD_MARKETPLACE": {
    en: "Failed to load the marketplace.",
    el: "Η φόρτωση της αγοράς απέτυχε.",
  },
  "trades.err.INVALID_REQUEST_BODY": {
    en: "Pick at least one card to offer and one to request.",
    el: "Διάλεξε τουλάχιστον μία κάρτα για προσφορά και μία για αίτηση.",
  },
  "trades.err.DUPLICATE_OFFERED_CARD": {
    en: "You can't offer the same card twice.",
    el: "Δεν μπορείς να προσφέρεις την ίδια κάρτα δύο φορές.",
  },
  "trades.err.SAME_CARD": { en: "You can't trade a card for itself.", el: "Δεν μπορείς να ανταλλάξεις μια κάρτα με τον εαυτό της." },
  "trades.err.LISTING_NOT_FOUND": {
    en: "That card isn't listed in the marketplace anymore.",
    el: "Αυτή η κάρτα δεν είναι πια καταχωρημένη στην αγορά.",
  },
  "trades.err.SELF_TRADE": { en: "You can't trade with yourself.", el: "Δεν μπορείς να κάνεις ανταλλαγή με τον εαυτό σου." },
  "trades.err.ALREADY_OWNED": { en: "You already own that card.", el: "Ήδη κατέχεις αυτή την κάρτα." },
  "trades.err.CARDS_NOT_OWNED": {
    en: "You don't own all of the cards you're offering.",
    el: "Δεν κατέχεις όλες τις κάρτες που προσφέρεις.",
  },
  "trades.err.FAILED_TO_CREATE_OFFER": {
    en: "Failed to create the trade offer.",
    el: "Η δημιουργία της προσφοράς ανταλλαγής απέτυχε.",
  },
  "trades.err.FAILED_TO_LOAD_TRADES": { en: "Failed to load your trades.", el: "Η φόρτωση των ανταλλαγών σου απέτυχε." },
  "trades.err.OFFER_NOT_FOUND": { en: "Trade offer not found.", el: "Η προσφορά ανταλλαγής δεν βρέθηκε." },
  "trades.err.NOT_YOUR_OFFER": { en: "This isn't your offer.", el: "Αυτή η προσφορά δεν είναι δική σου." },
  "trades.err.OFFER_NOT_PENDING": {
    en: "This offer is no longer pending.",
    el: "Αυτή η προσφορά δεν εκκρεμεί πια.",
  },
  "trades.err.OFFERED_CARDS_UNAVAILABLE": {
    en: "One or more of the offered cards are no longer available.",
    el: "Μία ή περισσότερες από τις προσφερόμενες κάρτες δεν είναι πια διαθέσιμες.",
  },
  "trades.err.REQUESTED_CARD_UNAVAILABLE": {
    en: "You no longer own the requested card.",
    el: "Δεν κατέχεις πια την κάρτα που ζητήθηκε.",
  },
  "trades.err.OWNERSHIP_CONFLICT": {
    en: "Trade can't complete — one of you already owns the other's card.",
    el: "Η ανταλλαγή δεν μπορεί να ολοκληρωθεί — κάποιος από τους δύο κατέχει ήδη την κάρτα του άλλου.",
  },
  "trades.err.FAILED_TO_ACCEPT": { en: "Failed to accept the trade.", el: "Η αποδοχή της ανταλλαγής απέτυχε." },
  "trades.err.FAILED_TO_DECLINE": { en: "Failed to decline the trade.", el: "Η απόρριψη της ανταλλαγής απέτυχε." },
  "trades.err.FAILED_TO_CANCEL": { en: "Failed to cancel the trade.", el: "Η ακύρωση της ανταλλαγής απέτυχε." },
};
