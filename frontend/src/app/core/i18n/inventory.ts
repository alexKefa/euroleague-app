import { Lang } from "./lang";

export const inventoryTranslations: Record<string, Record<Lang, string>> = {
  "inventory.title": { en: "My Cards", el: "Οι Κάρτες μου" },
  "inventory.logInLinkText": { en: "Log in", el: "Σύνδεση" },
  "inventory.loginToSeeSuffix": { en: "to see your collection.", el: "για να δεις τη συλλογή σου." },
  "inventory.noCardsPrefix": {
    en: "You haven't unlocked any cards yet — check the",
    el: "Δεν έχεις ξεκλειδώσει καμία κάρτα ακόμα — δες το",
  },
  "inventory.storeLinkText": { en: "store", el: "κατάστημα" },
  "inventory.noCardsMiddle": { en: "or spin the", el: "ή γύρισε τον" },
  "inventory.wheelLinkText": { en: "wheel", el: "τροχό" },
  "inventory.tierAll": { en: "All", el: "Όλες" },
  "inventory.tierCommon": { en: "Common", el: "Κοινή" },
  "inventory.tierRare": { en: "Rare", el: "Σπάνια" },
  "inventory.tierLegendary": { en: "Legendary", el: "Θρυλική" },
  "inventory.previewAriaPrefix": { en: "Preview", el: "Προεπισκόπηση" },
  "inventory.noMatch": { en: "No cards match that rarity.", el: "Καμία κάρτα δεν αντιστοιχεί σε αυτή τη σπανιότητα." },

  "inventory.hintPrefix": { en: "Your card collection — open", el: "Η συλλογή σου με κάρτες — άνοιξε" },
  "inventory.hintMiddle": {
    en: "with points, spin the free daily",
    el: "με πόντους, γύρισε τον δωρεάν καθημερινό",
  },
  "inventory.hintSuffix": {
    en: "or trade duplicates with other collectors.",
    el: "ή αντάλλαξε διπλότυπες κάρτες με άλλους συλλέκτες.",
  },
};
