import { Alert, Button, Collapse, Descriptions, Flex, Table, Tag, Typography } from "antd";
import {
  clubPenaltyPostingLabel, clubSettlementPostingLabel, formatCentsAsYuan, giftSettlementIssueLabel, giftSettlementStatusLabel, settlementCashMovementLabel,
  type AdminGiftSettlement, type GiftSettlementAmounts, type GiftSettlementProgress,
} from "@webapp-template/common";

const periods = { normal: "普通期", double: "双倍期", unconfirmed: "待核对时段" };
const kinds = { daily: "日报", supplement: "补报", correction: "更正" };
const adjustmentStates = {
  awaiting_decision: "待答复", awaiting_supplement: "待补款", continuing: "已补款续送",
  stopped: "已拒补停送", needs_requote: "待更新报价", superseded: "已替换",
};
const distribution: [keyof GiftSettlementAmounts, string][] = [
  ["grossCents", "履约服务原价"], ["rewardCents", "送心报酬合计"],
  ["dispatchFeeCents", "派抽原额"], ["personalDiscountCents", "个人让利"], ["dispatchNetCents", "派单人净额"],
  ["clubFeeCents", "团抽原额"], ["platformDiscountCents", "平台优惠"], ["promotionalGiftCostCents", "赠送成本"],
  ["clubNetCents", "团费净额"], ["allocatedCents", "分配合计"],
];
const cashLabels = {
  originalReceivedCents: "首款实收", continuationReceivedCents: "续段实收", supplementReceivedCents: "改价实补",
  refundDueCents: "应退", refundedCents: "实退", refundRemainingCents: "待退",
  excessRefundCents: "超退", netReceivedCents: "净实收",
  compensationRefundDueCents: "其中额外补偿应退", compensationRefundedCents: "其中额外补偿实退",
  compensationRefundRemainingCents: "其中额外补偿待退",
} as const;
const adjustmentStatus = { approved: "已生效", pending: "待确认", rejected: "已驳回" };
const money = (cents: number | null) => cents === null ? "待核对" :
  `${cents < 0 ? "−" : ""}¥${formatCentsAsYuan(Math.abs(cents))}`;
const datetime = (value: string) => new Date(value).toLocaleString("zh-CN");

function actualHearts(item: GiftSettlementProgress) {
  return item.actualReceivedHearts == null
    ? item.knownReceivedLines ? `部分未知 · 已知 ${item.knownReceivedHearts} 颗` : "未知"
    : `${item.actualReceivedHearts} 颗`;
}

