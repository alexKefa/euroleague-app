import { Lang } from "./lang";

// features/court — Clutch Court (3D shootaround).
export const courtTranslations: Record<string, Record<Lang, string>> = {
  "nav.court": { en: "Court", el: "Γήπεδο" },
  "court.loading": { en: "Warming up…", el: "Ζέσταμα…" },
  "court.error": { en: "Your device couldn't start 3D graphics.", el: "Η συσκευή σου δεν μπόρεσε να ξεκινήσει τα τρισδιάστατα γραφικά." },
  "court.contextLost": { en: "Graphics were paused by your device.", el: "Η συσκευή σου σταμάτησε τα γραφικά." },
  "court.restart": { en: "Restart", el: "Επανεκκίνηση" },
  "court.back": { en: "Back", el: "Πίσω" },
  "court.shoot": { en: "Shoot", el: "Σουτ" },
  "court.camera": { en: "Camera", el: "Κάμερα" },
  "court.sound": { en: "Sound", el: "Ήχος" },
  "court.streak": { en: "Streak", el: "Σερί" },
  "court.best": { en: "Best", el: "Ρεκόρ" },
  "court.bucket": { en: "Bucket!", el: "Καλάθι!" },
  "court.onFire": { en: "{n} in a row!", el: "{n} στη σειρά!" },
  "court.release.perfect": { en: "Perfect release", el: "Τέλειο σουτ" },
  "court.release.good": { en: "Good", el: "Καλό" },
  "court.release.early": { en: "Early", el: "Νωρίς" },
  "court.release.late": { en: "Late", el: "Αργά" },
  "court.hintDesktop": {
    en: "WASD / arrows to move · hold Space to shoot, release in the green · C camera",
    el: "WASD / βελάκια για κίνηση · κράτα το Space για σουτ, άφησέ το στο πράσινο · C κάμερα",
  },
};
