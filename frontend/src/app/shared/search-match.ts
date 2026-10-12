// Global search matcher (2026-10-12). Pure — no Angular imports — so the
// backend's scripts/check-search-match.ts can run it under tsx.
// Spec: docs/superpowers/specs/2026-10-12-global-search-design.md
//
// Feed names are Latin ("SLOUKAS, KOSTAS"); Greek fans type Greek. Both
// sides go through normalize() (lowercase, no accents, Greek -> Latin) and
// then loose(), which folds the letters Greek and Latin spellings of the
// same name disagree on (Βεζένκοφ ~ Vezenkov: v/f/b, y/i, ou/u, k/c, x/ks).

export type SearchKind = "player" | "team" | "game" | "referee";

export interface SearchIndex {
  players: { id: string; name: string; teamCode: string | null; photoUrl: string | null; active: boolean }[];
  teams: { id: string; code: string; name: string; logoUrl: string | null }[];
  referees: { id: string; name: string }[];
  games: {
    id: string;
    season: string;
    round: number | null;
    tipoffAt: string;
    status: string;
    home: { code: string; name: string };
    away: { code: string; name: string };
    homeScore: number | null;
    awayScore: number | null;
  }[];
}

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  route: string[];
}

const PER_KIND = 5;
const TOTAL = 12;
const KIND_RANK: Record<SearchKind, number> = { team: 0, player: 1, game: 2, referee: 3 };

// Digraphs first (any position), then word-initial ones, then letters.
const GREEK_DIGRAPHS: [RegExp, string][] = [
  [/ου/g, "ou"],
  [/αι/g, "ai"],
  [/ει/g, "ei"],
  [/οι/g, "oi"],
  [/(^|\s)μπ/g, "$1b"],
  [/(^|\s)ντ/g, "$1d"],
  [/(^|\s)γκ/g, "$1g"],
];
const GREEK_LETTERS: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n",
  ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/** Lowercase, accents removed, Greek transliterated to Latin. */
export function normalize(s: string): string {
  let out = s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  for (const [re, to] of GREEK_DIGRAPHS) out = out.replace(re, to);
  out = out.replace(/[α-ως]/g, (ch) => GREEK_LETTERS[ch] ?? ch);
  return out.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** normalize() plus the folds that let Greek and Latin spellings meet. */
export function loose(s: string): string {
  return normalize(s)
    .replace(/ou/g, "u")
    .replace(/ks/g, "x")
    .replace(/[vfb]/g, "b")
    .replace(/y/g, "i")
    .replace(/k/g, "c")
    .replace(/x/g, "cs");
}

/** "SLOUKAS, KOSTAS" -> "Kostas Sloukas" (same rule as player-name.ts). */
function firstLast(name: string): string {
  const comma = name.indexOf(",");
  const ordered = comma === -1 ? name : `${name.slice(comma + 1).trim()} ${name.slice(0, comma).trim()}`;
  return ordered.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** 3 per query word matching a whole word, 2 per prefix; null if any word misses. */
function score(queryWords: string[], candidate: string): number | null {
  const words = loose(candidate).split(" ");
  let total = 0;
  for (const q of queryWords) {
    if (words.includes(q)) total += 3;
    else if (words.some((w) => w.startsWith(q))) total += 2;
    else return null;
  }
  return total;
}

interface Scored {
  result: SearchResult;
  score: number;
  active: boolean;
  time: number; // games only: distance from now, upcoming first
}

export function search(index: SearchIndex, query: string, now: Date = new Date()): SearchResult[] {
  const queryWords = loose(query).split(" ").filter(Boolean);
  if (queryWords.length === 0) return [];
  const scored: Scored[] = [];
  const add = (result: SearchResult, text: string, active = true, time = 0) => {
    const s = score(queryWords, text);
    if (s !== null) scored.push({ result, score: s, active, time });
  };

  for (const t of index.teams) {
    add({ kind: "team", id: t.id, title: t.name, subtitle: t.code, imageUrl: t.logoUrl, route: ["/teams", t.id] }, `${t.code} ${t.name}`);
  }
  for (const p of index.players) {
    const title = firstLast(p.name);
    add({ kind: "player", id: p.id, title, subtitle: p.teamCode ?? "", imageUrl: p.photoUrl, route: ["/players", p.id] }, title, p.active);
  }
  for (const g of index.games) {
    const t = new Date(g.tipoffAt);
    const date = `${String(t.getDate()).padStart(2, "0")}/${String(t.getMonth() + 1).padStart(2, "0")}`;
    const score = g.status === "final" && g.homeScore !== null && g.awayScore !== null ? ` · ${g.homeScore}–${g.awayScore}` : "";
    const upcoming = t.getTime() >= now.getTime();
    add(
      {
        kind: "game",
        id: g.id,
        title: `${g.home.name} – ${g.away.name}`,
        subtitle: `${g.round !== null ? `R${g.round} · ` : ""}${date}${score}`,
        imageUrl: null,
        route: ["/games", g.id],
      },
      `${g.home.code} ${g.away.code} ${g.home.name} ${g.away.name}`,
      true,
      // Upcoming soonest first, then finished newest first.
      upcoming ? t.getTime() - now.getTime() : 1e13 + (now.getTime() - t.getTime())
    );
  }
  for (const r of index.referees) {
    const title = firstLast(r.name);
    add({ kind: "referee", id: r.id, title, subtitle: "", imageUrl: null, route: ["/referees", r.id] }, title);
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.active) - Number(a.active) ||
      KIND_RANK[a.result.kind] - KIND_RANK[b.result.kind] ||
      a.time - b.time ||
      a.result.title.localeCompare(b.result.title)
  );

  const perKind: Record<SearchKind, number> = { team: 0, player: 0, game: 0, referee: 0 };
  const out: SearchResult[] = [];
  for (const s of scored) {
    if (out.length >= TOTAL) break;
    if (perKind[s.result.kind] >= PER_KIND) continue;
    perKind[s.result.kind]++;
    out.push(s.result);
  }
  return out;
}
