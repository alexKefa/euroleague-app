import { Lang } from "./lang";

// Game story cards (2026-10-09, features/game/game-story.ts). The card's
// own words are rendered server-side (backend services/gameStory/copy.ts).
export const gameStoryTranslations: Record<string, Record<Lang, string>> = {
  "story.title": { en: "Story of the game", el: "Η ιστορία του αγώνα" },
  "story.share": { en: "Share", el: "Κοινοποίηση" },
  "story.download": { en: "Download", el: "Λήψη" },
  "story.copyLink": { en: "Copy link", el: "Αντιγραφή συνδέσμου" },
  "story.linkCopied": { en: "Link copied", el: "Ο σύνδεσμος αντιγράφηκε" },
  "story.tapAgain": { en: "Ready — tap to share", el: "Έτοιμο — πάτα για κοινοποίηση" },
  "story.downloaded": { en: "Saved to your downloads", el: "Αποθηκεύτηκε στις λήψεις σου" },
  "story.error": { en: "Couldn't share this card. Try again.", el: "Δεν ήταν δυνατή η κοινοποίηση. Δοκίμασε ξανά." },
  "story.generating": { en: "Building the card…", el: "Δημιουργία κάρτας…" },
  "story.alt": { en: "Story of the game card", el: "Κάρτα με την ιστορία του αγώνα" },
};
