import { authRequest, type WebApp } from "../web-auth/api";

export function notificationRequest<T>(app: WebApp, token: string, path: string, method = "GET", body?: unknown, signal?: AbortSignal) {
  return authRequest<T>(`/${app}/${path}`, {
    method, signal, referrerPolicy: "origin",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
