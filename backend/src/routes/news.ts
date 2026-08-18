import { Router } from "express";
import { desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { newsArticles } from "../db/schema.js";

export const newsRouter = Router();

newsRouter.get("/", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const rows = await db
      .select()
      .from(newsArticles)
      .orderBy(desc(newsArticles.publishedAt))
      .limit(limit);

    res.json(rows);
  } catch (err) {
    console.error("GET /api/news failed:", err);
    res.status(500).json({ error: "Failed to load news" });
  }
});