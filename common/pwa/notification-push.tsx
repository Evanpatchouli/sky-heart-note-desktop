import { useEffect, useRef, useState } from "react";
import { getAppToken, RequestError, type WebApp } from "../web-auth/api";
import { notificationRequest } from "./notification-request";
import { synchronizeNotificationSession } from "./notification-session";

type ServerStatus = { publicKey: string | null; fingerprint: string | null };
type Device = {
  registration: ServiceWorkerRegistration;
  subscription: PushSubscription | null;
};
type Status = {
  phase: "loading" | "unsupported" | "installing" | "unconfigured" | "denied" | "ready" | "enabled" | "pending" | "error";
  publicKey?: string;
  canDisable?: boolean;
  message?: string;
};


const memoryPending = new Set<WebApp>();

class ReminderError extends Error {}

function offKey(app: WebApp) { return `sky-heart.${app}.notification-push.pending-off.v1`; }

function pendingOff(app: WebApp) {
  try { return localStorage.getItem(offKey(app)) === "1"; }
  catch { return memoryPending.has(app); }
}

function rememberOff(app: WebApp, value: boolean) {
  if (value) memoryPending.add(app); else memoryPending.delete(app);
  try {
    if (value) localStorage.setItem(offKey(app), "1");
    else localStorage.removeItem(offKey(app));
  } catch { /* Keep the pending action in this page if storage is unavailable. */ }
}

function withDeviceLock(app: WebApp, action: () => Promise<void>) {
  return navigator.locks ? navigator.locks.request(offKey(app), action) : action();
}

function canUsePush() {
  return window.isSecureContext && "serviceWorker" in navigator &&
    typeof window.PushManager === "function" && typeof window.Notification?.requestPermission === "function";
}

async function readDevice(): Promise<Device | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration?.active || new URL(registration.active.scriptURL).pathname !== "/service-worker.js") return null;
  return { registration, subscription: await registration.pushManager.getSubscription() };
}

function keyBytes(key: string) {
  return Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));
}

function base64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function matchesKey(subscription: PushSubscription, key: string) {
  const current = subscription.options.applicationServerKey;
  return !!current && base64url(current) === key;
}

function pushData(subscription: PushSubscription) {
  const p256dh = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!p256dh || !auth) throw new ReminderError("浏览器没有提供完整的订阅密钥");
  return { endpoint: new URL(subscription.endpoint).href, keys: { p256dh: base64url(p256dh), auth: base64url(auth) } };
}

async function fingerprint(subscription: PushSubscription) {
  const { endpoint, keys } = pushData(subscription);
  const value = new TextEncoder().encode(JSON.stringify([endpoint, keys.p256dh, keys.auth]));
  return base64url(await crypto.subtle.digest("SHA-256", value));
}

async function request(app: WebApp, token: string, method: "GET" | "PUT" | "DELETE", body?: unknown) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try { return await notificationRequest<ServerStatus>(app, token, "notification-push", method, body, controller.signal); }
  finally { window.clearTimeout(timeout); }
}

const messages: Partial<Record<Status["phase"], string>> = {
  unsupported: "此浏览器当前无法使用系统提醒。iPhone 或 iPad 可从主屏幕打开此应用后重试。",
  installing: "应用正在准备系统提醒，请稍后重试。",
  unconfigured: "服务器当前未配置系统提醒。",
  denied: "系统通知权限已被拒绝。可到浏览器或系统设置允许通知。",
  enabled: "此设备的系统提醒已开启。",
  pending: "关闭请求尚待确认，恢复连接后会重试。",
};

