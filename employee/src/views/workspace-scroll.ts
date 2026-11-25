import { useLayoutEffect, useRef, type UIEvent } from "react";

export function useWorkspaceScroll<Element extends HTMLElement = HTMLElement>(
  context: string, ready: boolean, axis: "scrollTop" | "scrollLeft" = "scrollTop",
  initialPosition?: (element: Element) => number,
) {
  const ref = useRef<Element>(null);
  const storageKey = `sky-club.employee.workspace-scroll.v1:${context}`;
  const restored = useRef<string>(undefined);

  useLayoutEffect(() => {
    restored.current = undefined;
  }, [storageKey]);

  useLayoutEffect(() => {
    if (!ready || !ref.current || restored.current === storageKey) return;
    let saved: string | null = null;
    try { saved = sessionStorage.getItem(storageKey); } catch { /* Optional UI context. */ }
    ref.current[axis] = saved === null ? initialPosition?.(ref.current) ?? 0 : Math.max(0, Number(saved) || 0);
    restored.current = storageKey;
  }, [ready, storageKey, axis, initialPosition]);

  return { ref, onScroll(event: UIEvent<Element>) {
    if (!ready || restored.current !== storageKey) return;
    try { sessionStorage.setItem(storageKey, String(event.currentTarget[axis])); } catch { /* Optional UI context. */ }
  } };
}
