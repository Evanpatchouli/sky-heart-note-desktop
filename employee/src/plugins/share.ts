import { useEffect, useMemo, useState } from "react";
import { useAuthSession } from "@sky-club/common/web-auth";
import { employeeRequest } from "#/service/request";
import toast from "#/utils/toast";

type RegisterOptions = { ifNotExists?: boolean; broadcast?: boolean };
const localEvents = new EventTarget();
const decode = <T>(raw: string): T => {
  try { return JSON.parse(raw) as T; }
  catch { return raw as T; }
};

// The API owns the values. Browser events only invalidate the signed-in employee's cache.
function employeeShare(owner: string) {
  const topic = `employee-share:${owner}`;
  const read = () => employeeRequest<Record<string, string>>("share");
  const notify = (key: string | null) => {
    localEvents.dispatchEvent(new CustomEvent(topic, { detail: key }));
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(topic);
      channel.postMessage(key);
      channel.close();
    }
  };
  const write = async (key: string, value: unknown, options: RegisterOptions = {}) => {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("共享状态需要可序列化的值");
    const changed = await employeeRequest<boolean>("share", "POST", { key, value: serialized, ifNotExists: !!options.ifNotExists });
    if (changed && options.broadcast) notify(key);
    return changed;
  };
  const mapping = async <T = unknown>() =>
    Object.fromEntries(Object.entries(await read()).map(([key, value]) => [key, decode<T>(value)]));
  return {
    register: write,
    set: (key: string, value: unknown) => write(key, value, { broadcast: true }),
    get: async <T>(key: string) => {
      const result = await read();
      return Object.hasOwn(result, key) ? decode<T>(result[key]) : undefined;
    },
    has: async (key: string) => Object.hasOwn(await read(), key),
    keys: async () => Object.keys(await read()),
    values: async <T = unknown>() => Object.values(await mapping<T>()),
    entries: async <T = unknown>() => Object.entries(await mapping<T>()),
    size: async () => Object.keys(await read()).length,
    mapping,
    remove: async (key: string) => {
      await employeeRequest(`share?key=${encodeURIComponent(key)}`, "DELETE");
      notify(key);
    },
    clear: async () => {
      await employeeRequest("share", "DELETE");
      notify(null);
    },
    subscribe: (key: string, callback: () => void) => {
      const onKey = (changed: unknown) => { if (changed === null || changed === key) callback(); };
      const onLocal = (event: Event) => onKey((event as CustomEvent).detail);
      localEvents.addEventListener(topic, onLocal);
      const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(topic) : undefined;
      if (channel) channel.onmessage = event => onKey(event.data);
      return () => { localEvents.removeEventListener(topic, onLocal); channel?.close(); };
    },
  };
}

export function useEmployeeShare() {
  const { id } = useAuthSession();
  return useMemo(() => employeeShare(id), [id]);
}

export function useSharedValue<T>(key: string, initialValue: T) {
  const share = useEmployeeShare();
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const stored = await share.get<T>(key);
        if (current === revision) setValue(stored === undefined ? initialValue : stored);
      } catch (err) {
        if (current === revision) toast.error(err instanceof Error ? err.message : "共享状态读取失败");
      }
    };
    const unsubscribe = share.subscribe(key, refresh);
    void refresh();
    return () => { ++revision; unsubscribe(); };
  }, [share, key, initialValue]);
  const update = async (next: T) => {
    try { await share.set(key, next); }
    catch (err) { toast.error(err instanceof Error ? err.message : "共享状态更新失败"); }
  };
  return [value, update] as const;
}
