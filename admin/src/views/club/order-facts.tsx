import { Descriptions, Tag, Typography } from "antd";
import type { DashboardOrderRow } from "@sky-club/common";
import { dispatchStatusLabel, received, sourceLabels } from "./dashboard-shared";

export default function OrderFacts({ row }: { row: DashboardOrderRow }) {
  return <Descriptions bordered size="small" column={1} items={[
    { key: "id", label: "订单编号", children: <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{row.orderId}</Typography.Text> },
    { key: "source", label: "订单来源", children: sourceLabels[row.source] },
    { key: "account", label: "收心账号", children: row.recipientGameAccount },
    { key: "dispatcher", label: "派单人", children: row.dispatcherUserId ?? "待分配" },
    { key: "status", label: "状态", children: <><Tag>{dispatchStatusLabel(row.dispatchStatus)}</Tag>{row.actionLabel ? <Tag color="orange">{row.actionLabel}</Tag> : null}</> },
    { key: "unit", label: "计量方式", children: row.priceUnit === "hearts" ? "历史按颗订单" : "按赠送次数" },
    ...(row.priceUnit === "gift_times" ? [
      { key: "agreed", label: "约定赠送", children: row.agreedGiftTimes === null ? "待确认" : `${row.agreedGiftTimes} 次` },
      { key: "claimable", label: "可承接", children: `${row.claimableGiftTimes} 次` },
      { key: "delivered", label: "已履约", children: row.deliveredGiftTimes === null ? "待确认" : `${row.deliveredGiftTimes} 次` },
    ] : []),
    { key: "received", label: "实际到账", children: received(row.knownReceivedHearts, row.unknownReceivedLines, row.knownReceivedLines) },
  ]} />;
}
