import { Router } from "express";
import { requireAuth, requireAdmin } from "../auth/middleware.js";
import {
  countSubscriptions,
  deleteSubscription,
  pushEnabled,
  saveSubscription,
  sendPush,
  sendPushToAll,
  vapidPublicKey,
  type PushLang,
} from "../services/push.js";

// Web push subscriptions + admin sends (2026-10-05). See services/push.ts.
export const pushRouter = Router();

const MAX_TEXT = 200;

// Public: whether push is configured, and the key a browser subscribes with.
pushRouter.get("/config", (_req, res) => {
  res.json({ enabled: pushEnabled, publicKey: pushEnabled ? vapidPublicKey : null });
});

// Called on enable, and again on every app start / language change while
// enabled, so a device's language and owner stay current.
pushRouter.post("/subscribe", requireAuth, async (req, res) => {
  const b = (req.body ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; lang?: unknown };
  const endpoint = typeof b.endpoint === "string" ? b.endpoint : "";
  const p256dh = typeof b.keys?.p256dh === "string" ? b.keys.p256dh : "";
  const auth = typeof b.keys?.auth === "string" ? b.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) {
    res.status(400).json({ error: "Invalid subscription", code: "BAD_SUBSCRIPTION" });
    return;
  }
  const lang: PushLang = b.lang === "en" ? "en" : "el";
  try {
    await saveSubscription(req.userId!, { endpoint, p256dh, auth, lang });
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/push/subscribe failed:", err);
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

// Turning notifications off, and on logout (so the next account on this
// device doesn't receive the previous one's notifications).
pushRouter.post("/unsubscribe", requireAuth, async (req, res) => {
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  if (!endpoint) {
    res.status(400).json({ error: "Missing endpoint", code: "BAD_SUBSCRIPTION" });
    return;
  }
  try {
    await deleteSubscription(req.userId!, endpoint);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/push/unsubscribe failed:", err);
    res.status(500).json({ error: "Failed to remove subscription" });
  }
});

pushRouter.get("/stats", requireAuth, requireAdmin, async (_req, res) => {
  res.json({ enabled: pushEnabled, ...(await countSubscriptions()) });
});

type BroadcastInput = { titleEn: string; titleEl: string; bodyEn: string; bodyEl: string; link: string };

function parseBroadcast(body: unknown): { value: BroadcastInput } | { error: string; code: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const titleEn = str("titleEn"), titleEl = str("titleEl"), bodyEn = str("bodyEn"), bodyEl = str("bodyEl");
  if (!titleEn || !titleEl || !bodyEn || !bodyEl) return { error: "Title and body are required in both languages", code: "MISSING_TEXT" };
  if ([titleEn, titleEl, bodyEn, bodyEl].some((s) => s.length > MAX_TEXT)) return { error: "Text is too long", code: "TOO_LONG" };
  const link = str("link") || "/";
  if (!/^\/[A-Za-z0-9\-_/?=&.]*$/.test(link)) return { error: "Link must be an in-app path like /fantasy", code: "BAD_LINK" };
  return { value: { titleEn, titleEl, bodyEn, bodyEl, link } };
}

// Admin broadcast to every subscribed device. `testOnly` sends it to the
// admin's own devices first, to check how it looks.
pushRouter.post("/broadcast", requireAuth, requireAdmin, async (req, res) => {
  if (!pushEnabled) {
    res.status(503).json({ error: "Push is not configured", code: "PUSH_DISABLED" });
    return;
  }
  const parsed = parseBroadcast(req.body);
  if ("error" in parsed) {
    res.status(400).json(parsed);
    return;
  }
  const { titleEn, titleEl, bodyEn, bodyEl, link } = parsed.value;
  const build = (lang: PushLang) => ({
    title: lang === "el" ? titleEl : titleEn,
    body: lang === "el" ? bodyEl : bodyEn,
    url: link,
    tag: "broadcast",
  });
  try {
    if (req.body?.testOnly === true) {
      const sent = await sendPush([req.userId!], build);
      res.json({ devices: sent, sent });
      return;
    }
    res.json(await sendPushToAll(build));
  } catch (err) {
    console.error("POST /api/push/broadcast failed:", err);
    res.status(500).json({ error: "Failed to send" });
  }
});
