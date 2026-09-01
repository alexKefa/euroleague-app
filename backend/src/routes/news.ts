import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { newsArticles, syncState } from "../db/schema.js";
import { dedupeArticles } from "../services/newsDedupe.js";

export const newsRouter = Router();

// Registered before "/" only matters for path-param routes (there are none
// here) — kept above it anyway to read top-to-bottom as "status, then list".
newsRouter.get("/status", async (_req, res) => {
  try {
    const [row] = await db.select().from(syncState).where(eq(syncState.id, "news")).limit(1);
    res.json({ lastSyncedAt: row?.lastSyncedAt ?? null });
  } catch (err) {
    console.error("GET /api/news/status failed:", err);
    res.status(500).json({ error: "Failed to load sync status" });
  }
});

newsRouter.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    // Optional — omitted (or an unrecognized value) returns every language
    // mixed, same as before this existed, rather than erroring.
    const lang = req.query.lang === "en" || req.query.lang === "el" ? req.query.lang : null;
    // Opt-in, not default: the full /news page deliberately lists every
    // source's own copy of a story (it has its own per-source filter
    // dropdown), so only a "latest N" teaser like the dashboard's news
    // rail asks for this. See services/newsDedupe.ts for why 2-3 of our 4
    // RSS feeds often carry the same story with near-identical headlines.
    const dedupe = req.query.dedupe === "true";

    // Dropping duplicates can only shrink the result, so fetch a larger
    // pool first when deduping — otherwise a `limit` of 10 could dedupe
    // down to 6 with no way to backfill the other 4 without a second
    // round trip.
    const fetchLimit = dedupe ? Math.min(limit * 4, 100) : limit;

    const rows = await db
      .select()
      .from(newsArticles)
      .where(lang ? eq(newsArticles.lang, lang) : undefined)
      .orderBy(desc(newsArticles.publishedAt))
      .limit(fetchLimit);

    res.json(dedupe ? dedupeArticles(rows).slice(0, limit) : rows);
  } catch (err) {
    console.error("GET /api/news failed:", err);
    res.status(500).json({ error: "Failed to load news" });
  }
});