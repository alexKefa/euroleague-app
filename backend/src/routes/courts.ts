// Clutch Court invite codes (CLUTCH_COURT_SPEC.md §6.1).
//   POST /api/courts        -> { code, url }   (your open court, or a new one)
//   GET  /api/courts/:code  -> { exists, active, playerCount? }
import { randomInt } from "node:crypto";
import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { courts } from "../db/schema.js";
import { requireAuth } from "../auth/middleware.js";
import { courtPresence } from "../court/presence.js";
import { generateCourtCode, isValidCourtCode, normalizeCourtCode } from "../../../shared/court/protocol.js";

export const courtsRouter = Router();

function courtUrl(req: { protocol: string; get(name: string): string | undefined }, code: string): string {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "") || `${req.protocol}://${req.get("host")}`;
  return `${base}/court/${code}`;
}

courtsRouter.post("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.userId!;
    // Reuse the user's open court so "Create" doesn't litter the table and an
    // already-shared link keeps working.
    const [existing] = await db
      .select({ code: courts.code })
      .from(courts)
      .where(and(eq(courts.ownerUserId, userId), eq(courts.isActive, true)))
      .orderBy(desc(courts.createdAt))
      .limit(1);
    if (existing) {
      res.json({ code: existing.code, url: courtUrl(req, existing.code) });
      return;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCourtCode((n) => randomInt(n));
      const [row] = await db
        .insert(courts)
        .values({ code, ownerUserId: userId, lastActiveAt: new Date() })
        .onConflictDoNothing({ target: courts.code })
        .returning({ code: courts.code });
      if (row) {
        res.status(201).json({ code: row.code, url: courtUrl(req, row.code) });
        return;
      }
    }
    res.status(503).json({ error: "Could not allocate a court code, try again" });
  } catch (err) {
    next(err);
  }
});

courtsRouter.get("/:code", async (req, res, next) => {
  try {
    const code = normalizeCourtCode(req.params.code ?? "");
    if (!isValidCourtCode(code)) {
      res.json({ exists: false, active: false });
      return;
    }
    const [row] = await db.select({ isActive: courts.isActive }).from(courts).where(eq(courts.code, code)).limit(1);
    if (!row) {
      res.json({ exists: false, active: false });
      return;
    }
    const playerCount = courtPresence.count(code);
    res.json({ exists: true, active: row.isActive, ...(playerCount !== null ? { playerCount } : {}) });
  } catch (err) {
    next(err);
  }
});
