import { Lang } from "./lang";

// Daily Question (2026-10-13): the dashboard card, the play overlay and the
// admin "suspicious accounts" list.
export const dailyQuestionTranslations: Record<string, Record<Lang, string>> = {
  "dq.title": { en: "Daily question", el: "Ερώτηση της ημέρας" },
  "dq.ready": { en: "Today's question is ready", el: "Η σημερινή ερώτηση σε περιμένει" },
  "dq.play": { en: "Play", el: "Παίξε" },
  "dq.resume": { en: "Resume", el: "Συνέχεια" },
  "dq.streak": { en: "{n}-day streak", el: "Σερί {n} ημερών" },
  "dq.next": { en: "+{n} points today", el: "+{n} πόντοι σήμερα" },
  "dq.rules": { en: "10 seconds, one try. Come back daily to grow your streak.", el: "10 δευτερόλεπτα, μία προσπάθεια. Έλα κάθε μέρα για να μεγαλώσει το σερί." },
  // "More" lives in the stat strings so each Greek stat carries its own agreement.
  "dq.q.last_night": { en: "Who had {stat} last night?", el: "Ποιος είχε {stat} χθες;" },
  "dq.q.last_game": { en: "Who had {stat} in his last game?", el: "Ποιος είχε {stat} στον τελευταίο του αγώνα;" },
  "dq.q.last_3": { en: "Who had {stat} over his last 3 games?", el: "Ποιος είχε {stat} στους 3 τελευταίους του αγώνες;" },
  "dq.stat.points": { en: "more points", el: "περισσότερους πόντους" },
  "dq.stat.rebounds": { en: "more rebounds", el: "περισσότερα ριμπάουντ" },
  "dq.stat.assists": { en: "more assists", el: "περισσότερες ασίστ" },
  "dq.stat.pir": { en: "a higher PIR", el: "μεγαλύτερο PIR" },
  "dq.stat.threes": { en: "more threes made", el: "περισσότερα εύστοχα τρίποντα" },
  "dq.correct": { en: "Correct!", el: "Σωστό!" },
  "dq.wrong": { en: "Not this time", el: "Όχι αυτή τη φορά" },
  "dq.timeout": { en: "Time's up", el: "Τέλος χρόνου" },
  "dq.pts.streak": { en: "Streak", el: "Σερί" },
  "dq.pts.correct": { en: "Correct answer", el: "Σωστή απάντηση" },
  "dq.pts.milestone": { en: "Milestone", el: "Ορόσημο" },
  "dq.pts.total": { en: "Total", el: "Σύνολο" },
  "dq.tomorrow": { en: "Come back tomorrow to keep your streak", el: "Έλα αύριο για να κρατήσεις το σερί" },
  "dq.unavailable": { en: "No question today", el: "Δεν υπάρχει ερώτηση σήμερα" },
  "dq.locked": { en: "Points unlock on {date}", el: "Οι πόντοι ξεκλειδώνουν στις {date}" },
  "dq.close": { en: "Close", el: "Κλείσιμο" },
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
