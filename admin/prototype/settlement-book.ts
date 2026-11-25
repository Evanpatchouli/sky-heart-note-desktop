import { useSyncExternalStore } from "react";
import { money } from "./club";

type Worker = { name: string; delivered: number };
export type Settlement = {
  id: string; title: string; paidHearts: number; giftHearts: number;
  unit: number; dispatcher: string; dispatchFee: number; clubFee: number;
  workers: Worker[];
};
export type Entry = { id: string; category: string; account: string; amount: number; note: string };
export const cases: Settlement[] = [
  { id: "JZ-1124-01", title: "普通送心 · 100 颗", paidHearts: 100, giftHearts: 0,
    unit: 50, dispatcher: "青禾", dispatchFee: 5, clubFee: 5,
    workers: [{ name: "云岫", delivered: 50 }, { name: "阿澄", delivered: 50 }] },
  { id: "JZ-1124-02", title: "买 100 送 5", paidHearts: 100, giftHearts: 5,
    unit: 50, dispatcher: "鹿鸣", dispatchFee: 5, clubFee: 5,
    workers: [{ name: "禾川", delivered: 105 }] },
];

export function reconcile(s: Settlement) {
  const delivered = s.workers.reduce((sum, w) => sum + w.delivered, 0);
  const receipt = s.paidHearts * s.unit;
  const unitNet = s.unit - s.dispatchFee - s.clubFee;
  const entries: Entry[] = [
    { id: s.id + "-D", category: "派单收益", account: s.dispatcher, amount: delivered * s.dispatchFee,
      note: `${delivered} 颗 × ${money(s.dispatchFee)}` },
    { id: s.id + "-C", category: "团抽收入", account: "团费", amount: delivered * s.clubFee,
      note: `${delivered} 颗 × ${money(s.clubFee)}` },
    ...s.workers.map((worker, index) => ({
      id: s.id + "-W" + (index + 1), category: "送心收益", account: worker.name,
      amount: worker.delivered * unitNet,
      note: `${worker.delivered} 颗 × ${money(unitNet)}`,
    })),
  ];
  if (s.giftHearts) entries.push({
    id: s.id + "-G", category: "赠心支出", account: "团费", amount: -s.giftHearts * s.unit,
    note: `赠送 ${s.giftHearts} 颗 × ${money(s.unit)}，从团费扣除`,
  });
  const allocated = entries.reduce((sum, e) => sum + e.amount, 0);
  const clubNet = delivered * s.clubFee - s.giftHearts * s.unit;
  return { delivered, receipt, entries, allocated, clubNet, difference: receipt - allocated };
}

// 每个结算单仅占用一个凭据键。页面与流水均从同一凭据推导，重复操作不追加金额。
const key = (id: string) => "sky-club.admin-review.finance.v1." + id;
const memory = new Map<string, string>();
const updated = "sky-club-finance-posted";
export function postedAt(id: string) {
  try { return localStorage.getItem(key(id)) ?? memory.get(id) ?? null; } catch { return memory.get(id) ?? null; }
}
export function savePosting(id: string) {
  if (postedAt(id)) return;
  const timestamp = new Date().toISOString();
  try { localStorage.setItem(key(id), timestamp); } catch { memory.set(id, timestamp); }
  window.dispatchEvent(new Event(updated));
}
export function resetPostings() {
  for (const s of cases) {
    try { localStorage.removeItem(key(s.id)); } catch { /* 使用本页内存。 */ }
    memory.delete(s.id);
  }
  window.dispatchEvent(new Event(updated));
}
function subscribe(notify: () => void) {
  window.addEventListener(updated, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(updated, notify);
    window.removeEventListener("storage", notify);
  };
}
const snapshot = () => cases.map(s => postedAt(s.id) || "").join("|");
export const signed = (amount: number) => (amount < 0 ? "−" : "+") + money(Math.abs(amount));

export function useSettlements() {
  useSyncExternalStore(subscribe, snapshot);
  return { posted: cases.filter(s => postedAt(s.id)), pending: cases.filter(s => !postedAt(s.id)) };
}
