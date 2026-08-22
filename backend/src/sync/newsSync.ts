import Parser from "rss-parser";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { newsArticles, syncState } from "../db/schema.js";

/**
 * Feeds we've verified actually exist and return real RSS
 * (checked the content-type header, not just guessed the URL).
 * Add more here once verified — this is the only place that changes.
 *
 * `filter` is for feeds that aren't already basketball-scoped — SDNA has
 * no section-specific RSS (their /rss.xml is a stale, unrelated, single-item
 * feed; /latest.xml is the real live one, but it's the whole site: football,
 * politics, etc.). Their article URLs embed the section slug though
 * (sdna.gr/mpasket/... for basketball), so filter on that instead of
 * ingesting everything.
 *
 * Eurohoops is bilingual, but plain /feed is every language mixed
 * together (Greek, English, even Turkish in the same feed) — its RSS
 * <language> tag claims en-US regardless of what's actually in it, so that
 * header can't be trusted either. /en/feed and /el/feed are real,
 * separately-verified per-language feeds (checked the channel <title>
 * itself literally says "EN (English)" / "GR (Greek)"), so each is synced
 * as its own feed entry with its own `lang`, not filtered after the fact.
 * SDNA has no English edition, so its lang is just fixed at "el".
 */
const FEEDS: {
  url: string;
  sourceName: string;
  sourceUrl: string;
  lang: "en" | "el";
  filter?: (link: string) => boolean;
}[] = [
  {
    url: "https://www.eurohoops.net/en/feed",
    sourceName: "Eurohoops",
    sourceUrl: "https://www.eurohoops.net",
    lang: "en",
  },
  {
    url: "https://www.eurohoops.net/el/feed",
    sourceName: "Eurohoops",
    sourceUrl: "https://www.eurohoops.net",
    lang: "el",
  },
  {
    url: "https://www.sdna.gr/latest.xml",
    sourceName: "SDNA",
    sourceUrl: "https://www.sdna.gr",
    lang: "el",
    filter: (link) => link.includes("/mpasket/"),
  },
];

const parser = new Parser();

export async function syncNews(): Promise<{ articlesUpserted: number; feedsFailed: string[] }> {
  let articlesUpserted = 0;
  const feedsFailed: string[] = [];

  for (const feed of FEEDS) {
    let parsed;
    try {
      parsed = await parser.parseURL(feed.url);
    } catch (err) {
      console.error(`Failed to fetch/parse feed ${feed.url}:`, err);
      feedsFailed.push(feed.url);
      continue;
    }

    for (const item of parsed.items) {
      if (!item.link || !item.title) continue; // skip malformed entries rather than crash the run
      if (feed.filter && !feed.filter(item.link)) continue;

      const publishedAt = item.isoDate ? new Date(item.isoDate) : new Date();
      const summary = (item.contentSnippet ?? item.content ?? "").slice(0, 400) || null;
      const imageUrl = item.enclosure?.url ?? null;

      await db
        .insert(newsArticles)
        .values({
          title: item.title,
          url: item.link,
          sourceName: feed.sourceName,
          sourceUrl: feed.sourceUrl,
          summary,
          imageUrl,
          lang: feed.lang,
          publishedAt,
        })
        .onConflictDoUpdate({
          target: newsArticles.url,
          set: { title: item.title, summary, imageUrl, lang: feed.lang },
        });

      articlesUpserted++;
    }
  }

  // Keep the table from growing forever — old articles aren't useful in
  // a "latest news" feed. Runs every sync, cheap on a table this size.
  await db.execute(sql`
    DELETE FROM news_articles
    WHERE published_at < NOW() - INTERVAL '30 days'
  `);

  // Recorded unconditionally (even if every feed above failed) — this is
  // "when did we last check", not "when did we last get new articles". A
  // quiet news day with zero new items would otherwise be indistinguishable
  // from a broken sync from the frontend's "updated N minutes ago" banner.
  await db
    .insert(syncState)
    .values({ id: "news", lastSyncedAt: new Date() })
    .onConflictDoUpdate({ target: syncState.id, set: { lastSyncedAt: new Date() } });

  return { articlesUpserted, feedsFailed };
}