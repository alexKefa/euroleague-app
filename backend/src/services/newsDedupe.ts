// The same real-world story is often picked up by 2-3 of newsSync.ts's 4
// RSS feeds within minutes of each other (Eurohoops EL, SDNA, and Gazzetta
// all cover the same Greek EuroLeague news) — each with its own URL, so the
// sync's upsert-by-url keeps all of them as separate rows, but with
// near-identical headlines. That's what surfaces as the same story
// appearing back-to-back in a "latest N" teaser like the dashboard's news
// rail. This collapses those down to one per story via title similarity,
// not exact matching — different outlets phrase the same headline
// differently ("X beats Y" vs "X tops Y in derby win").

type Article = { title: string; publishedAt: Date | string };

// Words shorter than this are mostly connectors/articles in both languages
// and add noise rather than signal to the similarity check.
const MIN_WORD_LENGTH = 3;
// Truncating longer words to a fixed prefix is a crude stand-in for real
// stemming — needed because Greek's case endings mean the same word shows
// up as several different tokens across outlets ("Ολυμπιακό" vs
// "Ολυμπιακός" vs "Ολυμπιακού"), which an exact-token Jaccard would
// otherwise score as non-matches. Only applied to words longer than the
// prefix itself, so short words aren't further truncated.
const STEM_PREFIX_LENGTH = 6;
const SIMILARITY_THRESHOLD = 0.4;
// Only compare articles published within this window of each other —
// prevents two unrelated stories that happen to share generic words
// ("EuroLeague", team names) from being flagged as duplicates just because
// they're both in the fetched pool.
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

function normalizeTitle(title: string): Set<string> {
  // NFD splits accented letters into a base letter + a combining mark
  // (Greek tonos included) — \p{M} strips exactly those marks, so "καλάθι"
  // and a differently-accented rendering of the same word normalize to the
  // same base letters instead of comparing as different tokens.
  const deaccented = Array.from(title.toLowerCase().normalize("NFD"))
    .filter((ch) => !/\p{M}/u.test(ch))
    .join("");
  const cleaned = deaccented.replace(/[^\p{L}\p{N}\s]/gu, " ");
  const words = cleaned.split(/\s+/).filter((w) => w.length >= MIN_WORD_LENGTH);
  return new Set(words.map((w) => w.slice(0, STEM_PREFIX_LENGTH)));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Drops near-duplicate articles (same story, different source), keeping
 * whichever copy comes first in the input — callers should pass articles
 * already sorted newest-first so that's the freshest copy of a duplicate
 * set, not an arbitrary one.
 */
export function dedupeArticles<T extends Article>(articles: T[]): T[] {
  const kept: { words: Set<string>; publishedAt: number }[] = [];
  const result: T[] = [];

  for (const article of articles) {
    const words = normalizeTitle(article.title);
    const publishedAt = new Date(article.publishedAt).getTime();
    const isDuplicate = kept.some(
      (k) =>
        Math.abs(k.publishedAt - publishedAt) <= DUPLICATE_WINDOW_MS &&
        jaccardSimilarity(k.words, words) >= SIMILARITY_THRESHOLD
    );
    if (isDuplicate) continue;
    kept.push({ words, publishedAt });
    result.push(article);
  }

  return result;
}
