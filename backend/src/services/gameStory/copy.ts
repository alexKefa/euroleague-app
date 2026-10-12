// Game story cards (2026-10-09): every word on a card, as fixed EN/EL
// templates filled with the game's numbers — never AI-written, so a card
// can't say anything the data doesn't. Lede variants rotate by a hash of
// the game id, so re-rendering the same game gives the same text.
// Checked by scripts/check-game-story.ts.
import { loserOf, winnerOf } from "./angles.js";
import type { EdgeData, GameFacts, KeyNote, Story } from "./types.js";

export type Lang = "en" | "el";
type T = { en: string; el: string };

export interface KeyNoteText {
  label: string; // "WHAT WON IT" / "LED BY"
  big: string; // the number in the strip
  title: string; // what the number is
  sentence: string;
}

export interface StoryText {
  label: string;
  headline: string;
  lede: string;
  key: KeyNoteText | null;
  context: string;
  matchup: string;
  shareText: string;
  footnote: string | null;
  labels: Record<LabelKey, string>;
}

const LABELS = {
  final: { en: "Final", el: "Τελικό" },
  finalOt: { en: "Final · OT", el: "Τελικό · παράταση" },
  tape: { en: "Tale of the tape", el: "Η σύγκριση" },
  bestLineup: { en: "Best lineup of the game", el: "Η καλύτερη πεντάδα του αγώνα" },
  min: { en: "Min", el: "Λεπ." },
  score: { en: "Score", el: "Σκορ" },
  pm: { en: "+/-", el: "+/-" },
  netRating: { en: "Net rating", el: "Net rating" },
  possessions: { en: "possessions", el: "κατοχές" },
  last5: { en: "Last 5 games", el: "Τελευταίοι 5 αγώνες" },
  shooting: { en: "Shooting", el: "Σουτ" },
  keyPlays: { en: "Key plays", el: "Οι φάσεις που το έκριναν" },
  topScorers: { en: "Top scorers", el: "Πρώτοι σκόρερ" },
  margin: { en: "Score margin", el: "Διαφορά στο σκορ" },
  careerHigh: { en: "Career high", el: "Ρεκόρ καριέρας" },
  clutchPts: { en: "points in crunch time", el: "πόντοι στο φινάλε" },
  colPts: { en: "PTS", el: "ΠΟΝ" },
  colReb: { en: "REB", el: "ΡΙΜΠ" },
  colAst: { en: "AST", el: "ΑΣΙ" },
  tapeShooting: { en: "Field goal %", el: "Εντός πεδιάς %" },
  tapeThrees: { en: "Threes", el: "Τρίποντα" },
  tapeBoards: { en: "Rebounds", el: "Ριμπάουντ" },
  tapeAssists: { en: "Assists", el: "Ασίστ" },
  tapeTurnovers: { en: "Turnovers", el: "Λάθη" },
  tapeFreeThrows: { en: "Free throws", el: "Βολές" },
} satisfies Record<string, T>;
export type LabelKey = keyof typeof LABELS;

const ANGLE_LABEL: Record<Story["angle"], T> = {
  edge: { en: "What won it", el: "Αυτό το έκρινε" },
  lineup: { en: "Best lineup", el: "Η καλύτερη πεντάδα" },
  explosion: { en: "Big night", el: "Μεγάλη βραδιά" },
  comeback: { en: "Comeback", el: "Ανατροπή" },
  clutch: { en: "Clutch finish", el: "Θρίλερ στο φινάλε" },
  numbers: { en: "Game in numbers", el: "Ο αγώνας σε αριθμούς" },
};

