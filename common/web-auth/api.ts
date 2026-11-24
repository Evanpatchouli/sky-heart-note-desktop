export type WebApp = "admin" | "employee" | "client";
export const appNames = { admin: "管理端", employee: "员工端", client: "客户端" };

export interface AppSession {
  id: string;
  username?: string | null;
  nickname?: string | null;
  token: string;
  roles: string[];
  permissions: string[];
}

export interface Candidate extends Pick<AppSession, "id" | "username" | "nickname"> {
  sourceApp: WebApp;
}

const tokenKey = (app: WebApp) => `sky-heart.${app}.token`;
export const getAppToken = (app: WebApp) => localStorage.getItem(tokenKey(app));
export function saveToken(app: WebApp, token: string | null) {
  if (token) localStorage.setItem(tokenKey(app), token);
  else localStorage.removeItem(tokenKey(app));
  window.dispatchEvent(new Event(tokenKey(app)));
}
export const invalidateSession = (app: WebApp) => saveToken(app, null);

export function subscribeToken(app: WebApp, notify: () => void) {
  const key = tokenKey(app);
  const onStorage = (event: StorageEvent) => { if (!event.key || event.key === key) notify(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(key, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(key, notify);
  };
}

export function apiUrl(path: string) {
  return (import.meta.env.VITE_APP_API_BASE_URL || "/api").replace(/\/$/, "") + path;
}

export class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), { ...init, credentials: "include", cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.code !== "SUCCESS") {
    throw new RequestError(body.message || "登录服务暂时不可用", res.status);
  }
  return body.data;
}

export const postLogin = (app: WebApp, type: string, fields: Record<string, string>) =>
  authRequest<AppSession>(`/user/login?type=${type}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...fields, app }),
  });

export const verifySession = (app: WebApp, token: string, signal?: AbortSignal) =>
  authRequest<AppSession>(`/user/session?app=${app}`, {
    signal, headers: { Authorization: `Bearer ${token}` },
  });
