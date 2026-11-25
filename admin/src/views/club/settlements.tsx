import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router";
import { Alert, Button, Card, Collapse, Descriptions, Drawer, Empty, Flex, Grid, Spin, Table, Tag, Typography } from "antd";
import {
  commissionBasisLabel, commissionUnit, formatCentsAsYuan, priceAdjustmentStateLabel, settlementIssueLabel,
  giftSettlementStatusLabel, type GiftSettlementRow, type AdminGiftSettlement,
  terminationReviewLabel, type AdminSettlement, type DispatchTermination, type PriceAdjustment, type SettlementOrderRow, type ServiceBusinessType,
} from "@sky-club/common";
import { getSettlement, getSettlements } from "@/api/club.api";
import type { AdminClubContext } from "../home";
import GiftSettlementDetail from "./gift-settlement-detail";
import ClubBalanceCard from "./club-balance";
import WithdrawalPayments from "./withdrawal-payments";
import { ServiceOrders } from "@sky-club/common/service-orders";
import { useLoginStore } from "@/auth/store";

const sources = { direct_dispatch: "直接派单", client_order: "客户端下单" };
const periods = { normal: "普通期", double: "双倍期", unconfirmed: "待确认" };
const kinds = { daily: "日报", correction: "更正", supplement: "补报" };
function Money({ cents, unit }: { cents: number | null | undefined; unit?: string }) {
  return <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
    {cents == null ? "待核对" : `${cents < 0 ? "−" : ""}¥${formatCentsAsYuan(Math.abs(cents))}${unit ? `/${unit}` : ""}`}
  </span>;
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

function requestError(error: unknown) {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message : "结算核算加载失败";
}

export default function Settlements() {
  const { club, loadFailed, reload } = useOutletContext<AdminClubContext>();
  const [params, setParams] = useSearchParams();
  const token = useLoginStore(state => state.token) ?? "";
  const userId = useLoginStore(state => state.userInfo?.id) ?? "";
  const selected = club?.permissions.includes("CLUB_FINANCE_READ") ? club : null;
  const mayPay = !!club?.permissions.includes("CLUB_WITHDRAWAL_PAY");
  const [balanceRevision, setBalanceRevision] = useState(0);
  const refreshBalance = useCallback(() => setBalanceRevision(value => value + 1), []);
  const orderId = params.get("order") ?? undefined;
  const calculationId = params.get("calculation") ?? undefined;
  const business = params.get("business") === "companionship" ? "companionship" : params.get("business") === "daily_run" ? "daily_run" : undefined;
  const { md } = Grid.useBreakpoint();

  function showOrder(order?: string, calculation?: string) {
    if (!selected) return;
    setParams({ ...(order ? { order } : {}), ...(calculation ? { calculation } : {}) }, { replace: true });
  }
  function showBalanceOrder(id: string, business?: ServiceBusinessType) {
    if (business) setParams({ business, serviceOrder: id });
    else showOrder(id);
  }

  return <Flex vertical gap="middle">
    <Typography.Title level={4} style={{ margin: 0 }}>结算核对</Typography.Title>
    {loadFailed ? <Alert type="error" showIcon title="俱乐部加载失败" action={<Button onClick={reload}>重试</Button>} />
      : club === undefined ? <Spin aria-label="加载俱乐部" />
      : !selected && !mayPay ? <Empty description="当前账号未获财务查看或提现实付登记权限" /> : <>
        <Typography.Text strong>{club?.name}</Typography.Text>
        {mayPay ? <WithdrawalPayments onSaved={refreshBalance} /> : null}
        {selected ? <>
          <ClubBalanceCard key={balanceRevision} onOpen={showBalanceOrder} />
          <nav aria-label="财务业务类型" className="service-business-switch">
            <Button type={!business ? "primary" : "default"} onClick={() => setParams({})}>送心</Button>
            <Button type={business === "daily_run" ? "primary" : "default"} onClick={() => setParams({ business: "daily_run" })}>代跑</Button>
            <Button type={business === "companionship" ? "primary" : "default"} onClick={() => setParams({ business: "companionship" })}>陪玩</Button>
          </nav>
          {business ? <ServiceOrders key={`${userId}:${business}`} app="admin" userId={userId} token={token} business={business} scope="finance" orderId={params.get("serviceOrder")} onOpen={id => setParams({ business, ...(id ? { serviceOrder: id } : {}) })} /> : <SettlementList onOpen={showOrder} />}
        </> : null}
        {selected && !business ? <Drawer title="订单结算核算" open={!!orderId} onClose={() => showOrder()} size={md ? 760 : "100%"} destroyOnHidden>
          {orderId ? <SettlementDetail key={`${orderId}/${calculationId ?? ""}`}
            orderId={orderId} calculationId={calculationId} compact={!md}
            onChange={id => showOrder(orderId, id)} /> : null}
        </Drawer> : null}
      </>}
  </Flex>;
}

function SettlementList({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<(SettlementOrderRow | GiftSettlementRow)[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [next, setNext] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getSettlements(cursor).then(result => {
      if (!active) return;
      setRows(result.items);
      setNext(result.nextCursor);
    }).catch(reason => {
      if (active) setError(requestError(reason));
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [cursor, attempt]);

  function loadPage(after?: string) {
    setPending(true);
    setError("");
    setCursor(after);
    setAttempt(value => value + 1);
  }

  return <Flex vertical gap="small">
    <Button style={{ alignSelf: "flex-end" }} onClick={() => loadPage(cursor)} loading={pending}>刷新列表</Button>
    {error ? <Alert type="error" showIcon title={error} /> :
      <Table<SettlementOrderRow | GiftSettlementRow> rowKey="orderId" size="small" dataSource={rows} loading={pending}
        pagination={false} locale={{ emptyText: "暂无结算订单" }} columns={[
          { title: "订单", render: (_, row) => <Flex vertical>
            <Typography.Text strong>{sources[row.source]} · {"priceUnit" in row ? `${row.agreedGiftTimes} 次` : `${row.fulfillmentHearts ?? row.requestedHearts} 颗`}</Typography.Text>
            <Typography.Text type="secondary" style={{ overflowWrap: "anywhere" }}>{row.orderId}</Typography.Text>
          </Flex> },
          { title: "派发时间", responsive: ["md"], render: (_, row) => date(row.publishedAt) },
          { title: "结算状态", render: (_, row) => "priceUnit" in row ? giftSettlementStatusLabel[row.status]
            : row.finalCalculation ? "曾生成" : "待核对" },
          { title: "操作", width: 80, render: (_, row) => <Button size="small" onClick={() => onOpen(row.orderId)}>核对</Button> },
        ]} />}
    {cursor || next ? <Flex gap="small">
      <Button disabled={pending || !cursor} onClick={() => loadPage()}>返回首页</Button>
      <Button disabled={pending || !next} onClick={() => loadPage(next ?? undefined)}>下一页</Button>
    </Flex> : null}
  </Flex>;
}

function SettlementDetail({ orderId, calculationId, compact, onChange }: {
  orderId: string; calculationId?: string; compact: boolean; onChange: (id?: string) => void;
}) {
  const [data, setData] = useState<AdminSettlement | AdminGiftSettlement>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    getSettlement(orderId, calculationId).then(result => {
      if (!active) return;
      if (result) setData(result);
      else setError("没有返回结算数据");
    }).catch(reason => { if (active) setError(requestError(reason)); });
    return () => { active = false; };
  }, [orderId, calculationId, attempt]);
  const refresh = () => { setData(undefined); setError(""); setAttempt(value => value + 1); };
  if (error) return <Alert type="error" showIcon title={error} action={<Button onClick={refresh}>重试</Button>} />;
  if (!data) return <Spin aria-label="加载结算核算" />;
  if ("priceUnit" in data) return <GiftSettlementDetail data={data} history={!!calculationId}
    compact={compact} onChange={onChange} refresh={refresh} />;

  const { pricing, receipt, totals, planned, activity, termination, priceAdjustment, priceAdjustmentHistory, finalCalculation, previousCalculation: previous } = data;
  const adjustments = [...(priceAdjustmentHistory ?? []), ...(priceAdjustment ? [priceAdjustment] : [])];
  const gift = activity?.kind === "buy_and_gift" ? activity : undefined;
  const discount = activity?.kind === "discount" ? activity : undefined;
  const unit = pricing ? commissionUnit(pricing.basis) : undefined;
  const columns = compact ? 1 : 2;
  const name = (id: string) => data.memberNames[id] ? `${data.memberNames[id]} · ${id}` : id;
  return <Flex vertical gap="middle">
    <Flex wrap align="center" justify="space-between" gap="small">
      <div><Tag color={finalCalculation ? "green" : "blue"}>
        {calculationId ? "历史计算单" : finalCalculation ? "最终计算已生成" : termination ? "停送后核算" : "预计核算"}
      </Tag>{finalCalculation ? calculationId ? <Tag>按历史依据核对</Tag> : <>
        <Tag>业务复核待确认</Tag><Tag>未入账</Tag>
      </> : null}</div>
      <Button onClick={() => calculationId ? onChange() : refresh()}>{calculationId ? "查看当前核算" : "刷新核算"}</Button>
    </Flex>
    {data.issues.length ? <Alert type={data.issues.some(issue => issue !== "incomplete") ? "warning" : "info"} showIcon title="核对事项"
      description={<ul style={{ marginBlock: 4, paddingLeft: 20 }}>{data.issues.map(issue => <li key={issue}>{settlementIssueLabel[issue]}</li>)}</ul>} /> : null}
    {previous ? <Alert type={finalCalculation ? "info" : "warning"} showIcon title={finalCalculation ? "还有早期计算记录" : "当前核算有待确认事项"}
      action={<Button onClick={() => onChange(previous.id)}>查阅历史计算单</Button>} /> : null}
    <Descriptions size="small" column={columns} bordered items={[
      { key: "order", label: "订单", children: <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{data.orderId}</Typography.Text> },
      { key: "source", label: "来源", children: sources[data.source] },
      { key: "delivery", label: "原约定交付 / 有效日报实到", children: `${data.fulfillmentHearts ?? data.requestedHearts} / ${data.observedHearts} 颗` },
      ...(data.giftHearts ? [{ key: "gift", label: "付费 / 赠心", children: `${data.requestedHearts} / ${data.giftHearts} 颗` }] : []),
      { key: "unclaimed", label: termination ? "停止领取时原未承接" : "未承接", children: `${data.originallyUnclaimedHearts ?? data.unclaimedHearts} 颗` },
      { key: "pricing", label: "原报价与抽成规则", children: pricing ? `报价 V${pricing.revision} · 规则 V${pricing.version} · ${commissionBasisLabel[pricing.basis]}` : "待核对" },
      { key: "rates", label: "派抽 / 团抽", children: pricing
        ? <span><Money cents={pricing.dispatchFeeCents} unit={unit} /> / <Money cents={pricing.clubFeeCents} unit={unit} /></span> : "待核对" },
      { key: "receipt", label: "登记实收", children: receipt
        ? <span><Money cents={receipt.receivedAmountCents} /> · 收款人 {name(receipt.receivedByUserId)}</span> : "待核对" },
      { key: "receivedAt", label: "收款时间", children: date(receipt?.receivedAt ?? null) },
      ...(discount ? [
        { key: "discountPrice", label: "折前 / 折后爱心款", children: <span><Money cents={receipt?.quote.originalHeartsAmountCents} /> / <Money cents={receipt?.quote.heartsAmountCents} /></span> },
        { key: "discount", label: "折扣差额", children: <span><Money cents={discount.discountCents} /> · 承担方待确认</span> },
      ] : []),
      ...(finalCalculation ? [
        { key: "calculation", label: "计算单编号", children: <Typography.Text copyable style={{ overflowWrap: "anywhere" }}>{finalCalculation.id}</Typography.Text> },
        { key: "calculatedAt", label: "生成时间", children: `V${finalCalculation.version} · ${date(finalCalculation.calculatedAt)}` },
      ] : []),
    ]} />
    {termination ? <TerminationFacts stop={termination} columns={columns} name={name} /> : null}
    {adjustments.map(change => <AdjustmentFacts key={change.id} change={change} columns={columns} name={name}
      stopped={!!termination && change.id === priceAdjustment?.id} />)}
    {data.priceAdjustmentReviews?.map(review => <Card key={review.id} title="待核价差" size="small">
      <Typography.Paragraph>{review.reason} · {name(review.submittedByUserId)} · {date(review.submittedAt)}</Typography.Paragraph>
      <Typography.Paragraph>实到 {review.observedHearts} 颗 · 剩余 {review.remainingHearts} 颗
        {review.proposal ? <> · 拟差额 <Money cents={review.proposal.differenceCents} /></> : null}
      </Typography.Paragraph>
    </Card>)}
    <Card size="small" title={discount ? "按折前单价试算的实绩" : "当前已明确的实绩核算"}>
      <Descriptions size="small" column={columns} items={[
        { key: "hearts", label: "扣抽前爱心金额", children: <Money cents={totals.grossCents} /> },
        { key: "dispatch", label: `派抽 · ${name(data.dispatcherUserId)}`, children: <Money cents={totals.dispatchFeeCents} /> },
        { key: "club", label: "团抽收入", children: <Money cents={totals.clubFeeCents} /> },
        ...(gift ? [
          { key: "giftExpense", label: "团费赠心支出", children: <span><Money cents={gift.giftExpenseCents === null ? null : -gift.giftExpenseCents} />{gift.observedGiftHearts === null ? "" : ` · ${gift.observedGiftHearts} 颗`}</span> },
          { key: "clubNet", label: "团费净变动", children: <Money cents={gift.clubNetCents} /> },
        ] : []),
        { key: "reward", label: "送心报酬", children: <Money cents={totals.rewardCents} /> },
        { key: "total", label: "已明确分配合计", children: <Money cents={totals.allocatedCents} /> },
        { key: "difference", label: priceAdjustment || termination ? "净实收减已明确分配" : "实收减已明确分配", children: <Money cents={totals.differenceCents} /> },
      ]} />
      <Flex vertical gap="small">
        {data.members.map(member => <Card key={member.userId} size="small" title={`${name(member.userId)} · 承接 ${member.claimedHearts} 颗`}>
          <Descriptions size="small" column={columns} items={[
            { key: "reward", label: "送心报酬", children: <Money cents={member.rewardCents} /> },
            { key: "total", label: discount ? "折前实绩小计" : member.issues.length ? "可核算实绩小计" : "已明确实绩合计", children: <Money cents={member.knownSubtotalCents} /> },
            ...(member.issues.length ? [{ key: "unknown", label: "本人应得合计", children: <Money cents={member.totalCents} /> }] : []),
            ...(termination ? [] : [{ key: "estimated", label: discount ? "按承接量如期完单的折前送心报酬" : "按承接量如期完单的预计送心报酬", children: <Money cents={member.plannedRewardCents} /> }]),
          ]} />
          {member.segments.map(segment => <Typography.Paragraph style={{ marginBottom: 4 }} key={segment.number}>
            {adjustments.some(change => change.supplement && change.continuationSegment === segment.number) ? "商定续送" : "原报价"}第 {segment.number} 段 · 到账 {segment.receivedHearts} 颗 / 赠送 {segment.giftTimes} 次 · <Money cents={segment.grossCents} /> 扣派抽 <Money cents={segment.dispatchFeeCents} />、团抽 <Money cents={segment.clubFeeCents} /> · 报酬 <Money cents={segment.rewardCents} />
          </Typography.Paragraph>)}
        </Card>)}
      </Flex>
    </Card>
    {!finalCalculation && !termination ? <Card size="small" title={adjustments.some(change => !!change.supplement) ? "按当前已生效计价估算完单报酬" : "按发布条件如期完单的预计"}>
      <Descriptions size="small" column={columns} items={[
        { key: "gross", label: "预计履约扣抽前爱心金额", children: <Money cents={planned.grossCents} /> },
        { key: "dispatch", label: "预计派抽", children: <Money cents={planned.dispatchFeeCents} /> },
        { key: "club", label: "预计团抽", children: <Money cents={planned.clubFeeCents} /> },
        ...(gift ? [{ key: "plannedGiftExpense", label: "足量履约的预计赠心支出", children: <Money cents={-gift.plannedGiftExpenseCents} /> }] : []),
        { key: "reward", label: "预计送心报酬", children: <Money cents={planned.rewardCents} /> },
      ]} />
      <Typography.Text type="secondary">个人分段份额缺少依据时按实际履约核算。</Typography.Text>
    </Card> : null}
    <Collapse items={[
      { key: "quote", label: "派发报价段", children: pricing?.segments.map((segment, index) =>
        <Typography.Paragraph key={index}>第 {index + 1} 段 · {periods[segment.period]} · 付费 {segment.hearts} 颗 × <Money cents={segment.unitPriceCents} unit="颗" /> = <Money cents={segment.hearts * segment.unitPriceCents} />{segment.giftHearts ? ` · 赠心 ${segment.giftHearts} 颗` : ""}</Typography.Paragraph>) },
      { key: "reports", label: `日报依据（${data.reports.length}）`, children: <Table rowKey="id" size="small"
        dataSource={data.reports} pagination={{ pageSize: 10 }} columns={[
          { title: "日报", render: (_, report) => <Flex vertical>
            <span>{report.businessDate} · {name(report.userId)} · {kinds[report.kind]} V{report.version}</span>
            <Typography.Text style={{ overflowWrap: "anywhere" }}>{report.accountName} · {report.accountId}</Typography.Text>
            {report.lines.map((line, index) => <Typography.Text key={index}>
              {periods[line.period]} · {line.quoteSegment ? `第 ${line.quoteSegment} 段` : "报价段待核对"} · 赠送 {line.giftTimes} 次 / 到账 {line.receivedHearts} 颗
              {line.issues.length ? ` · ${line.issues.map(issue => settlementIssueLabel[issue]).join("、")}` : ""}
            </Typography.Text>)}
            {report.reason ? <Typography.Text type="secondary">{report.reason}</Typography.Text> : null}
            <Typography.Text copyable type="secondary" style={{ overflowWrap: "anywhere" }}>{report.id}</Typography.Text>
          </Flex> },
        ]} /> },
    ]} />
  </Flex>;
}

function TerminationFacts({ stop, columns, name }: { stop: DispatchTermination; columns: number; name: (userId: string) => string }) {
  return <Card size="small" title="停送与退款">
    <Descriptions size="small" column={columns} items={[
      { key: "stop", label: "停止交付", children: `${stop.stoppedHearts} 颗 · ${date(stop.stoppedAt)}` },
      ...(stop.reason ? [{ key: "reason", label: "停送说明", children: stop.reason }] : []),
      ...(stop.change ? [{ key: "change", label: "变更登记", children: `${stop.change.reason} · ${name(stop.change.recordedByUserId)} · ${date(stop.change.recordedAt)}` },
        { key: "terms", label: "本单退款约定", children: `${stop.change.heartRule === "original_paid" ? "未送付费心按原付款核算" : "心款退法待核"} · ${stop.change.customerConfirmedAt ? `客户确认于 ${date(stop.change.customerConfirmedAt)}` : "客户确认待登记"}` }] : []),
      ...(stop.customerRequestReference ? [{ key: "request", label: "线下客户请求依据", children: stop.customerRequestReference }] : []),
      ...(stop.priorPostingReference ? [{ key: "posting", label: "已有入账待核依据", children: `${stop.priorPostingReference} · ${stop.priorPostingReason}` }] : []),
      { key: "original", label: "原实收", children: <Money cents={stop.originalReceivedCents} /> },
      { key: "supplement", label: "实际补款", children: <Money cents={stop.supplementReceivedCents} /> },
      { key: "unfulfilled", label: "原付未送心款", children: <Money cents={stop.originalUnfulfilledCents} /> },
      ...(stop.supplementUnfulfilledCents ? [{ key: "unusedSupplement", label: "未履约补款", children: <Money cents={stop.supplementUnfulfilledCents} /> }] : []),
      { key: "due", label: "可核对应退", children: <Money cents={stop.refundDueCents} /> },
      { key: "refunded", label: "实际已退", children: <Money cents={stop.refundedCents} /> },
      { key: "remaining", label: "上述应退尚待退", children: <Money cents={stop.refundRemainingCents} /> },
      { key: "net", label: "净实收", children: <Money cents={stop.netReceivedCents} /> },
    ]} />
    {stop.review.length ? <Alert type="warning" showIcon title="仍待核对"
      description={<ul style={{ marginBlock: 4, paddingLeft: 20 }}>{stop.review.map(issue => <li key={issue}>{terminationReviewLabel[issue]}</li>)}</ul>} /> : null}
    <Collapse items={[
      { key: "segments", label: "停送时的原计价段及实绩", children: stop.segments.map(row => <Typography.Paragraph key={row.number}>
        第 {row.number} 段 · {periods[row.period]} · 已到 {row.observedHearts} 颗 · 原未履约 {row.unfulfilledHearts} 颗 · 原付 <Money cents={row.originalUnitPriceCents} unit="颗" />
        {row.effectiveUnitPriceCents !== row.originalUnitPriceCents ? <> · 改价后 <Money cents={row.effectiveUnitPriceCents} unit="颗" /></> : null}
      </Typography.Paragraph>) },
      { key: "refunds", label: `实际退款记录（${stop.refunds.length} 笔）`, children: stop.refunds.map(refund => <Typography.Paragraph key={refund.id}>
        <Money cents={refund.amountCents} /> · 退款时间 {date(refund.occurredAt)} · {name(refund.recordedByUserId)} 登记于 {date(refund.recordedAt)} · <Typography.Text copyable>{refund.id}</Typography.Text>
      </Typography.Paragraph>) },
    ]} />
  </Card>;
}

function AdjustmentFacts({ change, columns, name, stopped }: { change: PriceAdjustment; columns: number; name: (userId: string) => string; stopped: boolean }) {
  const { decision, supplement, refund, shift } = change;
  return <Card size="small" title="跨期改价及实际收退款">
    <Descriptions size="small" column={columns} items={[
      { key: "state", label: "状态", children: stopped ? "本单已停送，保留原改价记录" : priceAdjustmentStateLabel[change.state] },
      { key: "reason", label: "原因", children: change.reason },
      { key: "request", label: "派单人提交", children: `${name(change.submittedByUserId)} · ${date(change.submittedAt)}` },
      { key: "decision", label: "客户答复", children: decision ? `${decision.value === "accept" ? "同意" : "拒绝"} · ${decision.userId} · ${date(decision.recordedAt)}` : "待答复" },
      { key: "shift", label: `拟从第 ${shift.quoteSegment} 段跨期 ${shift.hearts} 颗`, children: <>{periods[change.originalPeriod]} <Money cents={change.originalUnitPriceCents} unit="颗" /> → {periods[shift.targetPeriod]} <Money cents={shift.targetUnitPriceCents} unit="颗" /></> },
      { key: "supplement", label: "拟补差 / 实补", children: <><Money cents={change.differenceCents} /> / <Money cents={supplement?.amountCents ?? 0} /></> },
      ...(supplement ? [{ key: "received", label: "补款时间 / 登记人", children: `${date(supplement.occurredAt)} · ${name(supplement.recordedByUserId)}` }] : []),
      ...(!stopped && decision?.value === "decline" ? [
        { key: "refund", label: "未送心款应退 / 实退", children: <><Money cents={change.refundDueCents} /> / <Money cents={refund?.amountCents ?? 0} /></> },
        ...(refund ? [{ key: "refundAt", label: "实际退款时间 / 登记人", children: `${date(refund.occurredAt)} · ${name(refund.recordedByUserId)}` }] : []),
      ] : []),
      ...(!stopped ? [{ key: "net", label: "净实收", children: <Money cents={change.netReceivedCents} /> }] : []),
    ]} />
  </Card>;
}
