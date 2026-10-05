// Dependency-free so AuthService (logout) can use it without importing
// PushService, which itself depends on AuthService.
export const PUSH_SW_URL = "/push-sw.js";

export function browserSupportsPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** This device's current push subscription, if notifications were turned on here. */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!browserSupportsPush()) return null;
  const reg = await navigator.serviceWorker.getRegistration(PUSH_SW_URL).catch(() => undefined);
  return (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
}
