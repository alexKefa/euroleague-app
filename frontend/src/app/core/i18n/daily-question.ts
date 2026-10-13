import { Lang } from "./lang";

// Daily Question (2026-10-13): the dashboard card, the play overlay and the
// admin "suspicious accounts" list.
export const dailyQuestionTranslations: Record<string, Record<Lang, string>> = {
  "admin.dqTitle": { en: "Daily question watch", el: "Έλεγχος ερώτησης ημέρας" },
  "admin.toolDqDesc": { en: "Accounts answering near-perfectly and suspiciously fast", el: "Λογαριασμοί με σχεδόν τέλειες και ύποπτα γρήγορες απαντήσεις" },
  "admin.dqDescription": {
    en: "Last 30 days: at least 14 answers, 90%+ correct, median answer under 1.5 s. A flag, not proof.",
    el: "Τελευταίες 30 ημέρες: τουλάχιστον 14 απαντήσεις, 90%+ σωστές, μέσος χρόνος κάτω από 1,5 δλ. Ένδειξη, όχι απόδειξη.",
  },
  "admin.dqNone": { en: "No suspicious accounts", el: "Κανένας ύποπτος λογαριασμός" },
  "admin.dqLoadFailed": { en: "Couldn't load the list", el: "Δεν φορτώθηκε η λίστα" },
  "admin.dqAnswers": { en: "Answers", el: "Απαντήσεις" },
  "admin.dqCorrect": { en: "Correct", el: "Σωστές" },
  "admin.dqMedian": { en: "Median time", el: "Μέσος χρόνος" },
};