const LEDES: Record<Exclude<Story["angle"], "edge">, T[]> = {
  lineup: [
    { en: "One five changed the game for {team}.", el: "{team}: μία πεντάδα άλλαξε το ματς." },
    { en: "The best {team} five went {pm} in {min} minutes.", el: "{team}: η καλύτερη πεντάδα έκανε {pm} σε {min} λεπτά." },
  ],
  explosion: [
    { en: "{player} took over.", el: "Ο {player} πήρε το ματς πάνω του." },
    { en: "{player} had the night of the round.", el: "Ο {player} είχε τη βραδιά της αγωνιστικής." },
  ],
  comeback: [
    { en: "{team} were down {deficit} and still won.", el: "{team}: από το -{deficit} στη νίκη." },
    { en: "From {deficit} down to a {final}-point win for {team}.", el: "{team}: από το -{deficit} σε νίκη με {final}." },
  ],
  clutch: [
    { en: "{team} won it at the end.", el: "{team}: νίκη στο φινάλε." },
    { en: "It came down to the last possessions, and {team} made them count.", el: "{team}: κρίθηκε στις τελευταίες κατοχές." },
  ],
  numbers: [
    { en: "{team} beat {loser}.", el: "{team}: νίκη με διαφορά {final} πόντων." },
    { en: "A {final}-point win for {team}.", el: "{team}: νίκη με {final} πόντους." },
  ],
};

// One sentence per edge: the card's lede (edge angle) or its key note.
const EDGE_SENTENCE: Record<EdgeData["key"], T> = {
  run: { en: "{team} scored {w} unanswered points in {period}.", el: "{team}: {w} συνεχόμενοι πόντοι χωρίς απάντηση στην {period}." },
  quarter: { en: "{team} won {period} {w}-{l}.", el: "{team}: κέρδισε την {period} με {w}-{l}." },
  threes: { en: "{team} hit {w} threes to {l}: {pts} more points from beyond the arc.", el: "{team}: {w} τρίποντα έναντι {l}, δηλαδή {pts} πόντοι διαφορά πίσω από τα 6,75." },
  boards: { en: "{team} out-rebounded {loser} {w}-{l}.", el: "{team}: {w}-{l} στα ριμπάουντ." },
  turnovers: { en: "{team} turned it over {w} times, {loser} {l}.", el: "{team}: {w} λάθη, έναντι {l} του αντιπάλου." },
  freeThrows: { en: "{team} made {w} free throws to {l}.", el: "{team}: {w} εύστοχες βολές έναντι {l}." },
  assists: { en: "{team} moved the ball: {w} assists to {l}.", el: "{team}: {w} ασίστ έναντι {l}." },
  shooting: { en: "{team} shot {w}% from the field, {loser} {l}%.", el: "{team}: {w}% εντός πεδιάς, έναντι {l}% του αντιπάλου." },
};

// What the strip's number is.
const EDGE_TITLE: Record<EdgeData["key"], T> = {
  run: { en: "Run in {periodShort}", el: "Σερί στην {periodShort}" },
  quarter: { en: "In {periodShort}", el: "Στην {periodShort}" },
  threes: { en: "Threes made", el: "Εύστοχα τρίποντα" },
  boards: { en: "Rebounds", el: "Ριμπάουντ" },
  turnovers: { en: "Turnovers", el: "Λάθη" },
  freeThrows: { en: "Free throws made", el: "Εύστοχες βολές" },
  assists: { en: "Assists", el: "Ασίστ" },
  shooting: { en: "Field goal %", el: "Εντός πεδιάς" },
};

const PERIOD_LONG: T[] = [
  { en: "the first quarter", el: "1η περίοδο" },
  { en: "the second quarter", el: "2η περίοδο" },
  { en: "the third quarter", el: "3η περίοδο" },
  { en: "the fourth quarter", el: "4η περίοδο" },
  { en: "overtime", el: "παράταση" },
];
const PERIOD_SHORT: T[] = [
  { en: "Q1", el: "1η περίοδο" },
  { en: "Q2", el: "2η περίοδο" },
  { en: "Q3", el: "3η περίοδο" },
  { en: "Q4", el: "4η περίοδο" },
  { en: "OT", el: "παράταση" },
];
const periodOf = (list: T[], p: number | null, lang: Lang) => list[Math.min(Math.max((p ?? 1) - 1, 0), 4)][lang];

