// Game story cards (2026-10-09): every word on a card, as fixed EN/EL
// templates filled with the game's numbers — never AI-written, so a card
// can't say anything the data doesn't. Lede/takeaway variants rotate by a
// hash of the game id, so re-rendering the same game gives the same text.
// Checked by scripts/check-game-story.ts.
import { winnerOf } from "./angles.js";
import type { GameFacts, Story, TeamFacts } from "./types.js";

export type Lang = "en" | "el";
type T = { en: string; el: string };

export interface StoryText {
  label: string;
  headline: string;
  lede: string;
  takeaway: string;
  context: string;
  matchup: string;
  shareText: string;
  footnote: string | null;
  labels: Record<LabelKey, string>;
}

const LABELS = {
  pointsSplit: { en: "Points split", el: "Κατανομή πόντων" },
  benchScorers: { en: "Bench scorers", el: "Σκόρερ από τον πάγκο" },
  byLineupType: { en: "Plus-minus by lineup type", el: "+/- ανά τύπο πεντάδας" },
  bestLineup: { en: "Best lineup of the game", el: "Η καλύτερη πεντάδα του αγώνα" },
  starters: { en: "Starters", el: "Βασικοί" },
  bench: { en: "Bench", el: "Πάγκος" },
  startersOnCourt: { en: "Starters on court", el: "Βασικοί στο παρκέ" },
  min: { en: "Min", el: "Λεπ." },
  score: { en: "Score", el: "Σκορ" },
  pm: { en: "+/-", el: "+/-" },
  netRating: { en: "Net rating", el: "Net rating" },
  possessions: { en: "possessions", el: "κατοχές" },
  last5: { en: "Last 5 games", el: "Τελευταίοι 5 αγώνες" },
  shooting: { en: "Shooting", el: "Σουτ" },
  keyPlays: { en: "Key plays", el: "Οι φάσεις που το έκριναν" },
  keyTakeaway: { en: "Key takeaway", el: "Το συμπέρασμα" },
  topScorers: { en: "Top scorers", el: "Πρώτοι σκόρερ" },
  margin: { en: "Score margin", el: "Διαφορά στο σκορ" },
  careerHigh: { en: "Career high", el: "Ρεκόρ καριέρας" },
  pts: { en: "pts", el: "πόν." },
  noStarters: { en: "No starters", el: "Χωρίς βασικούς" },
} satisfies Record<string, T>;
export type LabelKey = keyof typeof LABELS;

const ANGLE_LABEL: Record<Story["angle"], T> = {
  bench: { en: "Bench impact", el: "Η δύναμη του πάγκου" },
  lineup: { en: "Best lineup", el: "Η καλύτερη πεντάδα" },
  explosion: { en: "Big night", el: "Μεγάλη βραδιά" },
  comeback: { en: "Comeback", el: "Ανατροπή" },
  clutch: { en: "Clutch finish", el: "Θρίλερ στο φινάλε" },
  numbers: { en: "Game in numbers", el: "Ο αγώνας σε αριθμούς" },
};

const LEDES: Record<Story["angle"], T[]> = {
  bench: [
    { en: "{team}'s bench won this one.", el: "{team}: ο πάγκος κέρδισε αυτό το ματς." },
    { en: "{team} got {bench} points from the bench.", el: "{team}: {bench} πόντοι από τον πάγκο." },
    { en: "The second unit carried {team}.", el: "{team}: η δεύτερη πεντάδα σήκωσε το βάρος." },
  ],
  lineup: [
    { en: "One {team} five changed the game.", el: "{team}: μία πεντάδα άλλαξε το ματς." },
    { en: "{team}'s best five went {pm} in {min} minutes.", el: "{team}: η καλύτερη πεντάδα έκανε {pm} σε {min} λεπτά." },
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
    { en: "{team} beat {loser}.", el: "{team} – {loser}: η νίκη πήγε στους πρώτους." },
    { en: "A {final}-point win for {team}.", el: "{team}: νίκη με {final} πόντους." },
  ],
};

