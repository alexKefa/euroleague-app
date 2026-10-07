import { Lang } from "./lang";

// Share cards (2026-10-07, features/share-card/). Stat abbreviations on the
// card itself (PTS, REB...) stay untranslated, as elsewhere in the app.
export const shareCardTranslations: Record<string, Record<Lang, string>> = {
  "shareCard.title": { en: "Share card", el: "Κάρτα για ανάρτηση" },
  "shareCard.subtitle": { en: "Make an image to post on Instagram, X or WhatsApp", el: "Φτιάξε εικόνα για Instagram, X ή WhatsApp" },
  "shareCard.period": { en: "Period", el: "Περίοδος" },
  "shareCard.periodSeason": { en: "Season", el: "Σεζόν" },
  "shareCard.periodLast5": { en: "Last 5", el: "Τελευταίοι 5" },
  "shareCard.periodLastGame": { en: "Last game", el: "Τελευταίος αγώνας" },
  "shareCard.periodVsTeam": { en: "vs Team", el: "vs Ομάδα" },
  "shareCard.pickTeam": { en: "Pick a team", el: "Διάλεξε ομάδα" },
  "shareCard.stats": { en: "Stats", el: "Στατιστικά" },
  "shareCard.statsHint": { en: "Pick 3 to 5", el: "Διάλεξε 3 έως 5" },
  "shareCard.size": { en: "Size", el: "Μέγεθος" },
  "shareCard.post": { en: "Post", el: "Ανάρτηση" },
  "shareCard.story": { en: "Story", el: "Story" },
  "shareCard.share": { en: "Share image", el: "Κοινοποίηση εικόνας" },
  "shareCard.creating": { en: "Creating image…", el: "Δημιουργία εικόνας…" },
  "shareCard.tapToShare": { en: "Image ready · tap to share", el: "Η εικόνα είναι έτοιμη · πάτα για κοινοποίηση" },
  "shareCard.downloaded": { en: "Saved to your downloads", el: "Αποθηκεύτηκε στις λήψεις" },
  "shareCard.error": { en: "Couldn't create the image.", el: "Δεν δημιουργήθηκε η εικόνα." },
  "shareCard.retry": { en: "Try again", el: "Ξανά" },
  "shareCard.loadError": { en: "Couldn't load this player.", el: "Δεν φόρτωσε ο παίκτης." },
  "shareCard.noGames": { en: "No games yet for this period", el: "Δεν υπάρχουν αγώνες για αυτή την περίοδο" },
  "shareCard.makeCard": { en: "Make card", el: "Φτιάξε κάρτα" },
  "shareCard.shareComparison": { en: "Share comparison", el: "Κοινοποίηση σύγκρισης" },
  // Period labels printed on the card.
  "shareCard.labelSeason": { en: "Season {season} · avg", el: "Σεζόν {season} · μ.ο." },
  "shareCard.labelLast5": { en: "Last 5 games", el: "Τελευταίοι 5 αγώνες" },
  "shareCard.labelLastN": { en: "Last {n} games", el: "Τελευταίοι {n} αγώνες" },
  "shareCard.labelLastGame": { en: "Last game", el: "Τελευταίος αγώνας" },
  "shareCard.labelLastGameVs": { en: "Last game · vs {team}", el: "Τελευταίος αγώνας · vs {team}" },
  "shareCard.labelVsTeam": { en: "vs {team}", el: "vs {team}" },
  "shareCard.labelVsTeamGames": { en: "vs {team} · {n} games", el: "vs {team} · {n} αγώνες" },
};
