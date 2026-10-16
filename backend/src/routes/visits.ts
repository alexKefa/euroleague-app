// Signup tracking (2026-10-16): counts visits by source (POST, anonymous)
// and reports visits vs signups for the admin card (GET /stats).
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { siteVisits } from "../db/schema.js";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { isBot, normalizeAttribution, sourceLabel } from "../services/attribution.js";

export const visitsRouter = Router();

// One visit per page load is a handful per person a day; this only stops a
// script from flooding the table.
const visitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

visitsRouter.post("/", visitLimiter, async (req, res) => {
  res.status(204).send(); // never makes the page wait or fail
  if (isBot(req.get("user-agent"))) return;
  const a = normalizeAttribution(req.body);
  try {
    await db.insert(siteVisits).values({ sourceLabel: sourceLabel(a), ...(a ?? {}) });
  } catch (err) {
    console.error("POST /api/visits failed:", err);
  }
});

/** Last 30 days: visits and signups per source, plus signups per week for 12 weeks. */
visitsRouter.get("/stats", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [bySource, weekly] = await Promise.all([
      db.execute<{ source: string; visits: number; signups: number }>(sql`
        with v as (select source_label s, count(*)::int n from site_visits where created_at > now() - interval '30 days' group by 1),
        u as (
          select coalesce(signup_source->>'label', 'untracked') s, count(*)::int n from users
          where created_at > now() - interval '30 days' and not is_admin and deleted_at is null group by 1
        )
        select coalesce(v.s, u.s) as source, coalesce(v.n, 0) as visits, coalesce(u.n, 0) as signups
        from v full join u on u.s = v.s
        order by signups desc, visits desc
      `),
      db.execute<{ week: string; signups: number }>(sql`
        select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week, count(*)::int as signups from users
        where created_at > date_trunc('week', now()) - interval '11 weeks' and not is_admin and deleted_at is null
        group by 1 order by 1
      `),
    ]);
    const visits = bySource.reduce((s, r) => s + r.visits, 0);
    const signups = bySource.reduce((s, r) => s + r.signups, 0);
    res.json({ visits, signups, bySource, weekly });
  } catch (err) {
    console.error("GET /api/visits/stats failed:", err);
    res.status(500).json({ error: "Failed to load signup stats" });
  }
});
