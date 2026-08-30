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

  // Game log — GET /api/players/:id/games
  "player.gameLog": { en: "Game Log", el: "Ιστορικό Αγώνων" },
  "player.gameLogNoData": { en: "No game log yet this season.", el: "Δεν υπάρχει ακόμα ιστορικό αγώνων φέτος." },
  "player.colDate": { en: "Date", el: "Ημ/νία" },
  "player.colOpp": { en: "Opp", el: "Αντίπ." },
  "player.colResult": { en: "Result", el: "Αποτ." },
  "player.colMin": { en: "MIN", el: "ΛΕΠ" },
  "player.colPts": { en: "PTS", el: "ΠΟΝ" },
  "player.colReb": { en: "REB", el: "ΡΙΜΠ" },
  "player.colAst": { en: "AST", el: "ΑΣΙ" },
  "player.colStl": { en: "STL", el: "ΚΛΕ" },
  "player.colBlk": { en: "BLK", el: "ΚΟΨ" },
  "player.colTov": { en: "TOV", el: "ΛΑΘ" },
  "player.colPir": { en: "PIR", el: "PIR" },

  // features/player/shot-chart.ts
  "shotChart.title": { en: "Shot Chart", el: "Χάρτης Σουτ" },
  "shotChart.filterAll": { en: "All", el: "Όλα" },
  "shotChart.made": { en: "Made", el: "Εύστοχο" },
  "shotChart.missed": { en: "Missed", el: "Άστοχο" },
  "shotChart.noData": { en: "No shot data yet", el: "Δεν υπάρχουν ακόμα δεδομένα σουτ" },
  "shotChart.zonePaint": { en: "Paint", el: "Ρακέτα" },
  "shotChart.zoneMid": { en: "Mid-range", el: "Μεσαία απόσταση" },
  "shotChart.zoneThree": { en: "Three", el: "Τρίποντο" },
  "shotChart.zoneAttempts": { en: "attempts", el: "προσπάθειες" },
};
