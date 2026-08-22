import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { newsArticles, syncState } from "../db/schema.js";

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

    const rows = await db
      .select()
      .from(newsArticles)
      .where(lang ? eq(newsArticles.lang, lang) : undefined)
      .orderBy(desc(newsArticles.publishedAt))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    console.error("GET /api/news failed:", err);
    res.status(500).json({ error: "Failed to load news" });
  }
});