const FOOTNOTE: T = {
  en: "Net rating = points scored minus points allowed per 100 possessions. Single-game lineup data, small sample.",
  el: "Net rating = πόντοι που σημειώθηκαν μείον πόντοι που δέχθηκαν ανά 100 κατοχές. Δεδομένα ενός αγώνα, μικρό δείγμα.",
};

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

function variant<V>(list: V[], gameId: string): V {
  let h = 0;
  for (const ch of gameId) h = (h + ch.charCodeAt(0)) % 9973;
  return list[h % list.length];
}

/** Upper case; Greek capitals drop the tonos (keep the dialytika). */
export const upper = (s: string, lang: Lang = "el") =>
  s.toLocaleUpperCase(lang === "el" ? "el-GR" : "en-GB").normalize("NFD").replace(/́/g, "").normalize("NFC");

function edgeVars(e: EdgeData, lang: Lang): Record<string, string | number> {
  return {
    w: e.winner,
    l: e.loser,
    diff: e.diff,
    pts: e.diff * 3,
    period: periodOf(PERIOD_LONG, e.period, lang),
    periodShort: periodOf(PERIOD_SHORT, e.period, lang),
  };
}

/** The strip's big number for an edge. */
export function edgeBig(e: EdgeData): string {
  if (e.key === "run") return `${e.winner}–0`;
  if (e.key === "quarter") return `+${e.diff}`;
  if (e.key === "shooting") return `${e.winner}%`;
  return `${e.winner}–${e.loser}`;
}

function edgeHeadline(e: EdgeData, lang: Lang): string {
  const el = lang === "el";
  const ps = upper(periodOf(PERIOD_SHORT, e.period, lang), lang);
  switch (e.key) {
    case "run": return el ? `${e.winner}–0 ΣΕΡΙ` : `${e.winner}–0 RUN`;
    case "quarter": return el ? `+${e.diff} ΣΤΗΝ ${ps}` : `+${e.diff} IN ${ps}`;
    case "threes": return el ? `+${e.diff} ΤΡΙΠΟΝΤΑ` : `+${e.diff} FROM THREE`;
    case "boards": return el ? `+${e.diff} ΡΙΜΠΑΟΥΝΤ` : `+${e.diff} ON THE BOARDS`;
    case "turnovers": return el ? `${e.diff} ΛΙΓΟΤΕΡΑ ΛΑΘΗ` : `${e.diff} FEWER TURNOVERS`;
    case "freeThrows": return el ? `+${e.diff} ΣΤΙΣ ΒΟΛΕΣ` : `+${e.diff} AT THE LINE`;
    case "assists": return el ? `+${e.diff} ΑΣΙΣΤ` : `+${e.diff} ASSISTS`;
    case "shooting": return el ? `${e.winner}% ΣΤΑ ΣΟΥΤ` : `${e.winner}% SHOOTING`;
  }
}

function headline(story: Story, lang: Lang, f: GameFacts): string {
  const el = lang === "el";
  switch (story.angle) {
    case "edge":
      return edgeHeadline(story.data, lang);
    case "lineup": {
      const l = story.data.lineup;
      if (l.netRating !== null) return `${l.netRating > 0 ? "+" : ""}${Math.round(l.netRating)} NET RATING`;
      return `+${l.plusMinus} ${el ? "ΣΕ" : "IN"} ${Math.round(l.seconds / 60)} ${el ? "ΛΕΠΤΑ" : "MIN"}`;
    }
    case "explosion":
      return story.data.stat === "pir" ? `PIR ${story.data.value}` : `${story.data.value} ${el ? "ΠΟΝΤΟΙ" : "POINTS"}`;
    case "comeback":
      return el ? `ΑΠΟ ΤΟ -${story.data.deficit} ΣΤΟ +${story.data.finalMargin}` : `DOWN ${story.data.deficit}, WON BY ${story.data.finalMargin}`;
    case "clutch":
      if (story.data.overtime) return el ? "ΝΙΚΗ ΣΤΗΝ ΠΑΡΑΤΑΣΗ" : "WON IN OVERTIME";
      if (el) return story.data.margin === 1 ? "ΚΡΙΘΗΚΕ ΣΤΟΝ 1 ΠΟΝΤΟ" : `ΚΡΙΘΗΚΕ ΣΤΟΥΣ ${story.data.margin} ΠΟΝΤΟΥΣ`;
      return `DECIDED BY ${story.data.margin}`;
    case "numbers":
      return `${f.home.score}–${f.away.score}`;
  }
}

