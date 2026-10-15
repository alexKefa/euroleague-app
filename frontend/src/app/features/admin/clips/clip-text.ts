import { chromeTranslations } from "../../../core/i18n/chrome";
import type { ClipPerson } from "../../../core/models";
import { roundStage } from "../../../shared/round-stage";
import { displayTeamCode } from "../../../shared/team-display-codes";

// The round clip's own words (spec: docs/superpowers/specs/2026-10-15-round-clip-design.md).
// Picked by the page's EN/EL toggle, not the app's language, so a Greek
// clip can be exported from an English session. Team names are always
// nominative; the lines are phrased so they never need declining.

export type ClipLang = "en" | "el";

const TEXT = {
  hookSaid: { en: "{pct}% of Clutch players said", el: "Το {pct}% των παικτών του Clutch είπε" },
  hookLost: { en: "THEY LOST {score}", el: "ΕΧΑΣΕ {score}" },
  hookUpsetNoPct: { en: "Nobody saw this coming", el: "Κανείς δεν το περίμενε" },
  teaser: { en: "🔒 legendary pull at the end", el: "🔒 legendary κάρτα στο τέλος" },
  topPredictor: { en: "Top predictor", el: "Κορυφαίος προβλέπων" },
  pts: { en: "+{n} pts this round", el: "+{n} πόντοι στην αγωνιστική" },
  boldOnly: { en: "Only {pct}% said", el: "Μόνο το {pct}% είπε" },
  boldWon: { en: "and they won {score}", el: "και κέρδισε {score}" },
  pulledBy: { en: "Pulled this round by", el: "Την τράβηξε στην αγωνιστική" },
  pullsCount: { en: "{n} LEGENDARIES THIS ROUND", el: "{n} LEGENDARY ΚΑΡΤΕΣ ΣΤΗΝ ΑΓΩΝΙΣΤΙΚΗ" },
  packsFree: { en: "Open packs free in Clutch", el: "Άνοιξε πακέτα δωρεάν στο Clutch" },
  ctaQuestion: { en: "THINK YOU'D DO BETTER?", el: "ΕΣΥ ΘΑ ΤΑ ΠΗΓΑΙΝΕΣ ΚΑΛΥΤΕΡΑ;" },
  ctaOpen: { en: "{round} picks are open", el: "Άνοιξαν οι προβλέψεις · {round}" },
  ctaPlay: { en: "Play the next round", el: "Παίξε στην επόμενη αγωνιστική" },
  ctaFree: { en: "Free · link in bio", el: "Δωρεάν · link στο bio" },
  legendary: { en: "LEGENDARY", el: "LEGENDARY" },
  foil: { en: "FOIL LEGENDARY", el: "FOIL LEGENDARY" },
  rare: { en: "RARE", el: "RARE" },
} as const;

export type ClipTextKey = keyof typeof TEXT;

export function clipText(key: ClipTextKey, lang: ClipLang, vars: Record<string, string | number> = {}): string {
  return Object.entries(vars).reduce((text, [k, v]) => text.replace(`{${k}}`, String(v)), TEXT[key][lang] as string);
}

/** "Round 6" / "Αγωνιστική 6" / "Playoffs · Game 1" — the app's own round names, in the clip's language. */
export function roundLabelFor(round: number, lang: ClipLang): string {
  const { stage, n } = roundStage(round);
  return chromeTranslations[`round.${stage}`][lang].replace("{n}", String(n));
}

/** The club's public abbreviation ("FBT"), never the feed's internal code ("ULK"). */
export function clipCode(code: string): string {
  return displayTeamCode(code);
}

/**
 * Capitals for headline lines. Greek capitals don't carry the tonos
 * ("ΟΛΥΜΠΙΑΚΟΣ", not "ΟΛΥΜΠΙΑΚΌΣ"), but keep the dialytika ("ΠΑΝΑΘΗΝΑΪΚΟΣ").
 */
export function clipUpper(s: string, lang: ClipLang): string {
  if (lang !== "el") return s.toUpperCase();
  return s.normalize("NFD").replace(/\u0301/g, "").normalize("NFC").toUpperCase();
}

/** The featured person's big line ("@nikos_23", or the alias) and, with a username, their title as a small line. */
export function personLines(person: ClipPerson, lang: ClipLang): { name: string; title: string | null } {
  return person.username ? { name: `@${person.username}`, title: person.title[lang] } : { name: person.alias[lang], title: null };
}

/** "@maria_k · Golden Hands of Athens": the people behind the extra pulls, one line. */
export function namesLine(people: ClipPerson[], lang: ClipLang): string {
  return people.map((p) => personLines(p, lang).name).join(" · ");
}
