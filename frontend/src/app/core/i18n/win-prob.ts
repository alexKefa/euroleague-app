import { Lang } from "./lang";

// Win probability (2026-10-07, features/game/win-prob-card.ts + the live
// chip and the Predictions model line).
export const winProbTranslations: Record<string, Record<Lang, string>> = {
  "winProb.title": { en: "Win probability", el: "Πιθανότητα νίκης" },
  "winProb.preGame": { en: "Pre-game", el: "Πριν το τζάμπολ" },
  "winProb.fromOdds": { en: "from betting odds", el: "από τις αποδόσεις" },
  "winProb.fromElo": { en: "from team ratings", el: "από τη βαθμολογία ομάδων" },
  "winProb.model": { en: "Model", el: "Μοντέλο" },
  "winProb.clutchPredicts": { en: "Clutch predicts", el: "Το Clutch προβλέπει" },
  "winProb.biggestSwings": { en: "Biggest swings", el: "Οι μεγαλύτερες ανατροπές" },
  "winProb.peak": { en: "{team} peaked at {p}% ({time})", el: "{team}: κορυφή στο {p}% ({time})" },
  "winProb.pending": {
    en: "Full chart after the next play-by-play sync (hourly).",
    el: "Το πλήρες γράφημα μετά τον επόμενο συγχρονισμό (κάθε ώρα).",
  },
  "winProb.howItWorks": {
    en: "Score margin and time left, starting from the pre-game chance.",
    el: "Διαφορά σκορ και χρόνος που απομένει, με αφετηρία την πιθανότητα πριν τον αγώνα.",
  },
  "winProb.play.2FGM": { en: "2-pointer", el: "δίποντο" },
  "winProb.play.3FGM": { en: "3-pointer", el: "τρίποντο" },
  "winProb.play.FTM": { en: "free throw", el: "βολή" },
  "winProb.ot": { en: "OT", el: "Παρ." },
};