function keyText(key: KeyNote | null, base: Record<string, string | number>, lang: Lang): KeyNoteText | null {
  if (!key) return null;
  if (key.kind === "edge") {
    const vars = { ...base, ...edgeVars(key.edge, lang) };
    return {
      label: upper(ANGLE_LABEL.edge[lang], lang),
      big: edgeBig(key.edge),
      title: upper(fill(EDGE_TITLE[key.edge.key][lang], vars), lang),
      sentence: fill(EDGE_SENTENCE[key.edge.key][lang], vars),
    };
  }
  const l = key.line;
  const el = lang === "el";
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return {
    label: el ? "ΠΡΩΤΑΓΩΝΙΣΤΗΣ" : "LED BY",
    big: String(l.points),
    title: upper(l.name, lang),
    sentence: [
      el ? count(l.points, "πόντος", "πόντοι") : count(l.points, "point", "points"),
      el ? count(l.rebounds, "ριμπάουντ", "ριμπάουντ") : count(l.rebounds, "rebound", "rebounds"),
      el ? count(l.assists, "ασίστ", "ασίστ") : count(l.assists, "assist", "assists"),
      `PIR ${l.pir}`,
    ].join(" · "),
  };
}

export function storyText(story: Story, f: GameFacts, lang: Lang): StoryText {
  const w = winnerOf(f);
  const loser = loserOf(f);
  const final = Math.abs(f.home.score - f.away.score);
  const base: Record<string, string | number> = { team: w.name, loser: loser.name, final };
  const vars = { ...base };

  switch (story.angle) {
    case "edge":
      Object.assign(vars, edgeVars(story.data, lang));
      break;
    case "lineup": {
      const l = story.data.lineup;
      Object.assign(vars, { pm: `${l.plusMinus > 0 ? "+" : ""}${l.plusMinus}`, min: Math.round(l.seconds / 60) });
      vars.team = (l.teamId === f.home.id ? f.home : f.away).name;
      break;
    }
    case "explosion":
      vars.player = story.data.line.name;
      break;
    case "comeback":
      vars.deficit = story.data.deficit;
      break;
  }

  const date = new Intl.DateTimeFormat(lang === "el" ? "el-GR" : "en-GB", {
    timeZone: "Europe/Athens",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(f.tipoffAt));
  const round = f.round !== null ? (lang === "el" ? ` · Αγωνιστική ${f.round}` : ` · Round ${f.round}`) : "";
  const matchup = `${f.home.name} ${f.home.score}–${f.away.score} ${f.away.name}`;
  const head = headline(story, lang, f);
  const labels = Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [k, v[lang]])) as Record<LabelKey, string>;
  const lede = story.angle === "edge" ? EDGE_SENTENCE[story.data.key][lang] : variant(LEDES[story.angle], f.gameId)[lang];

  return {
    label: upper(ANGLE_LABEL[story.angle][lang], lang),
    headline: head,
    lede: fill(lede, vars),
    key: keyText(story.key, base, lang),
    context: `EuroLeague ${f.season}${round} · ${date}`,
    matchup,
    // The numbers headline is the score itself, so don't repeat it.
    shareText: `${story.angle === "numbers" ? "" : `${head}: `}${matchup} #EuroLeague getclutchapp.com/games/${f.gameId}`,
    footnote: story.angle === "lineup" ? FOOTNOTE[lang] : null,
    labels,
  };
}
