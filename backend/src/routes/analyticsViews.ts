import { Router } from "express";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../db/client.js";
import { analyticsViews } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";

export const analyticsViewsRouter = Router();

const MAX_VIEWS_PER_USER = 5;
const MAX_CUSTOM_COLUMNS = 3;

interface CustomColumn {
  id: string;
  label: string;
  expression: string;
}

// Shape/length caps only — never evaluated or formula-checked server-side.
// The expression is opaque text as far as this route is concerned; it's
// parsed and run entirely client-side (features/analytics-builder/formula.ts)
// against data that route already scopes to the requesting user, so a
// malformed or malicious-looking expression here can't do anything worse
// than fail to render in its owner's own browser.
function parseCustomColumns(value: unknown): CustomColumn[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_COLUMNS) return null;
  const out: CustomColumn[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : "";
    const label = typeof e.label === "string" ? e.label.trim() : "";
    const expression = typeof e.expression === "string" ? e.expression.trim() : "";
    if (!id || !label || label.length > 40 || !expression || expression.length > 200) return null;
    out.push({ id, label, expression });
  }
  return out;
}

// Every user's own saved custom stat tables — not points-gated, just
// requires login. The view itself is a pure projection (which players,
// which columns, how to sort) over the existing GET
// /api/players/advanced-stats payload; this route only owns the saved
// config, never the underlying stats.
analyticsViewsRouter.get("/", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(analyticsViews)
      .where(eq(analyticsViews.userId, req.userId!))
      .orderBy(asc(analyticsViews.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("GET /api/analytics-views failed:", err);
    res.status(500).json({ error: "Failed to load your saved views", code: "FAILED_TO_LOAD_VIEWS" });
  }
});

function validateBody(
  body: unknown
): { name: string; playerIds: string[]; columns: string[]; customColumns: CustomColumn[]; sortKey: string | null; sortDesc: boolean } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const playerIds = Array.isArray(b.playerIds) ? b.playerIds.filter((v): v is string => typeof v === "string") : [];
  const columns = Array.isArray(b.columns) ? b.columns.filter((v): v is string => typeof v === "string") : [];
  const customColumns = parseCustomColumns(b.customColumns);
  const sortKey = typeof b.sortKey === "string" ? b.sortKey : null;
  const sortDesc = typeof b.sortDesc === "boolean" ? b.sortDesc : true;
  if (!name || name.length > 60 || playerIds.length === 0 || columns.length === 0 || customColumns === null) return null;
  return { name, playerIds, columns, customColumns, sortKey, sortDesc };
}

analyticsViewsRouter.post("/", requireAuth, async (req, res) => {
  try {
    const parsed = validateBody(req.body);
    if (!parsed) {
      res.status(400).json({
        error: "Give the view a name (up to 60 chars), at least one player, and at least one column.",
        code: "INVALID_VIEW_BODY",
      });
      return;
    }

    const existing = await db
      .select({ id: analyticsViews.id })
      .from(analyticsViews)
      .where(eq(analyticsViews.userId, req.userId!));
    if (existing.length >= MAX_VIEWS_PER_USER) {
      res.status(400).json({
        error: `You can save up to ${MAX_VIEWS_PER_USER} views — delete one first.`,
        code: "VIEW_LIMIT_REACHED",
      });
      return;
    }

    const [row] = await db
      .insert(analyticsViews)
      .values({ userId: req.userId!, ...parsed })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("POST /api/analytics-views failed:", err);
    res.status(500).json({ error: "Failed to save the view", code: "FAILED_TO_SAVE_VIEW" });
  }
});

analyticsViewsRouter.patch("/:id", requireAuth, async (req, res) => {
  try {
    const parsed = validateBody(req.body);
    if (!parsed) {
      res.status(400).json({
        error: "Give the view a name (up to 60 chars), at least one player, and at least one column.",
        code: "INVALID_VIEW_BODY",
      });
      return;
    }

    const [row] = await db
      .update(analyticsViews)
      .set(parsed)
      .where(and(eq(analyticsViews.id, req.params.id), eq(analyticsViews.userId, req.userId!)))
      .returning();
    if (!row) {
      res.status(404).json({ error: "View not found", code: "VIEW_NOT_FOUND" });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error("PATCH /api/analytics-views/:id failed:", err);
    res.status(500).json({ error: "Failed to update the view", code: "FAILED_TO_UPDATE_VIEW" });
  }
});

analyticsViewsRouter.delete("/:id", requireAuth, async (req, res) => {
  try {
    const [row] = await db
      .delete(analyticsViews)
      .where(and(eq(analyticsViews.id, req.params.id), eq(analyticsViews.userId, req.userId!)))
      .returning({ id: analyticsViews.id });
    if (!row) {
      res.status(404).json({ error: "View not found", code: "VIEW_NOT_FOUND" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    console.error("DELETE /api/analytics-views/:id failed:", err);
    res.status(500).json({ error: "Failed to delete the view", code: "FAILED_TO_DELETE_VIEW" });
  }
});
