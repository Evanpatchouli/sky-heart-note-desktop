import "./status.css";
import { subscribeToken, type WebApp } from "../web-auth/api";
import { synchronizeNotificationSession } from "./notification-session";

export function registerPwa(app: WebApp) {
  if (!import.meta.env.PROD) return;

  const status = document.createElement("p");
  status.className = "pwa-status";
  status.setAttribute("role", "status");
  document.body.prepend(status);

  let registration: ServiceWorkerRegistration | undefined;
  function renderStatus() {
    let text = "";
    if (!navigator.onLine) {
      text = "当前网络已断开。请在恢复连接后核对业务状态，再重试未确认的操作。";
    } else if (registration?.waiting && navigator.serviceWorker.controller) {
      text = "新版本已准备就绪。请先提交或保存当前内容，再关闭此端所有窗口和标签页，重新打开即可更新。";
    }
    if (status.textContent !== text) status.textContent = text;
  }

  function checkForUpdate() {
    renderStatus();
    if (registration && navigator.onLine) void registration.update().catch(() => {});
  }

  window.addEventListener("offline", renderStatus);
  window.addEventListener("online", checkForUpdate);
  renderStatus();

  if (!("serviceWorker" in navigator)) return;
  const updateNotificationSession = () => { void synchronizeNotificationSession(app).catch(() => {}); };
  subscribeToken(app, updateNotificationSession);
  updateNotificationSession();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  navigator.serviceWorker.addEventListener("controllerchange", renderStatus);
  void navigator.serviceWorker.register("/service-worker.js", { scope: "/", updateViaCache: "none" })
    .then(result => {
      registration = result;
      const watchInstallation = () => result.installing?.addEventListener("statechange", renderStatus);
      result.addEventListener("updatefound", watchInstallation);
      watchInstallation();
      renderStatus();
    })
    .catch(() => {});
}
