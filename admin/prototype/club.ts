import { useSyncExternalStore } from "react";
import "../../docs/design/prototype/data.js";

export type Basis = "到账颗数" | "赠送次数";
export interface Rules { basis: Basis; clubFee: number; version: number }
export interface Member { name: string; dispatcher: boolean }
export interface Order {
  id: string;
  title: string;
  source: "直接派单" | "客户端下单";
  customer: string;
  dispatcher: string;
  assignee: string | null;
  total: number;
  unit: number;
  paid: number;
  delivered: number;
  times: number;
  claims: { name: string; qty: number; delivered?: number }[];
  status: string;
  change: string;
  changeQty?: number;
  reason: string;
  date: string;
  dispatchFee: number;
  clubFee: number;
  basis: Basis;
  period: string;
  ruleVersion: number | null;
}

interface ReviewData {
  readonly members: string[];
  readonly dispatchers: string[];
  readonly state: {orders: Order[]; rules: Rules};
  setDispatcher: (name: string, enabled: boolean) => void;
  saveRules: (basis: Basis, clubFee: number) => void;
}
const source = (window as Window & { ClubDemo?: ReviewData }).ClubDemo!;
const event = "club-demo-change";
let revision = 0;
window.addEventListener(event, () => { revision++; });
function subscribe(notify: () => void) {
  window.addEventListener(event, notify);
  return () => window.removeEventListener(event, notify);
}
export function useClub() {
  useSyncExternalStore(subscribe, () => revision);
  return {
    orders: source.state.orders,
    members: source.members.map(name => ({ name, dispatcher: source.dispatchers.includes(name) })),
    rules: source.state.rules,
  };
}
export const money = (cents: number) => "¥" + (cents / 100).toFixed(2);
export const setDispatcher = (name: string, enabled: boolean) => source.setDispatcher(name, enabled);
export const saveRules = (basis: Basis, clubFee: number) => source.saveRules(basis, clubFee);
