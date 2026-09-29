import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { announcements } from "../db/schema.js";
import { requireAuth, requireAdmin } from "../auth/middleware.js";

export const announcementsRouter = Router();

// Icons the admin form offers — a subset of the frontend's NavIconName, so
// an announcement can never ask the toast for an icon that doesn't exist.
export const ANNOUNCEMENT_ICONS = [
  "bell", "zap", "trophy", "star", "flame", "medal", "ball", "cards", "packs", "wheel",
  "picks", "schedule", "news", "teams", "trade", "share", "tip", "album", "vote",
] as const;
const DEFAULT_TTL_DAYS = 14;
const MAX_TEXT = 400;

type Input = {
  titleEn: string; titleEl: string; bodyEn: string; bodyEl: string;
  link: string | null; ctaEn: string | null; ctaEl: string | null;
  icon: string; publishAt: Date; expiresAt: Date; active: boolean;
};

// Shared by create and edit. Everything user-facing must exist in both
// languages; the call-to-action is all-or-nothing (a link needs a label in
// both, a label needs somewhere to go).
function parseInput(body: unknown): { value: Input } | { error: string; code: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const opt = (k: string) => str(k) || null;
  const titleEn = str("titleEn"), titleEl = str("titleEl"), bodyEn = str("bodyEn"), bodyEl = str("bodyEl");
  if (!titleEn || !titleEl || !bodyEn || !bodyEl) return { error: "Title and body are required in both languages", code: "MISSING_TEXT" };
  if ([titleEn, titleEl, bodyEn, bodyEl].some((s) => s.length > MAX_TEXT)) return { error: "Text is too long", code: "TOO_LONG" };

  const link = opt("link"), ctaEn = opt("ctaEn"), ctaEl = opt("ctaEl");
  const ctaParts = [link, ctaEn, ctaEl].filter(Boolean).length;
  if (ctaParts !== 0 && ctaParts !== 3) return { error: "A button needs a link and a label in both languages", code: "INCOMPLETE_CTA" };
  if (link && !/^\/[A-Za-z0-9\-_/?=&.]*$/.test(link)) return { error: "Link must be an in-app path like /fantasy", code: "BAD_LINK" };

  const icon = str("icon");
  if (!(ANNOUNCEMENT_ICONS as readonly string[]).includes(icon)) return { error: "Unknown icon", code: "BAD_ICON" };

  const publishAt = b.publishAt ? new Date(String(b.publishAt)) : new Date();
  const expiresAt = b.expiresAt
    ? new Date(String(b.expiresAt))
    : new Date(publishAt.getTime() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);
  if (isNaN(publishAt.getTime()) || isNaN(expiresAt.getTime())) return { error: "Invalid date", code: "BAD_DATE" };
  if (expiresAt <= publishAt) return { error: "Expiry must be after the publish time", code: "BAD_DATE_RANGE" };

  const active = b.active === undefined ? true : b.active === true;
  return { value: { titleEn, titleEl, bodyEn, bodyEl, link, ctaEn, ctaEl, icon, publishAt, expiresAt, active } };
}

// Live announcements, newest first — what the toast reads. Public (no user
// data in it); the toast itself only shows for logged-in users.
announcementsRouter.get("/", async (_req, res) => {
  const now = new Date();
  const rows = await db
    .select()
    .from(announcements)
    .where(and(eq(announcements.active, true), lte(announcements.publishAt, now), gt(announcements.expiresAt, now)))
    .orderBy(desc(announcements.publishAt))
    .limit(20);
  res.json(rows);
});

// Every announcement, including scheduled, expired and switched-off ones,
// for the admin list.
announcementsRouter.get("/all", requireAuth, requireAdmin, async (_req, res) => {
  const rows = await db.select().from(announcements).orderBy(desc(announcements.publishAt)).limit(100);
  res.json(rows);
});

announcementsRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = parseInput(req.body);
  if ("error" in parsed) {
    res.status(400).json(parsed);
    return;
  }
  // `<date>-<short random>`, same readable shape as the original hardcoded ids.
  const id = `${parsed.value.publishAt.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(announcements)
    .values({ id, ...parsed.value, createdByUserId: req.userId! })
    .returning();
  res.status(201).json(row);
});

announcementsRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = parseInput(req.body);
  if ("error" in parsed) {
    res.status(400).json(parsed);
    return;
  }
  const [row] = await db
    .update(announcements)
    .set({ ...parsed.value, updatedAt: new Date() })
    .where(eq(announcements.id, req.params.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Announcement not found", code: "NOT_FOUND" });
    return;
  }
  res.json(row);
});

announcementsRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const [row] = await db.delete(announcements).where(eq(announcements.id, req.params.id)).returning({ id: announcements.id });
  if (!row) {
    res.status(404).json({ error: "Announcement not found", code: "NOT_FOUND" });
    return;
  }
  res.json({ ok: true });
});
