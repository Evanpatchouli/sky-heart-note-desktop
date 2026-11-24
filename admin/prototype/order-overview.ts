import type { Order } from "./club";

export const statusColors: Record<string, string> = {
  待派单: "gold", 已派发: "blue", 履约中: "processing", 待结算: "cyan",
  待提交改价: "orange", 待老板答复: "orange", 待登记补款: "gold",
  停送待退款: "volcano", 已退款: "default", 已撤回: "default",
};
export function statusOf(order: Order) {
  const changes: Record<string, string> = {
    draft: "待提交改价", proposed: "待老板答复", agreed: "待登记补款",
    refundDue: "停送待退款", refunded: "已退款",
  };
  if (order.status === "withdrawn") return "已撤回";
  if (changes[order.change]) return changes[order.change];
  if (order.status === "pending") return "待派单";
  if (order.delivered >= order.total) return "待结算";
  return order.status === "active" || order.delivered > 0 ? "履约中" : "已派发";
}

export function availableHearts(order: Order) {
  if (!["已派发", "履约中"].includes(statusOf(order))) return 0;
  const assigned = order.claims.reduce((sum, share) => sum + share.qty, 0);
  return Math.max(0, order.total - assigned);
}

export const orderQueues = {
  pending: "待派单",
  available: "有可承接份额",
  delivered: "已有到账",
  changes: "改价与退款待办",
} as const;
export type Queue = keyof typeof orderQueues;

export function inQueue(order: Order, queue: Queue) {
  switch (queue) {
    case "pending": return order.status === "pending";
    case "available": return availableHearts(order) > 0;
    case "delivered": return order.delivered > 0;
    case "changes": return ["待提交改价","待老板答复","待登记补款","停送待退款"].includes(statusOf(order));
  }
}

export function ordersUrl(filters: { queue?: Queue; order?: string; source?: Order["source"] } = {}) {
  const params = new URLSearchParams(filters);
  return "/club/orders" + (params.size ? "?" + params : "");
}
