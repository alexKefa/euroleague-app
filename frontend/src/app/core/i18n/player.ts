import { Lang } from "./lang";

export const playerTranslations: Record<string, Record<Lang, string>> = {
  "player.seasonAverages": { en: "Season averages", el: "Μέσοι όροι σεζόν" },
  "player.advanced": { en: "Advanced", el: "Προχωρημένα στατιστικά" },
  "player.noStatsYet": {
    en: "No season stats yet for this player.",
    el: "Δεν υπάρχουν ακόμα στατιστικά σεζόν για αυτόν τον παίκτη.",
  },
  "player.noPlayerSpecified": { en: "No player specified.", el: "Δεν έχει οριστεί παίκτης." },
  "player.couldntLoad": { en: "Couldn't load this player.", el: "Δεν ήταν δυνατή η φόρτωση αυτού του παίκτη." },

  // features/player/shot-chart.ts
  "shotChart.title": { en: "Shot Chart", el: "Χάρτης Σουτ" },
  "shotChart.filterAll": { en: "All", el: "Όλα" },
  "shotChart.made": { en: "Made", el: "Εύστοχο" },
  "shotChart.missed": { en: "Missed", el: "Άστοχο" },
  "shotChart.noData": { en: "No shot data yet", el: "Δεν υπάρχουν ακόμα δεδομένα σουτ" },
};
