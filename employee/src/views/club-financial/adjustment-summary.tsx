import { Descriptions, Tag } from "antd";
import { clubAdjustmentStatusLabel, clubPenaltyPostingLabel, formatCentsAsYuan, type ClubAdjustmentRecord } from "@sky-club/common";

export const money = (cents: number) => `${cents < 0 ? "−" : ""}¥${formatCentsAsYuan(Math.abs(cents))}`;
export const showDate = (date: string) => new Date(date).toLocaleString("zh-CN");

export function AdjustmentSummary({ row, names, showOrder }: {
  row: ClubAdjustmentRecord;
  names: Record<string, string | null>;
  showOrder?: boolean;
}) {
  const name = (id: string) => names[id] ? `${names[id]} · ${id}` : id;
  const member = row.memberUserId;
  const customer = row.customerUserId;
  return <Descriptions size="small" column={1} items={[
    { key: "status", label: member ? "责任团员罚款" : "额外售后补偿", children: <>
      <Tag color={row.status === "approved" ? "green" : row.status === "pending" ? "orange" : "default"}>
        {clubAdjustmentStatusLabel[row.status]}
      </Tag>{money(row.amountCents)}
    </> },
    ...(row.penaltyPosting ? [{ key: "posting", label: "入账", children: clubPenaltyPostingLabel[row.penaltyPosting] }] : []),
    ...(member || customer ? [{ key: "subject", label: member ? "责任团员" : "退款对象", children: name((member || customer)!) }] : []),
    ...(showOrder && row.orderId ? [{ key: "order", label: "订单", children: <code style={{ overflowWrap: "anywhere" }}>{row.orderId}</code> }] : []),
    { key: "reason", label: "原因", children: row.reason },
    { key: "request", label: "提交", children: `${name(row.requestedByUserId)} · ${showDate(row.createdAt)}` },
    ...(row.decidedByUserId && row.decidedAt ? [{ key: "decision", label: "审核", children: <>
      {name(row.decidedByUserId)} · {showDate(row.decidedAt)}{row.decisionReason ? ` · ${row.decisionReason}` : ""}
    </> }] : []),
  ]} />;
}