const TAKEAWAYS: Record<Story["angle"], T[]> = {
  bench: [
    { en: "The bench scored {pct}% of {team}'s points; the starting five scored {starters}.", el: "{team}: ο πάγκος έβαλε το {pct}% των πόντων· η αρχική πεντάδα έβαλε {starters}." },
    { en: "{bench} bench points against {loserScore} for {loser} as a whole team.", el: "{bench} πόντοι από τον πάγκο· η αντίπαλος ομάδα ({loser}) έβαλε {loserScore} συνολικά." },
  ],
  lineup: [
    { en: "In {min} minutes together they outscored their opponent {pf}-{pa}.", el: "Σε {min} λεπτά μαζί έκαναν {pf}-{pa} στον αντίπαλο." },
  ],
  explosion: [
    { en: "{player} finished with {pts} points and PIR {pir}.", el: "Ο {player} τελείωσε με {pts} πόντους και PIR {pir}." },
  ],
  comeback: [
    { en: "The biggest deficit was {deficit}; the final margin was {final}.", el: "Η μεγαλύτερη διαφορά ήταν {deficit}· η τελική ήταν {final}." },
  ],
  clutch: [
    { en: "Final margin: {final}. {hero}", el: "Τελική διαφορά: {final}. {hero}" },
  ],
  numbers: [
    { en: "Top scorers: {homeTop} and {awayTop}.", el: "Πρώτοι σκόρερ: {homeTop} και {awayTop}." },
  ],
};

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

const upper = (s: string, lang: Lang) => s.toLocaleUpperCase(lang === "el" ? "el-GR" : "en-GB").normalize("NFD").replace(/[́̈]/g, "").normalize("NFC");

function headline(story: Story, lang: Lang, f: GameFacts): string {
  const el = lang === "el";
  switch (story.angle) {
    case "bench":
      return el ? `${story.data.benchPoints} ΠΟΝΤΟΙ ΑΠΟ ΤΟΝ ΠΑΓΚΟ` : `${story.data.benchPoints} BENCH POINTS`;
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

export function storyText(story: Story, f: GameFacts, lang: Lang): StoryText {
  const w = winnerOf(f);
  const loser: TeamFacts = w.id === f.home.id ? f.away : f.home;
  const final = Math.abs(f.home.score - f.away.score);
  const vars: Record<string, string | number> = { team: w.name, loser: loser.name, final, loserScore: loser.score };

  switch (story.angle) {
    case "bench":
      Object.assign(vars, { bench: story.data.benchPoints, starters: story.data.starterPoints, pct: Math.round(story.data.share * 100) });
      break;
    case "lineup": {
      const l = story.data.lineup;
      Object.assign(vars, { pm: `${l.plusMinus > 0 ? "+" : ""}${l.plusMinus}`, min: Math.round(l.seconds / 60), pf: l.ptsFor, pa: l.ptsAgainst });
      vars.team = (l.teamId === f.home.id ? f.home : f.away).name;
      break;
    }
    case "explosion":
      Object.assign(vars, { player: story.data.line.name, pts: story.data.line.points, pir: story.data.line.pir });
      break;
    case "comeback":
      Object.assign(vars, { deficit: story.data.deficit });
      break;
    case "clutch": {
      const hero = story.data.hero;
      vars.hero = hero
        ? fill(lang === "el" ? "Ο {name} έβαλε {pts} πόντους στο φινάλε." : "{name} scored {pts} in crunch time.", { name: hero.playerName, pts: hero.points })
        : lang === "el" ? "Κρίθηκε στις λεπτομέρειες." : "Every possession mattered.";
      break;
    }
    case "numbers": {
      const top = (l: { name: string; points: number } | null) => (l ? `${l.name} (${l.points})` : "—");
      Object.assign(vars, { homeTop: top(story.data.topScorers.home), awayTop: top(story.data.topScorers.away) });
      break;
    }
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

  return {
    label: upper(ANGLE_LABEL[story.angle][lang], lang),
    headline: head,
    lede: fill(variant(LEDES[story.angle], f.gameId)[lang], vars),
    takeaway: fill(variant(TAKEAWAYS[story.angle], f.gameId)[lang], vars),
    context: `EuroLeague ${f.season}${round} · ${date}`,
    matchup,
    shareText: `${head}: ${matchup} #EuroLeague getclutchapp.com/games/${f.gameId}`,
    footnote: story.angle === "lineup" || story.angle === "bench" || story.angle === "numbers" ? FOOTNOTE[lang] : null,
    labels,
  };
}
