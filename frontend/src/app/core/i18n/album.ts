import { Lang } from "./lang";

export const albumTranslations: Record<string, Record<Lang, string>> = {
  "album.title": { en: "Card Album", el: "Άλμπουμ Καρτών" },
  "album.hubTile": { en: "Album", el: "Άλμπουμ" },
  "album.collected": { en: "collected", el: "συλλέχθηκαν" },
  "album.hint": {
    en: "Every card in the catalog, one leaflet page per team. Flip through teams to see what you're missing.",
    el: "Κάθε κάρτα της συλλογής, μία σελίδα ανά ομάδα. Ξεφύλλισε τις ομάδες για να δεις τι σου λείπει.",
  },
  "album.prevTeam": { en: "Previous team", el: "Προηγούμενη ομάδα" },
  "album.nextTeam": { en: "Next team", el: "Επόμενη ομάδα" },
  "album.complete": { en: "Complete", el: "Ολοκληρώθηκε" },
  "album.previewAriaPrefix": { en: "Preview", el: "Προεπισκόπηση" },
  "album.loadFailed": { en: "Failed to load the album — is the backend running?", el: "Αποτυχία φόρτωσης του άλμπουμ." },
  "album.guestHint": { en: "to see which of these you actually own.", el: "για να δεις ποιες από αυτές έχεις πραγματικά." },
  "album.noCards": { en: "No cards synced for this team yet.", el: "Δεν έχουν συγχρονιστεί ακόμα κάρτες για αυτή την ομάδα." },
  "album.albumTab": { en: "Album", el: "Άλμπουμ" },
  "album.leaderboardTab": { en: "Leaderboard", el: "Κατάταξη" },
  "album.globalBoard": { en: "Global", el: "Γενική" },
  "album.myLeagueBoard": { en: "My league", el: "Η λίγκα μου" },
  "album.emptyLeaderboard": { en: "No cards collected yet this season.", el: "Δεν έχουν συλλεχθεί ακόμα κάρτες φέτος." },
};
