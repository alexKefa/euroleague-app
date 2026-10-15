// Round clips (2026-10-15, docs/superpowers/specs/2026-10-15-round-clip-design.md):
// each club's short name in English and Greek, plus its city for the
// aliases that stand in for usernames ("The Oracle of Piraeus"). The DB has
// no Greek names and teams.city is empty, so this table is the source.
// Greek names stay nominative; the clip copy is phrased so they never need
// declining. Keyed by teams.code (the feed's club code).

export type ClipLang = "en" | "el";
export type Alias = { en: string; el: string };
export type AliasTitle = "oracle" | "loneWolf" | "goldenHands";

export const CLIP_TEAMS: Record<string, { en: string; el: string; cityEn: string; cityEl: string }> = {
  ASV: { en: "ASVEL", el: "Βιλερμπάν", cityEn: "Villeurbanne", cityEl: "της Βιλερμπάν" },
  BAR: { en: "Barcelona", el: "Μπαρτσελόνα", cityEn: "Barcelona", cityEl: "της Βαρκελώνης" },
  BAS: { en: "Baskonia", el: "Μπασκόνια", cityEn: "Vitoria", cityEl: "της Βιτόρια" },
  BES: { en: "Besiktas", el: "Μπεσίκτας", cityEn: "Istanbul", cityEl: "της Πόλης" },
  DUB: { en: "Dubai", el: "Ντουμπάι", cityEn: "Dubai", cityEl: "του Ντουμπάι" },
  HTA: { en: "Hapoel Tel Aviv", el: "Χάποελ Τελ Αβίβ", cityEn: "Tel Aviv", cityEl: "του Τελ Αβίβ" },
  IST: { en: "Anadolu Efes", el: "Εφές", cityEn: "Istanbul", cityEl: "της Πόλης" },
  MAD: { en: "Real Madrid", el: "Ρεάλ Μαδρίτης", cityEn: "Madrid", cityEl: "της Μαδρίτης" },
  MCO: { en: "Monaco", el: "Μονακό", cityEn: "Monaco", cityEl: "του Μονακό" },
  MIL: { en: "Olimpia Milano", el: "Αρμάνι Μιλάνο", cityEn: "Milan", cityEl: "του Μιλάνου" },
  MUN: { en: "Bayern", el: "Μπάγερν", cityEn: "Munich", cityEl: "του Μονάχου" },
  OLY: { en: "Olympiacos", el: "Ολυμπιακός", cityEn: "Piraeus", cityEl: "του Πειραιά" },
  PAM: { en: "Valencia", el: "Βαλένθια", cityEn: "Valencia", cityEl: "της Βαλένθιας" },
  PAN: { en: "Panathinaikos", el: "Παναθηναϊκός", cityEn: "Athens", cityEl: "της Αθήνας" },
  PAR: { en: "Partizan", el: "Παρτιζάν", cityEn: "Belgrade", cityEl: "του Βελιγραδίου" },
  PRS: { en: "Paris", el: "Παρί", cityEn: "Paris", cityEl: "του Παρισιού" },
  RED: { en: "Crvena Zvezda", el: "Ερυθρός Αστέρας", cityEn: "Belgrade", cityEl: "του Βελιγραδίου" },
  TEL: { en: "Maccabi Tel Aviv", el: "Μακάμπι Τελ Αβίβ", cityEn: "Tel Aviv", cityEl: "του Τελ Αβίβ" },
  ULK: { en: "Fenerbahce", el: "Φενέρμπαχτσε", cityEn: "Istanbul", cityEl: "της Πόλης" },
  VIR: { en: "Virtus Bologna", el: "Βίρτους Μπολόνια", cityEn: "Bologna", cityEl: "της Μπολόνια" },
  ZAL: { en: "Zalgiris", el: "Ζάλγκιρις", cityEn: "Kaunas", cityEl: "του Κάουνας" },
};

const TITLES: Record<AliasTitle, Alias> = {
  oracle: { en: "The Oracle", el: "Ο Μάντης" },
  loneWolf: { en: "The Lone Wolf", el: "Ο Μοναχικός Λύκος" },
  goldenHands: { en: "Golden Hands", el: "Χρυσά Χέρια" },
};

/** A club missing from the table (promotion, rename) keeps its DB name in both languages. */
export function clipTeamNames(code: string, fallbackName: string): { en: string; el: string } {
  const team = CLIP_TEAMS[code];
  return team ? { en: team.en, el: team.el } : { en: fallbackName, el: fallbackName };
}

/** "The Oracle of Piraeus" / "Ο Μάντης του Πειραιά"; the bare title without a known favourite team. */
export function clipAlias(title: AliasTitle, teamCode: string | null): Alias {
  const t = TITLES[title];
  const team = teamCode ? CLIP_TEAMS[teamCode] : undefined;
  return team ? { en: `${t.en} of ${team.cityEn}`, el: `${t.el} ${team.cityEl}` } : { ...t };
}

/**
 * The username a clip may show, or null to fall back to the alias: the user
 * opted out (users.feature_in_clips), or still has the auto-generated
 * "clutch-user-######" handle, which would read like a bot on TikTok.
 */
export function clipUsername(username: string, featureInClips: boolean): string | null {
  if (!featureInClips || /^clutch-user-\d+$/.test(username)) return null;
  return username;
}
