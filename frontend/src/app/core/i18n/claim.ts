import { Lang } from "./lang";

// features/claim/claim.ts — the QR promo-code landing page.
export const claimTranslations: Record<string, Record<Lang, string>> = {
  "claim.loading": { en: "Checking your code…", el: "Έλεγχος κωδικού…" },
  "claim.granted.title": { en: "You got a pack!", el: "Κέρδισες ένα πακέτο!" },
  "claim.granted.body": {
    en: "It's waiting for you, unopened, in My Packs.",
    el: "Σε περιμένει, αδιάνοιχτο, στα Πακέτα μου.",
  },
  "claim.alreadyClaimed.title": { en: "Already claimed", el: "Έχει ήδη χρησιμοποιηθεί" },
  "claim.alreadyClaimed.body": {
    en: "You've already redeemed this code — it only works once per account.",
    el: "Έχεις ήδη εξαργυρώσει αυτόν τον κωδικό — ισχύει μόνο μία φορά ανά λογαριασμό.",
  },
  "claim.invalid.title": { en: "Code not valid", el: "Μη έγκυρος κωδικός" },
  "claim.invalid.body": {
    en: "This code doesn't exist, has expired, or has run out of redemptions.",
    el: "Αυτός ο κωδικός δεν υπάρχει, έχει λήξει ή έχουν εξαντληθεί οι εξαργυρώσεις του.",
  },
  "claim.error.title": { en: "Something went wrong", el: "Κάτι πήγε στραβά" },
  "claim.error.body": { en: "Please try again in a moment.", el: "Δοκίμασε ξανά σε λίγο." },
  "claim.openPacks": { en: "Go to My Packs", el: "Μετάβαση στα Πακέτα μου" },
  "claim.backHome": { en: "Back to Clutch", el: "Επιστροφή στο Clutch" },
};
