import type { ClubDashboard, DashboardMetric, DashboardOrderList, DashboardOrderRow, DashboardSource } from "@sky-club/common";
import type Resp from "@/models/Resp";
import { createAppRequest } from "./request";

const request = createAppRequest("/admin/club/dashboard");

export async function getDashboard() {
  const response: Resp<ClubDashboard> = await request.get("");
  const data = response.getData();
  if (!data) throw new Error("仪表盘数据为空");
  return data;
}

export async function getDashboardOrders(metric: DashboardMetric, source?: DashboardSource, after?: string) {
  const response: Resp<DashboardOrderList> = await request.get("/orders", { params: { metric, source, after, limit: 20 } });
  const data = response.getData();
  if (!data) throw new Error("订单清单数据为空");
  return data;
}

export async function getDashboardOrder(id: string) {
  const response: Resp<DashboardOrderRow> = await request.get(`/orders/${encodeURIComponent(id)}`);
  const data = response.getData();
  if (!data) throw new Error("订单详情数据为空");
  return data;
}
