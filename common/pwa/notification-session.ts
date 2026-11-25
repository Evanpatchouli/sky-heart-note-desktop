import { getAppToken, type WebApp } from "../web-auth/api";

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function synchronizeNotificationSession(app: WebApp) {
  if (!window.isSecureContext || !("caches" in window) || !("serviceWorker" in navigator)) return;
  const name = `sky-club:notification:${app}`;
  const write = async () => {
    const token = getAppToken(app);
    const cache = await caches.open(name);
    const key = "/__pwa_notification_session__";
    const previous = await (await cache.match(key))?.text();
    let binding: string | undefined;
    if (token) {
      const accessHash = Array.from(await sha256(token), byte => byte.toString(16).padStart(2, "0")).join("");
      binding = btoa(String.fromCharCode(...await sha256("sky-club:push:" + accessHash)))
        .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    }
    if (getAppToken(app) !== token || binding === previous) return;
    if (binding) await cache.put(key, new Response(binding));
    else await cache.delete(key);
    const registration = await navigator.serviceWorker.getRegistration("/");
    const notifications = await registration?.getNotifications();
    for (const notification of notifications ?? []) {
      if (notification.tag.startsWith("sky-notice:") && notification.data?.deviceBinding !== binding) notification.close();
    }
  };
  if (navigator.locks) await navigator.locks.request(name, write);
  else await write();
}
