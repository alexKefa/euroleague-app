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
  "inventory.tierCoach": { en: "Coach", el: "Προπονητής" },
  "inventory.previewAriaPrefix": { en: "Preview", el: "Προεπισκόπηση" },
  "inventory.noMatch": { en: "No cards match your filters.", el: "Καμία κάρτα δεν ταιριάζει με τα φίλτρα σου." },
  "inventory.clearFilters": { en: "Clear filters", el: "Καθαρισμός φίλτρων" },
  // Inventory has no buy action of its own (that's the Store's job) — a
  // missing common/rare tier links there instead of store.ts's own
  // "Get from a pack" wording, which would undersell that it's directly
  // purchasable one tap away.
  "inventory.viewInStore": { en: "View in Store →", el: "Δες στο κατάστημα →" },

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
