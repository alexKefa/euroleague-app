import { Lang } from "./lang";

export const scheduleTranslations: Record<string, Record<Lang, string>> = {
  "schedule.title": { en: "Schedule", el: "Πρόγραμμα" },
  "schedule.seasonLabel": { en: "2026-27 season", el: "Σεζόν 2026-27" },
  "schedule.prevRound": { en: "Previous round", el: "Προηγούμενος γύρος" },
  "schedule.nextRound": { en: "Next round", el: "Επόμενος γύρος" },
  "schedule.round": { en: "Round", el: "Γύρος" },
  "schedule.allTeams": { en: "All teams", el: "Όλες οι ομάδες" },
  "schedule.noGamesForTeam": {
    en: "That team doesn't play this round.",
    el: "Αυτή η ομάδα δεν αγωνίζεται σε αυτόν τον γύρο.",
  },
  "schedule.clearTeamFilter": { en: "Clear team filter", el: "Καθαρισμός φίλτρου ομάδας" },
  "schedule.hint": {
    en: "Step through rounds with the arrows, or filter to one team. Tap any game for the full box score — live games update automatically.",
    el: "Μετακινήσου στους γύρους με τα βέλη ή φιλτράρισε ανά ομάδα. Πάτησε σε έναν αγώνα για τα πλήρη στατιστικά — οι ζωντανοί αγώνες ενημερώνονται αυτόματα.",
  },
  "schedule.noGamesRound": {
    en: "No games scheduled for this round.",
    el: "Δεν έχουν προγραμματιστεί αγώνες για αυτόν τον γύρο.",
  },
  "schedule.live": { en: "Live", el: "Ζωντανά" },
  "schedule.simulateLiveAdmin": {
    en: "Admin: simulate a live game",
    el: "Διαχειριστής: προσομοίωση ζωντανού αγώνα",
  },
  "schedule.finishLiveAdmin": {
    en: "Admin: fast-forward simulation",
    el: "Διαχειριστής: γρήγορη προσομοίωση",
  },
};
