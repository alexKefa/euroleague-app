import { Lang } from "./lang";

export const legendaryVoteTranslations: Record<string, Record<Lang, string>> = {
  "legendaryVote.hubTile": { en: "Vote", el: "Ψήφισε" },
  "legendaryVote.title": { en: "Legendary Vote", el: "Ψηφοφορία Θρύλων" },
  "legendaryVote.hint": {
    en: "Vote for the next real legendary card to join the catalog — the winner is added for everyone once voting closes. You can change your vote any time before then.",
    el: "Ψήφισε ποιος παίκτης θα γίνει η επόμενη πραγματική θρυλική κάρτα — ο νικητής προστίθεται για όλους μόλις κλείσει η ψηφοφορία. Μπορείς να αλλάξεις την ψήφο σου μέχρι τότε.",
  },
  "legendaryVote.loginToVote": { en: "Log in to vote.", el: "Συνδέσου για να ψηφίσεις." },
  "legendaryVote.openTitle": { en: "Open polls", el: "Ενεργές ψηφοφορίες" },
  "legendaryVote.closedTitle": { en: "Past polls", el: "Προηγούμενες ψηφοφορίες" },
  "legendaryVote.empty": { en: "No polls yet — check back soon.", el: "Δεν υπάρχουν ψηφοφορίες ακόμα — ξαναδές σύντομα." },
  "legendaryVote.votes": { en: "votes", el: "ψήφοι" },
  "legendaryVote.voteButton": { en: "Vote", el: "Ψήφισε" },
  "legendaryVote.voted": { en: "Your vote", el: "Η ψήφος σου" },
  "legendaryVote.changeVote": { en: "Change vote", el: "Αλλαγή ψήφου" },
  "legendaryVote.removeVote": { en: "Remove my vote", el: "Αφαίρεση ψήφου" },
  "legendaryVote.closesOn": { en: "Voting closes", el: "Η ψηφοφορία κλείνει" },
  "legendaryVote.closed": { en: "Closed", el: "Έκλεισε" },
  "legendaryVote.winnerPrefix": { en: "Winner:", el: "Νικητής:" },
  "legendaryVote.noWinner": { en: "No votes were cast.", el: "Δεν δόθηκε καμία ψήφος." },
  "legendaryVote.voteFailed": { en: "Failed to cast your vote.", el: "Η ψήφος απέτυχε." },
  "legendaryVote.err.POLL_CLOSED": { en: "This poll is no longer accepting votes.", el: "Αυτή η ψηφοφορία δεν δέχεται πλέον ψήφους." },
  "legendaryVote.err.POLL_NOT_FOUND": { en: "Poll not found.", el: "Η ψηφοφορία δεν βρέθηκε." },
  "legendaryVote.err.INVALID_CANDIDATE": { en: "That candidate isn't in this poll.", el: "Ο υποψήφιος δεν ανήκει σε αυτή την ψηφοφορία." },

  // Admin-only poll creation panel.
  "legendaryVote.adminTitle": { en: "Create a poll (admin)", el: "Δημιουργία ψηφοφορίας (admin)" },
  "legendaryVote.titlePlaceholder": { en: "Poll title", el: "Τίτλος ψηφοφορίας" },
  "legendaryVote.searchPlaceholder": { en: "Search players…", el: "Αναζήτηση παικτών…" },
  "legendaryVote.selectedCount": { en: "selected", el: "επιλεγμένοι" },
  "legendaryVote.createButton": { en: "Create poll", el: "Δημιουργία" },
  "legendaryVote.creating": { en: "Creating…", el: "Δημιουργία…" },
  "legendaryVote.createFailed": { en: "Failed to create poll.", el: "Η δημιουργία απέτυχε." },
  "legendaryVote.candidateRange": {
    en: "Pick between 2 and 8 candidates.",
    el: "Διάλεξε από 2 έως 8 υποψηφίους.",
  },
  "legendaryVote.closeButton": { en: "Close voting", el: "Κλείσιμο ψηφοφορίας" },
  "legendaryVote.closing": { en: "Closing…", el: "Κλείσιμο…" },
  "legendaryVote.closeConfirm": {
    en: "Close this poll? The current leader will be added as a real legendary card immediately.",
    el: "Κλείσιμο ψηφοφορίας; Ο τρέχων νικητής θα προστεθεί αμέσως ως πραγματική θρυλική κάρτα.",
  },
  "legendaryVote.closeFailed": { en: "Failed to close poll.", el: "Το κλείσιμο απέτυχε." },
  "legendaryVote.cancel": { en: "Cancel", el: "Άκυρο" },
};