export default function GiftSettlementDetail({ data, history, compact, onChange, refresh }: {
  data: AdminGiftSettlement;
  history: boolean;
  compact: boolean;
  onChange: (id?: string) => void;
  refresh: () => void;
}) {
  const { cash, finalCalculation, previousCalculation, pricing, receipt, termination } = data;
  const name = (id: string) => data.memberNames[id] ? `${data.memberNames[id]} · ${id}` : id;
  return <Flex vertical gap="middle">
    <Flex align="center" wrap justify="space-between" gap="small">
      <div>
        <Tag color={data.status === "ready_to_close" ? "green" : "blue"}>{history ? "历史计算单" : giftSettlementStatusLabel[data.status]}</Tag>
        {!history ? (data.status === "closed" ? <Tag color="green">已入账</Tag> : <Tag>未入账</Tag>) : null}
        {data.stopped ? <Tag>已停送</Tag> : null}
      </div>
      <Button onClick={() => history ? onChange() : refresh()}>{history ? "查看当前核算" : "刷新核算"}</Button>
    </Flex>
    {finalCalculation ? <Typography.Text type="secondary">
      计算单 V{finalCalculation.version} · {datetime(finalCalculation.calculatedAt)}
    </Typography.Text> : null}
    {previousCalculation ? <Button onClick={() => onChange(previousCalculation.id)}>查阅上一份最终计算单</Button> : null}
    {data.close ? <Flex align="center" wrap gap="small">
      <Typography.Text>结单人 {name(data.close.closedByUserId)} · {datetime(data.close.closedAt)}</Typography.Text>
      <Button onClick={() => onChange(data.close!.calculationId)}>查阅结单原计算单</Button>
    </Flex> : null}
    {data.corrections?.length ? <Collapse size="small" items={[{ key: "corrections", label: "结单后更正", children: <Flex vertical gap="middle">
      {data.corrections.map(row => <section key={row.requestId}>
        <Tag>{adjustmentStatus[row.status]}</Tag>
        <Typography.Text strong>{row.kind === "cash" ? settlementCashMovementLabel[row.movement.kind] : `${row.businessDate} 日报`}</Typography.Text>
        <div>{name(row.requestedByUserId)} · {datetime(row.requestedAt)} · {row.reason}</div>
        {row.decidedAt && row.decidedByUserId ? <div>审批 {name(row.decidedByUserId)} · {datetime(row.decidedAt)}{row.decisionReason ? ` · ${row.decisionReason}` : ""}</div> : null}
        {row.kind === "cash" ? <>
          <div>{money(row.movement.effectiveAmountCents)} → {money(row.correctedAmountCents)}{row.deltaCents !== undefined ? ` · 差额 ${money(row.deltaCents)}` : ""}</div>
          <div style={{ overflowWrap: "anywhere" }}>原转账凭据 · {row.evidence}</div>
        </> : <>
          {row.postings?.map(line => <div key={`${line.kind}:${line.memberUserId}`}>
            {line.memberUserId ? name(line.memberUserId) : "团费"} · {clubSettlementPostingLabel[line.kind]} · {money(line.amountCents)}
          </div>)}
          {row.couponChange ? <div>{row.couponChange.status === "used" ? "恢复原单用券" : "返还原券"} · {datetime(row.couponChange.changedAt)}
            {row.couponChange.previousReturnedAt ? ` · 上次返还 ${datetime(row.couponChange.previousReturnedAt)}` : ""}</div> : null}
          {row.revisedCalculationId ? <Button size="small" onClick={() => onChange(row.revisedCalculationId)}>查阅更正计算单</Button> : null}
        </>}
      </section>)}
    </Flex> }]} /> : null}
    {data.issues.length ? <Alert type="warning" showIcon title="核对事项"
      description={data.issues.map(issue => giftSettlementIssueLabel[issue]).join("、")} /> : null}
    <Descriptions size="small" column={compact ? 1 : 2} bordered items={[
      { key: "order", label: "订单", children: <Typography.Text copyable>{data.orderId}</Typography.Text> },
      { key: "delivery", label: "已履约 / 约定", children: `${data.deliveredGiftTimes} / ${data.agreedGiftTimes} 次` },
      { key: "reported", label: "日报实际赠送 / 超出计酬范围", children: `${data.observedGiftTimes} / ${data.excessGiftTimes} 次` },
      { key: "hearts", label: "实际到账", children: actualHearts(data) },
      ...(pricing ? [{ key: "pricing", label: "发布时锁定抽成",
        children: `V${pricing.version} · 每次派抽 ${money(pricing.dispatchFeeCents)} · 每次团抽 ${money(pricing.clubFeeCents)}` }] : []),
      { key: "difference", label: "净实收减已履约分配", children: money(data.totals.differenceCents) },
    ]} />
    {cash ? <Descriptions title="客户侧款项" size="small" column={compact ? 1 : 2} bordered
      items={Object.entries(cashLabels).flatMap(([key, label]) => {
        const value = cash[key as keyof typeof cash];
        return value === undefined ? [] : [{ key, label, children: money(value) }];
      })} /> : null}
    <Table rowKey="key" size="small" pagination={false}
      dataSource={[
        ...distribution,
        ...(data.totals.customerCompensationCents !== undefined ? [
          ["customerCompensationCents", "团费额外补偿"], ["memberPenaltyCents", "责任团员扣款"],
          ["memberNetCents", "团员报酬与扣款净额"],
        ] as [keyof GiftSettlementAmounts, string][] : []),
        ...(data.totals.compensationCashCorrectionCents !== undefined
          ? [["compensationCashCorrectionCents", "补偿实退更正差额"]] as [keyof GiftSettlementAmounts, string][] : []),
      ].map(([key, label]) => ({ key, label, planned: data.planned[key] === undefined ? "—" : money(data.planned[key]!),
        actual: data.totals[key] === undefined ? "—" : money(data.totals[key]!) }))}
      columns={[{ title: "分配项目", dataIndex: "label" }, { title: "按约定预计", dataIndex: "planned" },
        { title: "按有效实绩", dataIndex: "actual" }]} />
    <Collapse size="small" items={data.segments.map(segment => ({
      key: segment.segmentIndex, label: `第 ${segment.segmentIndex + 1} 段 · ${periods[segment.quote.period]} · ${segment.quote.promotionalGiftTimes ? "促销赠送" : "付费"}`,
      children: <Descriptions size="small" column={1} items={[
        { key: "unit", label: "计价单价", children: `${money(segment.quote.unitPriceCents)}/次` },
        { key: "progress", label: "已履约 / 约定", children: `${segment.deliveredGiftTimes} / ${segment.agreedGiftTimes} 次` },
        { key: "actual", label: "实际到账", children: actualHearts(segment) },
        { key: "expected", label: "预计送心报酬", children: money(segment.planned.rewardCents) },
        { key: "reward", label: "实绩送心报酬", children: money(segment.totals.rewardCents) },
      ]} />,
    }))} />
    <Table rowKey="userId" size="small" pagination={{ pageSize: 10 }} dataSource={data.members} expandable={{
      expandedRowRender: member => member.segments.map(segment => <div key={segment.segmentIndex}>
        <Typography.Text strong>第 {segment.segmentIndex + 1} 段 · {segment.deliveredGiftTimes}/{segment.agreedGiftTimes} 次 · {actualHearts(segment)}</Typography.Text>
        <div>原价 {money(segment.grossCents)} · 派抽 {money(segment.dispatchFeeCents)} · 团抽 {money(segment.clubFeeCents)} · 实绩报酬 {money(segment.rewardCents)}</div>
      </div>),
    }} columns={[
      { title: "送心员", dataIndex: "userId", render: name },
      { title: "计酬次数", render: (_, member) => member.deliveredGiftTimes },
      { title: "预计报酬", dataIndex: "plannedRewardCents", render: money },
      { title: "实绩报酬", render: (_, member) => <>
        {money(member.rewardCents)}
        {member.penaltyCents !== undefined ? <div>扣款 {money(member.penaltyCents)} · 净额 {money(member.netRewardCents ?? null)}</div> : null}
      </> },
    ]} />
    <Collapse size="small" items={[
      { key: "payments", label: "确认报价、收退款与改价依据", children: <Flex vertical gap="small">
        {receipt ? <>
          <Typography.Text>确认报价 V{receipt.quote.revision} · 折后 {money(receipt.quote.totalAmountCents)} · 原登记实收 {money(receipt.receivedAmountCents)}</Typography.Text>
          <Typography.Text>收款人 {name(receipt.receivedByUserId)} · {datetime(receipt.receivedAt)}</Typography.Text>
          {receipt.quote.giftSegments?.map((segment, index) => <Typography.Text key={index}>
            原第 {index + 1} 段 · {periods[segment.period]} · 付费 {segment.paidGiftTimes} 次 · {money(segment.unitPriceCents)}/次
          </Typography.Text>)}
        </> : null}
        {data.continuations.map(quote => <Typography.Text key={quote.requestId}>
          续段 · {quote.segment.paidGiftTimes} 次 × {money(quote.segment.unitPriceCents)} ·
          {quote.receipt ? ` 实收 ${money(quote.receipt.receivedAmountCents)} · ${datetime(quote.receipt.receivedAt)}` : quote.acceptance ? " 已确认待收款" : " 待老板确认"}
        </Typography.Text>)}
        {data.priceAdjustments.map(change => <Flex key={change.id} vertical>
          <Typography.Text>第 {change.preview.quoteSegment} 段改价 · {adjustmentStates[change.state]} · {change.reason}</Typography.Text>
          <Typography.Text>拟差额 {money(change.preview.differenceCents)} · 第 {change.newQuoteSegment ?? "—"} 段承接新单价</Typography.Text>
          {change.payments.filter(payment => payment.kind === "supplement").map(payment => <Typography.Text key={payment.requestId}>
            实补 {money(payment.amountCents)} · {datetime(payment.occurredAt)} · {payment.reason}
          </Typography.Text>)}
        </Flex>)}
        {termination ? <>
          <Typography.Text>停送 · {datetime(termination.stoppedAt)}{termination.reason ? ` · ${termination.reason}` : ""}</Typography.Text>
          {termination.customerRequestReference ? <Typography.Text>{termination.customerRequestReference}</Typography.Text> : null}
          {termination.refunds.map(payment => <Typography.Text key={payment.requestId}>
            实退 {money(payment.amountCents)} · {datetime(payment.occurredAt)} · {payment.reason}
          </Typography.Text>)}
        </> : null}
      </Flex> },
      ...(data.adjustments?.length ? [{ key: "adjustments", label: "额外补偿与责任扣款", children:
        <Flex vertical gap="small">{data.adjustments.map(adjustment => <section key={adjustment.id}>
          <Typography.Text strong>{adjustment.kind === "customer_compensation" ? "额外补偿" : "责任扣款"} · {money(adjustment.amountCents)}
            {adjustment.memberUserId ? ` · ${name(adjustment.memberUserId)}` : ""} · {adjustmentStatus[adjustment.status]}</Typography.Text>
          {adjustment.penaltyPosting ? <div>{clubPenaltyPostingLabel[adjustment.penaltyPosting]}</div> : null}
          <div>{adjustment.reason}</div>
          {adjustment.decidedAt && adjustment.decidedByUserId ? <div>{name(adjustment.decidedByUserId)} · {datetime(adjustment.decidedAt)}{adjustment.decisionReason ? ` · ${adjustment.decisionReason}` : ""}</div> : null}
          {adjustment.refunds.map(payment => <div key={payment.requestId}>实退 {money(payment.amountCents)} · {datetime(payment.occurredAt)} · {name(payment.recordedByUserId)}{payment.evidence ? ` · ${payment.evidence}` : ""}</div>)}
        </section>)}</Flex>,
      }] : []),
      { key: "reports", label: `日报依据（${data.reports.length} 个版本）`, children:
        <Table rowKey="id" size="small" dataSource={data.reports} pagination={{ pageSize: 10 }} expandable={{
          expandedRowRender: report => <Flex vertical>
            {report.reason ? <Typography.Text>{report.reason}</Typography.Text> : null}
            {report.lines.map((line, index) => <span key={index}>{periods[line.period]} · {line.giftTimes} 次 · {line.receivedHearts == null ? "到账未知" : `到账 ${line.receivedHearts} 颗`}</span>)}
          </Flex>,
        }} columns={[
          { title: "业务日", dataIndex: "businessDate" },
          { title: "送心员", dataIndex: "userId", render: name },
          { title: "版本", render: (_, report) => `${kinds[report.kind]} V${report.version} · ${report.effective ? "有效" : "已替换"}` },
        ]} /> },
    ]} />
  </Flex>;
}
