import type { DashboardMetric, DashboardSource } from "@sky-club/common";

export const sourceLabels: Record<DashboardSource, string> = { direct_dispatch: "直接派单", client_order: "客户端下单" };
export const metricLabels: Record<DashboardMetric, string> = {
  all: "全部订单", pending_dispatch: "待派单订单", claimable: "可承接订单", fulfilled: "已有履约订单",
  received: "已有到账记录", action_required: "改价与退款待办", ready_to_close: "待结单订单",
};
export function orderUrl(options: { metric?: DashboardMetric; source?: DashboardSource; order?: string } = {}) {
  const params = new URLSearchParams();
  if (options.metric) params.set("metric", options.metric);
  if (options.source) params.set("source", options.source);
  if (options.order) params.set("order", options.order);
  return `/club/orders${params.size ? `?${params}` : ""}`;
}
export function received(known: number, unknown: number, lines: number) {
  if (!lines) return unknown ? `待确认（${unknown} 条）` : "暂无到账记录";
  return `${known} 颗${unknown ? `（${unknown} 条到账待确认）` : ""}`;
}
export function dispatchStatusLabel(status: string) {
  const labels: Record<string, string> = { draft: "草稿", pending_assignment: "待分配派单人", pending: "待派单", published: "已派发", cancelled: "已取消" };
  return labels[status] ?? "状态待确认";
}