export default function NotificationPush({ app, token, open }: { app: WebApp; token: string; open: boolean }) {
  const [status, setStatus] = useState<Status>({ phase: "loading" });
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const operation = useRef(false);
  const revision = useRef(0);
  const current = () => getAppToken(app) === token;
  const reload = () => setRefresh(value => value + 1);

  async function turnOff() {
    if (!current()) return false;
    const revoke = request(app, token, "DELETE");
    const unsubscribe = (async () => {
      if (!canUsePush()) return false;
      const device = await readDevice();
      if (!device || !current()) return false;
      const subscription = device.subscription;
      return !subscription || await subscription.unsubscribe() ||
        !await device.registration.pushManager.getSubscription();
    })();
    const [server, browser] = await Promise.allSettled([revoke, unsubscribe]);
    const complete = server.status === "fulfilled" && browser.status === "fulfilled" && browser.value;
    if (complete && current()) rememberOff(app, false);
    return complete;
  }

  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      if ((!open && !pendingOff(app)) || !current() || operation.current || document.visibilityState === "hidden") return;
      const version = ++revision.current;
      const show = (next: Status) => {
        if (mounted && current() && revision.current === version) setStatus(next);
      };
      if (pendingOff(app)) {
        try {
          await withDeviceLock(app, async () => {
            if (pendingOff(app)) await turnOff();
          });
        } catch { /* The pending action will be retried on the next refresh. */ }
        if (pendingOff(app)) {
          show({ phase: "pending" });
          return;
        }
      }
      if (!open) return;
      if (!canUsePush()) {
        show({ phase: "unsupported" });
        return;
      }
      let canDisable = false;
      try {
        const device = await readDevice();
        if (!device) {
          show({ phase: "installing" });
          return;
        }
        canDisable = !!device.subscription;
        const server = await request(app, token, "GET");
        if (!mounted || !current() || revision.current !== version) return;
        canDisable ||= !!server.fingerprint;
        const denied = Notification.permission === "denied";
        const agreed = !!(
          server.publicKey && server.fingerprint && device.subscription &&
          Notification.permission === "granted" && matchesKey(device.subscription, server.publicKey) &&
          await fingerprint(device.subscription) === server.fingerprint
        );
        if (!mounted || !current() || revision.current !== version) return;
        if (server.fingerprint && !agreed) {
          await withDeviceLock(app, async () => {
            if (mounted && current() && revision.current === version) {
              await request(app, token, "DELETE", { fingerprint: server.fingerprint });
            }
          });
          canDisable = !!device.subscription;
        }
        if (denied) show({ phase: "denied", canDisable });
        else if (!server.publicKey) show({ phase: "unconfigured", canDisable });
        else if (agreed) show({ phase: "enabled", canDisable });
        else show({
          phase: "ready", publicKey: server.publicKey, canDisable,
          message: device.subscription && !matchesKey(device.subscription, server.publicKey)
            ? "此设备的订阅使用旧配置，重新开启可更新。"
            : undefined,
        });
      } catch {
        show({ phase: "error", canDisable, message: "无法核对系统提醒状态，请检查网络并重试。" });
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === offKey(app)) void sync();
    };
    void sync();
    window.addEventListener("focus", sync);
    window.addEventListener("online", sync);
    window.addEventListener("storage", onStorage);
    navigator.serviceWorker?.addEventListener("controllerchange", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      mounted = false;
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", sync);
      window.removeEventListener("storage", onStorage);
      navigator.serviceWorker?.removeEventListener("controllerchange", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [app, open, token, refresh]);

  function begin() {
    if (!current() || operation.current) return false;
    operation.current = true;
    revision.current += 1;
    setBusy(true);
    return true;
  }

  function finish() {
    operation.current = false;
    if (current()) setBusy(false);
  }

  async function enable() {
    const publicKey = status.publicKey;
    if (!publicKey || !begin()) return;
    try {
      // This call must happen in the click handler before waiting on the
      // service worker, network, or the cross-tab lock.
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (!current()) return;
      if (permission !== "granted") {
        setStatus(previous => ({
          ...previous, phase: permission === "denied" ? "denied" : "ready",
          message: permission === "default" ? "本次未授予通知权限，可再次开启系统提醒。" : undefined,
        }));
        return;
      }
      await withDeviceLock(app, async () => {
        if (!current()) return;
        if (pendingOff(app)) throw new ReminderError("请先确认关闭请求，再重新开启");
        const device = await readDevice();
        if (!device) throw new ReminderError("应用尚未准备好系统提醒，请稍后重试");
        let { subscription } = device;
        const { pushManager } = device.registration;
        if (subscription) {
          const server = await request(app, token, "GET");
          if (!current()) return;
          if (server.publicKey !== publicKey) throw new ReminderError("系统提醒配置已更新，请刷新后重试");
          if (matchesKey(subscription, publicKey) && server.fingerprint === await fingerprint(subscription)) {
            if (current()) setStatus({ phase: "enabled", canDisable: true });
            return;
          }
          // An unconfirmed native subscription may still point at a gateway
          // that replied 404/410. Ask the browser for a fresh subscription.
          if (server.fingerprint) await request(app, token, "DELETE", { fingerprint: server.fingerprint });
          if (!current()) return;
          if (!await subscription.unsubscribe() && await pushManager.getSubscription()) {
            throw new ReminderError("旧订阅暂时无法移除，请重试");
          }
          subscription = null;
        }
        subscription ??= await pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: keyBytes(publicKey),
        });
        if (!current()) return;
        const data = pushData(subscription);
        const expected = await fingerprint(subscription);
        if (!current()) return;
        await synchronizeNotificationSession(app);
        if (!current()) return;
        const server = await request(app, token, "PUT", { ...data, applicationServerKey: publicKey });
        if (!current()) return;
        if (server.fingerprint !== expected || server.publicKey !== publicKey) {
          throw new ReminderError("订阅未得到服务器确认，请刷新后重试");
        }
        setStatus({ phase: "enabled", canDisable: true });
      });
    } catch (error) {
      if (current()) setStatus(previous => ({
        ...previous, phase: "error", canDisable: true,
        message: error instanceof ReminderError || (error instanceof RequestError && error.status)
          ? error.message
          : "无法开启系统提醒，请检查浏览器权限和网络后重试。",
      }));
    } finally {
      finish();
    }
  }

  async function disable() {
    if (!begin()) return;
    try {
      rememberOff(app, true);
      await withDeviceLock(app, async () => { await turnOff(); });
    } catch {
      // Retain the pending opt-out for the next retry.
    } finally {
      finish();
      if (current()) {
        setStatus({ phase: pendingOff(app) ? "pending" : "loading" });
        reload();
      }
    }
  }

  const description = status.message ?? messages[status.phase];
  return <section className="sky-device-notice" aria-label="设备提醒">
    {description ? <p role={status.phase === "error" ? "alert" : "status"}>{description}</p> : null}
    {status.phase === "loading" ? <p role="status">正在核对设备提醒…</p> : null}
    <div className="sky-notice-actions">
      {status.phase === "ready" ? <button type="button" disabled={busy} onClick={() => void enable()}>开启系统提醒</button> : null}
      {status.canDisable ? <button type="button" disabled={busy} onClick={() => void disable()}>关闭系统提醒</button> : null}
      {["pending", "error", "installing", "unconfigured"].includes(status.phase)
        ? <button type="button" disabled={busy} onClick={reload}>重新检查提醒</button> : null}
    </div>
  </section>;
}
