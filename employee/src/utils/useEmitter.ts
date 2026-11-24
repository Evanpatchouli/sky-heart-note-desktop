import { useEffect, useRef } from "react";

type AppEvent<T = unknown> = { type: string; payload: T; id?: string };
const events = new EventTarget();

function emit<T>(event: AppEvent<T>) {
  events.dispatchEvent(new CustomEvent(event.type, { detail: event }));
}

function useSubscription<T>(type: string, callback: (event: AppEvent<T>) => void) {
  const current = useRef(callback);
  useEffect(() => { current.current = callback; });
  useEffect(() => {
    const listener = (event: Event) => current.current((event as CustomEvent<AppEvent<T>>).detail);
    events.addEventListener(type, listener);
    return () => events.removeEventListener(type, listener);
  }, [type]);
}

export default function useEmitter() {
  return { emit, useSubscription };
}
