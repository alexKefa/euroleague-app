// Push-only service worker (2026-10-05). It shows push notifications and
// opens the app when one is tapped. Nothing else.
//
// There is deliberately NO "fetch" handler and no caching: the earlier
// Angular service worker (removed 2026-08-21) cached and proxied requests
// and was implicated in production 504s on Google Fonts and the EuroLeague
// image CDN. Without a fetch handler every request goes straight to the
// network as if no worker existed. Don't add one here.
// Registered by core/push.service.ts; app.component.ts's stale-worker cleanup
// leaves this file's registration alone.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Clutch";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-v15-192x192.png",
      badge: "/icons/icon-v15-96x96.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        // The app routes it itself (push.service.ts listens for this), so an
        // open tab keeps its state instead of reloading.
        open.postMessage({ type: "push-navigate", url });
        return open.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
