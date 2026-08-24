import { Lang } from "./lang";

// The full standings page (frontend/src/app/features/standings/) — the
// same GET /api/standings the dashboard's cramped widget already uses,
// just as a sortable full-width table with the columns that widget has no
// room for (PPG/PAPG/ratings/rebound-assist %).
export const standingsTranslations: Record<string, Record<Lang, string>> = {
  "standings.title": { en: "Standings", el: "Βαθμολογία" },
  "standings.subtitle": {
    en: "Full league table, sortable by any column — record, scoring, and team-level advanced stats.",
    el: "Πλήρης πίνακας πρωταθλήματος, ταξινομήσιμος σε κάθε στήλη — ρεκόρ, σκοράρισμα και προχωρημένα στατιστικά ομάδας.",
  },
  "standings.colRank": { en: "#", el: "#" },
  "standings.colTeam": { en: "Team", el: "Ομάδα" },
  "standings.colW": { en: "W", el: "Ν" },
  "standings.colL": { en: "L", el: "Η" },
  "standings.colPpg": { en: "PPG", el: "ΠΟΝ/ΑΓ" },
  "standings.colPapg": { en: "PAPG", el: "ΔΕΧ/ΑΓ" },
  "standings.colOff": { en: "OFF RTG", el: "ΕΠΙΘ." },
  "standings.colDef": { en: "DEF RTG", el: "ΑΜΥΝ." },
  "standings.viewFull": { en: "Full standings", el: "Πλήρης βαθμολογία" },

  "standings.legendRank": {
    en: "League position, from the official EuroLeague standings",
    el: "Θέση στο πρωτάθλημα, από την επίσημη βαθμολογία της EuroLeague",
  },
  "standings.legendW": { en: "Wins", el: "Νίκες" },
  "standings.legendL": { en: "Losses", el: "Ήττες" },
  "standings.legendPpg": { en: "Points scored per game", el: "Πόντοι που πέτυχε ανά αγώνα" },
  "standings.legendPapg": { en: "Points allowed per game", el: "Πόντοι που δέχτηκε ανά αγώνα" },
  "standings.legendOff": {
    en: "Effective field goal % — the team's own shooting efficiency, not points per possession",
    el: "Effective field goal % — η επιθετική απόδοση σουτ της ομάδας, όχι πόντοι ανά κατοχή",
  },
  "standings.legendDef": {
    en: "100 minus opponents' effective field goal % — higher means a tougher defense",
    el: "100 μείον το effective field goal % των αντιπάλων — όσο μεγαλύτερο, τόσο πιο σκληρή άμυνα",
  },
};
