import { useLayoutEffect } from "react";

const key = (userId: string, name: string) => `sky-club.client.navigation.v1:${userId}:${name}`;

export function readClientContext(userId: string, name: string) {
  try { return sessionStorage.getItem(key(userId, name)); } catch { return null; }
}

export function rememberClientContext(userId: string, name: string, value: string) {
  try { sessionStorage.setItem(key(userId, name), value); } catch { /* Optional UI context. */ }
}

const orderIdPattern = /^[a-f0-9]{24}$/i;

export function orderCursor(search = window.location.search) {
  const cursor = new URLSearchParams(search).get("after");
  return cursor && orderIdPattern.test(cursor) ? cursor : null;
}

function validSource(value: string | null) {
  return value === "direct_dispatch" || value === "client_order" ? value : null;
}

export function orderSource(search = window.location.search) {
  return validSource(new URLSearchParams(search).get("source"));
}

export function orderListHref(cursor: string | null, source: string | null = null) {
  const params = new URLSearchParams();
  if (cursor && orderIdPattern.test(cursor)) params.set("after", cursor);
  if (source && validSource(source)) params.set("source", source);
  return params.size ? `/?${params}` : "/";
}

export function rememberedOrderList(userId: string) {
  return orderListHref(readClientContext(userId, "cursor"), readClientContext(userId, "source"));
}

export function useClientScroll(userId: string, context: string, ready: boolean) {
  useLayoutEffect(() => {
    if (!ready) return;
    const key = `scroll:${context}`;
    window.scrollTo(0, Number(readClientContext(userId, key)) || 0);
    const remember = () => rememberClientContext(userId, key, String(window.scrollY));
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [userId, context, ready]);
}

export function readClientNavigationOwner() {
  try { return sessionStorage.getItem("sky-club.client.navigation.v1:current-user"); } catch { return null; }
}

export function rememberClientNavigationOwner(userId: string) {
  try { sessionStorage.setItem("sky-club.client.navigation.v1:current-user", userId); } catch { /* Optional UI context. */ }
}
