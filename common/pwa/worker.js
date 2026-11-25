const cachePrefix = `sky-heart:pwa:${config.app}:`;
const cacheName = cachePrefix + config.version;
const assetUrls = new Set(config.assets.map(path => new URL(path, self.location.origin).href));
const assetDestinations = new Set(["script", "style", "font", "image", "worker"]);
const notificationCache = `sky-heart:notification:${config.app}`;
const objectId = /^[a-f0-9]{24}$/;
const validId = value => typeof value === "string" && objectId.test(value);
const pendingDisplays = new Map();

self.addEventListener("install", event => {
  const requests = [...assetUrls].map(url => new Request(url, {
    credentials: "omit", cache: "reload", redirect: "error",
  }));
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(requests)));
});

function destination(payload) {
  if (payload?.version !== 1 || !validId(payload.noticeId)) return null;
  if (config.app === "employee" && payload.type === "club-dispatch" && validId(payload.publicationId)) {
    return "/claim-board?noticeId=" + payload.noticeId;
  }
  if (payload.type !== "app-notification" || payload.targetApp !== config.app ||
      !validId(payload.notificationId) || !["important", "system"].includes(payload.noticeType)) return null;
  if (payload.target === "client-order-assigned" && config.app === "employee" && payload.noticeType === "important") {
    return "/club/dispatch?notificationId=" + payload.noticeId;
  }
  if (payload.target !== "inbox") return null;
  return payload.noticeType === "system" ? "/?notifications=1" : "/?noticeId=" + payload.noticeId;
}

async function showPush(payload, tag) {
  const now = Date.now();
  const expiresAt = payload.expiresAt;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return;
  const cache = await caches.open(notificationCache);
  const activeBinding = await cache.match("/__pwa_notification_session__");
  if (!activeBinding || await activeBinding.text() !== payload.deviceBinding) return;
  const receipt = "/__pwa_notification_receipts__/" + payload.noticeId;
  if (await cache.match(receipt)) return;
  if (!(await self.registration.getNotifications({ tag })).length) {
    await self.registration.showNotification(payload.type === "club-dispatch" ? "Sky Club" : payload.title, {
      body: payload.message, tag, icon: "/pwa/icon-192.png", renotify: false, data: payload,
    });
  }
  await cache.put(receipt, new Response(String(expiresAt)));
  for (const entry of await cache.keys()) {
    if (new URL(entry.url).pathname.startsWith("/__pwa_notification_receipts__/")) {
      const stored = await cache.match(entry);
      if (stored && Number(await stored.text()) < now) await cache.delete(entry);
    }
  }
}

self.addEventListener("push", event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!destination(payload) || typeof payload.message !== "string" || payload.message.length > 300 ||
      (payload.type === "app-notification" && (typeof payload.title !== "string" || payload.title.length > 100)) ||
      typeof payload.deviceBinding !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.deviceBinding)) return;
  const tag = `sky-notice:${payload.publicationId ?? payload.notificationId}:${payload.noticeId}`;
  let display = pendingDisplays.get(tag);
  if (!display) {
    display = showPush(payload, tag).finally(() => pendingDisplays.delete(tag));
    pendingDisplays.set(tag, display);
  }
  event.waitUntil(display);
});

self.addEventListener("notificationclick", event => {
  const path = destination(event.notification.data);
  event.notification.close();
  if (!path) return;
  event.waitUntil((async () => {
    const href = new URL(path, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const window of windows) {
      if (new URL(window.url).origin !== self.location.origin) continue;
      try {
        const navigated = window.url === href ? window : await window.navigate(href);
        if (navigated) {
          await navigated.focus();
          return;
        }
      } catch { /* Open a window if the previous one closed during navigation. */ }
    }
    await self.clients.openWindow(href);
  })());
});

// Let each open window finish using its current version before taking over.
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(cachePrefix) && key !== cacheName)
    .map(key => caches.delete(key)))));
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || request.headers.has("Authorization")) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.replace(/\/$/, "");
  const appNavigation = url.pathname === "/" || url.pathname === "/index.html" ||
    (config.app === "employee" && ["/club/dispatch", "/club/operations", "/claim-board"].includes(path)) ||
    (config.app === "client" && ["/order", "/order-detail"].includes(path));
  if (request.mode === "navigate" && request.destination === "document" && appNavigation) {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(() => new Response(config.offlinePage, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    })));
  } else if (assetDestinations.has(request.destination) && assetUrls.has(url.href)) {
    event.respondWith(caches.match(request, { cacheName }).catch(() => undefined)
      .then(response => response ?? fetch(request)));
  }
});
