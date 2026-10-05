import webpush from "web-push";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { pushLog, pushSubscriptions } from "../db/schema.js";

// Web push (2026-10-05). VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY unset = push
// is off: the frontend hides the toggle (GET /api/push/config says so) and
// every send below is a no-op, same pattern as RESEND_API_KEY.
const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
export const pushEnabled = Boolean(publicKey && privateKey);
if (pushEnabled) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:hello@getclutchapp.com", publicKey, privateKey);
}
export const vapidPublicKey = publicKey;

export type PushLang = "en" | "el";

/** What the service worker (frontend/public/push-sw.js) shows. */
export interface PushMessage {
  title: string;
  body: string;
  /** In-app path opened on tap. */
  url: string;
  /** Same-tag notifications replace each other instead of stacking. */
  tag?: string;
}

/** Builds the message in a device's language. */
export type PushBuilder = (lang: PushLang) => PushMessage;

type SubscriptionRow = typeof pushSubscriptions.$inferSelect;

async function deliver(rows: SubscriptionRow[], build: (lang: PushLang, userId: string) => PushMessage | null): Promise<number> {
  const gone: string[] = [];
  let sent = 0;
  // Sequential on purpose: a handful of devices per send, and the push
  // services rate-limit bursts from one origin anyway.
  for (const row of rows) {
    const lang: PushLang = row.lang === "en" ? "en" : "el";
    const message = build(lang, row.userId);
    if (!message) continue;
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(message),
        { TTL: 12 * 60 * 60 }
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // The device unsubscribed, uninstalled the app or cleared site data.
      if (status === 404 || status === 410) gone.push(row.id);
      else console.error(`[push] send failed (${status ?? "no status"}):`, (err as Error).message);
    }
  }
  if (gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  return sent;
}

/** Push to every device of these users, no dedupe (event-driven sends like trades). */
export async function sendPush(userIds: string[], build: PushBuilder): Promise<number> {
  if (!pushEnabled || userIds.length === 0) return 0;
  const rows = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, [...new Set(userIds)]));
  return deliver(rows, build);
}

/** Fire-and-forget wrapper for request handlers: a push failure never fails the request. */
export function sendPushInBackground(userIds: string[], build: PushBuilder): void {
  sendPush(userIds, build).catch((err) => console.error("[push] failed:", err));
}

/**
 * Scheduled sends (reminders, round results): claims a push_log row per user
 * first, one multi-row insert, and only notifies the users whose claim
 * landed, so re-runs never repeat a notification for the same (kind, key).
 * Only users with at least one device are claimed, so someone who turns
 * notifications on later still gets the next one.
 */
export async function sendPushOnce(
  kind: string,
  key: string,
  userIds: string[],
  build: (lang: PushLang, userId: string) => PushMessage | null
): Promise<number> {
  if (!pushEnabled || userIds.length === 0) return 0;
  const rows = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, [...new Set(userIds)]));
  const withDevice = [...new Set(rows.map((r) => r.userId))];
  if (withDevice.length === 0) return 0;
  const claimed = await db
    .insert(pushLog)
    .values(withDevice.map((userId) => ({ userId, kind, key })))
    .onConflictDoNothing()
    .returning({ userId: pushLog.userId });
  const claimedIds = new Set(claimed.map((c) => c.userId));
  return deliver(rows.filter((r) => claimedIds.has(r.userId)), build);
}

/** Every subscribed device (admin broadcast). */
export async function sendPushToAll(build: PushBuilder): Promise<{ devices: number; sent: number }> {
  if (!pushEnabled) return { devices: 0, sent: 0 };
  const rows = await db.select().from(pushSubscriptions);
  return { devices: rows.length, sent: await deliver(rows, build) };
}

export async function saveSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string; lang: PushLang }): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ userId, ...sub })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.p256dh, auth: sub.auth, lang: sub.lang },
    });
}

export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function countSubscriptions(): Promise<{ devices: number; users: number }> {
  const [row] = await db.execute<{ devices: number; users: number }>(sql`
    select count(*)::int as devices, count(distinct user_id)::int as users from ${pushSubscriptions}
  `);
  return row ?? { devices: 0, users: 0 };
}
