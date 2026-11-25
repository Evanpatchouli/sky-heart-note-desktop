import { useEffect, useSyncExternalStore } from "react";

const paths = {
  inbox: "M3 14l3-10h12l3 10v6H3zM3 14h5l2 3h4l2-3h5",
  send: "M3 11 21 3l-6 18-4-7-8-3Zm8 3L21 3",
  user: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6m-6 4h6",
  plus: "M12 4v16M4 12h16",
};

export function NavigationIcon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="20" height="20" fill="none"
    stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

const phoneQuery = "(width < 600px)";

function subscribeToPhoneWidth(change: () => void) {
  const media = window.matchMedia(phoneQuery);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}

export function usePhoneWidth() {
  return useSyncExternalStore(subscribeToPhoneWidth, () => window.matchMedia(phoneQuery).matches);
}

export function useMobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const phone = window.matchMedia(phoneQuery);
    const app = document.documentElement;
    let width = window.innerWidth;
    let availableHeight = window.innerHeight;
    let keyboard = false;

    function update() {
      const height = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
      const focused = document.activeElement;
      const editing = focused?.matches("textarea, [contenteditable='true'], input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='tel'], input[type='password'], input[type='number'], input[type='url']");
      if (width !== window.innerWidth) {
        width = window.innerWidth;
        availableHeight = window.innerHeight;
      }
      if (!editing && !keyboard) availableHeight = window.innerHeight;
      keyboard = phone.matches && !!(editing || keyboard) && Math.max(availableHeight, window.innerHeight) - height > 120 && (viewport?.scale ?? 1) < 1.1;
      app.toggleAttribute("data-mobile-keyboard", keyboard);
      if (keyboard) app.style.setProperty("--mobile-viewport-height", `${Math.floor(height)}px`);
      else app.style.removeProperty("--mobile-viewport-height");
    }

    update();
    window.addEventListener("resize", update);
    viewport?.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    return () => {
      window.removeEventListener("resize", update);
      viewport?.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      app.removeAttribute("data-mobile-keyboard");
      app.style.removeProperty("--mobile-viewport-height");
    };
  }, []);
}
