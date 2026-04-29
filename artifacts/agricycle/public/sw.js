/* AgriCycle service worker — handles Web Push delivery + click navigation. */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "AgriCycle", body: "You have a new update.", url: "/" };
  if (event.data) {
    try { payload = { ...payload, ...event.data.json() }; }
    catch { payload.body = event.data.text() || payload.body; }
  }

  const options = {
    body:  payload.body,
    tag:   payload.tag || "agricycle-default",
    icon:  payload.icon || "/favicon.ico",
    badge: payload.badge || "/favicon.ico",
    data:  { url: payload.url || "/", ...(payload.data || {}) },
    renotify: true,
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // If an AgriCycle tab is open, focus it and navigate
    for (const client of allClients) {
      if ("focus" in client) {
        try {
          await client.focus();
          if ("navigate" in client) await client.navigate(targetUrl);
          return;
        } catch { /* fall through to open new */ }
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
