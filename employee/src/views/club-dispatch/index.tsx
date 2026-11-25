import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Form, Input, Select, Spin, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useSearchParams } from "react-router";
import { RequestError, useAuthSession } from "@sky-club/common/web-auth";
import {
  commissionBasisLabel, commissionUnit, deliveryPeriodPreferenceLabel, formatCentsAsYuan, parseYuanAsCents, paymentStatusLabel, quoteHeartCounts,
  type CommissionReview, type CommissionRule, type CustomerQuote, type DeliveryPeriodPreference, type DispatchPricing, type OrderPricing,
  type OrderReceipt, type PaymentStatus, type PendingQuoteActivity,
} from "@sky-club/common";
import Header from "#/components/Header";
import type { EmployeeClub } from "../club-operations";
import { employeeRequest } from "#/service/request";
import PersonalSettlementCard from "../club-assignments/personal-settlement";
import GiftSettlementCard from "../club-assignments/gift-settlement";
import OrderAdjustments from "../club-financial/order-adjustments";
import { FulfillmentQueue, OrderFulfillment } from "./fulfillment";
import NewDirectDraft from "./new-direct-draft";
import CustomerActivation from "./customer-activation";
import GiftDispatchPricing from "./gift-dispatch-pricing";
import { GiftSupervisionCard } from "./gift-supervision";
import PendingAssignment from "./pending-assignment";
import MemberInvitation from "./member-invitation";
import { ClientOrderNoticeList, useClientOrderNotices } from "#/components/Header/ClientOrderNotices";
import { useDispatchNotificationTarget } from "./dispatch-notification-target";
import PublishDispatch, { AllocationResult, type DispatchAllocation } from "./publish-dispatch";

import { useWorkspaceScroll } from "../workspace-scroll";

const orderIdPattern = /^[a-f0-9]{24}$/i;

export type Order = {
  id: string;
  source: keyof typeof sources;
  dispatchStatus: keyof typeof statuses;
  recipientGameAccount: string;
  customerUserId?: string | null;
  customerLinkStatus?: "verified" | "pending_verification";
  customerActivationAvailable?: boolean;
  fulfillmentHearts?: number;
  deliveryPeriodPreference?: DeliveryPeriodPreference;
  doubleGiftTimes?: number;
  stoppedAt?: string;
} & (
  | { requestedHearts: number; requestedGiftTimes?: never; estimatedReceivedHearts?: never }
  | { requestedHearts?: never; requestedGiftTimes: number; estimatedReceivedHearts?: number }
);
type HistoricalOrder = Extract<Order, { requestedHearts: number }>;
type Preparation = {
  rule: CommissionRule | null;
  pricing: OrderPricing | null;
  dispatchPricing: DispatchPricing | null;
  dispatchStatus: Order["dispatchStatus"];
  quote: CustomerQuote | null;
  pendingActivity?: PendingQuoteActivity;
  receipt: OrderReceipt | null;
  paymentStatus: PaymentStatus;
  commissionReview: CommissionReview | null;
  allocation?: DispatchAllocation;
};
type ReceiptResult = { receipt: OrderReceipt; paymentStatus: PaymentStatus };
type Page = { items: Order[]; nextCursor: string | null };

const statuses = { draft: "直接派单草稿", pending: "待派发", published: "已派发" };
const sources = { direct_dispatch: "直接派单", client_order: "客户端下单" };
const periods = { normal: "普通期", double: "双倍期" };

function requestError(err: unknown) {
  return err instanceof RequestError ? err.message : "请求失败，请检查网络连接后重试";
}

export default function ClubDispatch() {
  const notification = useDispatchNotificationTarget();
  const clientOrders = useClientOrderNotices(true);
  const { id, token } = useAuthSession();
  const [params] = useSearchParams();
  const context = JSON.stringify([id, "dispatch", params.get("after"), params.get("orderId"), params.get("through")]);
  const [readyContext, setReadyContext] = useState<string>();
  const scroll = useWorkspaceScroll(context, readyContext === context);
  const [club, setClub] = useState<EmployeeClub | null>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<EmployeeClub | null>("club", "GET", undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setClub(data);
    }).catch(err => {
      if (!controller.signal.aborted) setError(requestError(err));
    });
    return () => controller.abort();
  }, [attempt, token]);

  return <>
    <Header />
    <main className="club-claim-page" {...scroll}>
      <Flex vertical gap="middle" style={{ maxWidth: 820, marginInline: "auto" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>派单准备</Typography.Title>
        {notification.error ? <Alert type="error" showIcon title={notification.error}
          action={<Button onClick={notification.retry}>重试</Button>} /> : null}
        {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
          : club === undefined ? <Spin aria-label="加载俱乐部" />
          : club ? <>
            <Flex align="center" wrap gap="middle">
              <Typography.Text strong>{club.name}</Typography.Text>
              <Typography.Text copyable={{ text: club.orderUrl, tooltips: ["复制客户端下单链接", "已复制"] }}>
                <Typography.Link href={club.orderUrl} target="_blank" rel="noopener noreferrer">客户端下单链接</Typography.Link>
              </Typography.Text>
            </Flex>
            <MemberInvitation />
            <details>
              <summary>待接待的客户端订单</summary>
              <ClientOrderNoticeList {...clientOrders} />
            </details>
            {notification.loading ? <Spin aria-label="定位客户端订单" />
              : <ClubOrders key={id} canAssign={club.canAssignPendingOrders} onReady={() => setReadyContext(context)} />}
          </> : <Empty description="当前账号尚无有效团员身份" />}
      </Flex>
    </main>
  </>;
}

function ClubOrders({ canAssign, onReady }: { canAssign?: boolean; onReady: () => void }) {
  const route = "club/orders";
  const [params, setParams] = useSearchParams();
  const readId = (name: string) => {
    const value = params.get(name);
    return value && orderIdPattern.test(value) ? value : undefined;
  };
  const after = readId("after");
  const selectedId = readId("orderId");
  const rawDate = params.get("through");
  const through = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;
  const [loadedPage, setPage] = useState<Page>();
  const [loadedAfter, setLoadedAfter] = useState<string | null>();
  const page = loadedAfter === (after ?? null) ? loadedPage : undefined;
  const [exceptionOrder, setExceptionOrder] = useState<Order>();
  const [fulfillmentRevision, setFulfillmentRevision] = useState(0);
  const [settledOrderId, setSettledOrderId] = useState<string>();
  const fulfillmentPanel = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [linkedOrder, setLinkedOrder] = useState<Order>();
  const [linkError, setLinkError] = useState("");
  const pageOrder = page?.items.find(value => value.id === selectedId);
  const order = selectedId ? pageOrder ?? (exceptionOrder?.id === selectedId ? exceptionOrder : undefined)
    ?? (linkedOrder?.id === selectedId ? linkedOrder : undefined) : page?.items[0];
  const linkedId = selectedId && !pageOrder ? selectedId : undefined;

  useEffect(() => {
    if (!linkedId) return;
    setLinkError("");
    const controller = new AbortController();
    employeeRequest<Order>(`${route}/${encodeURIComponent(linkedId)}`, "GET", undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) setLinkedOrder(value);
    }).catch(err => {
      if (!controller.signal.aborted) setLinkError(requestError(err));
    });
    return () => controller.abort();
  }, [linkedId, route, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    const query = new URLSearchParams({ responsibility: "dispatcher" });
    if (after) query.set("after", after);
    employeeRequest<Page>(`${route}?${query}`, "GET", undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) { setPage(data); setLoadedAfter(after ?? null); }
    }).catch(err => {
      if (!controller.signal.aborted) setError(requestError(err));
    });
    return () => controller.abort();
  }, [route, after, attempt]);

  function setContext(changes: { after?: string; orderId?: string; through?: string }) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      for (const [name, value] of Object.entries(changes)) {
        if (value === undefined) next.delete(name);
        else next.set(name, value);
      }
      return next;
    });
  }

  function selectOrder(id: string) {
    setContext({ orderId: id });
  }

  function goTo(cursor?: string) {
    setPage(undefined);
    setExceptionOrder(undefined);
    setContext({ after: cursor, orderId: undefined });
  }

  function setThrough(date?: string) {
    setContext({ through: date });
  }

  function refreshFulfillment() {
    setFulfillmentRevision(value => value + 1);
  }

  function openException(selected: Order) {
    selectOrder(selected.id);
    setExceptionOrder(selected);
    requestAnimationFrame(() => {
      fulfillmentPanel.current?.focus({ preventScroll: true });
      fulfillmentPanel.current?.scrollIntoView({ block: "start" });
    });
  }

  useEffect(() => {
    if (page && (!selectedId || order || linkError)) onReady();
  }, [page, selectedId, order, linkError, onReady]);

  return <>
    {canAssign ? <PendingAssignment onAssigned={id => {
      setContext({ orderId: id, after: undefined });
      setAttempt(value => value + 1);
    }} /> : null}
    <FulfillmentQueue route={route} through={through} revision={fulfillmentRevision} onOpen={openException}
      onCheck={date => { setThrough(date); refreshFulfillment(); }} onRefresh={refreshFulfillment} />
    <Card size="small" title="我负责派发的订单" extra={<Button onClick={() => setCreating(true)}>新建直接派单草稿</Button>}>
      {linkError && selectedId === linkedId && <Alert type="error" showIcon title={linkError}
        action={<Button onClick={() => { setLinkError(""); setAttempt(value => value + 1); }}>重试</Button>} />}
      {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
        : page ? page.items.length ? <Select aria-label="我负责派发的订单" style={{ width: "100%" }}
          value={page.items.some(item => item.id === order?.id) ? order?.id : undefined}
          placeholder="选择本页订单" onChange={id => { setExceptionOrder(undefined); selectOrder(id); }}
          optionRender={({ data }) => <Flex vertical>
            <span style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{data.label}</span>
            <code className="club-order-number">{data.value}</code>
          </Flex>}
          options={page.items.map(value => ({ value: value.id, label: `${value.recipientGameAccount} · ${value.requestedGiftTimes === undefined ? `${value.fulfillmentHearts ?? value.requestedHearts} 颗` : `${value.requestedGiftTimes} 次`} · ${sources[value.source]} · ${value.stoppedAt ? "已停送" : statuses[value.dispatchStatus]}` }))} />
          : <Empty description="本页没有你负责派发的订单" />
        : <Spin aria-label="加载订单" />}
      {page?.nextCursor || after ? <Flex gap="small" style={{ marginTop: 8 }}>
        <Button disabled={!page || !after} onClick={() => goTo()}>返回首页</Button>
        <Button disabled={!page?.nextCursor} onClick={() => goTo(page?.nextCursor ?? undefined)}>下一页</Button>
      </Flex> : null}
    </Card>
    {order && (!error || exceptionOrder) ? <>
      {order.source === "direct_dispatch" && order.customerLinkStatus ? <Typography.Text>
        {order.customerLinkStatus === "verified" ? `老板 · ${order.customerUserId}` : "老板归属待核"}
      </Typography.Text> : null}
      {order.customerActivationAvailable && <CustomerActivation key={order.id} route={`${route}/${order.id}`} />}
      {order.requestedGiftTimes !== undefined ? <>
      {order.dispatchStatus === "published" && <div ref={fulfillmentPanel} tabIndex={-1}>
        <GiftSupervisionCard key={order.id} route={`${route}/${order.id}`} through={through}
          revision={fulfillmentRevision} onRefresh={refreshFulfillment} onShowCurrent={() => setThrough(undefined)} />
      </div>}
      {order.dispatchStatus === "published" ?
        <GiftSettlementCard key={`settlement:${order.id}`} route={`${route}/${order.id}`} revision={fulfillmentRevision} role="dispatcher"
          showTerminationEvidence={false} onClosed={() => { setSettledOrderId(order.id); refreshFulfillment(); }} /> : null}
      {order.dispatchStatus === "published" ? <OrderAdjustments key={`adjustments:${order.id}`} orderRoute={`${route}/${order.id}`}
        onChanged={refreshFulfillment} settlementClosed={settledOrderId === order.id} /> : null}
      <GiftDispatchPricing key={`pricing:${order.id}`} route={`${route}/${order.id}`} order={order} onFulfillmentChanged={refreshFulfillment}
        settlementClosed={settledOrderId === order.id}
        onPublished={() => {
          setLinkedOrder(previous => previous?.id === order.id ? { ...previous, dispatchStatus: "published" } : previous);
          setPage(previous => previous && {
            ...previous, items: previous.items.map(item => item.id === order.id ? { ...item, dispatchStatus: "published" } : item),
          });
        }} /></> : <>
      <div ref={fulfillmentPanel} tabIndex={-1}>
        <OrderFulfillment key={order.id} route={`${route}/${order.id}`} order={order} through={through}
          revision={fulfillmentRevision} onRefresh={refreshFulfillment} onShowCurrent={() => setThrough(undefined)} />
      </div>
      {order.dispatchStatus === "published" ?
        <PersonalSettlementCard key={order.id} route={`${route}/${order.id}`} revision={fulfillmentRevision} role="dispatcher" /> : null}
      <OrderPricingForm key={order.id} route={`${route}/${order.id}`} order={order}
        onPublished={fulfillmentHearts => {
          setPage(previous => previous && {
            ...previous,
            items: previous.items.map(item => item.id === order.id ? { ...item, fulfillmentHearts, dispatchStatus: "published" } : item),
          });
          refreshFulfillment();
        }} />
      </>}
    </> : null}
    {creating ? <NewDirectDraft onClose={() => setCreating(false)} onCreated={id => {
      setCreating(false);
      setExceptionOrder(undefined);
      setContext({ orderId: id, after: undefined });
      setAttempt(value => value + 1);
    }} /> : null}
  </>;
}

function OrderPricingForm({ route, order, onPublished }: { route: string; order: HistoricalOrder; onPublished: (fulfillmentHearts: number) => void }) {
  const [preparation, setPreparation] = useState<Preparation>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const rule = preparation?.rule;
  const pricing = preparation?.pricing;
  const receipt = preparation?.receipt;
  const quote = preparation?.quote;
  const fulfillmentHearts = (quote && quoteHeartCounts(quote.segments)?.fulfillmentHearts) ?? order.fulfillmentHearts ?? order.requestedHearts;
  const effectiveCommission = preparation?.commissionReview ?? pricing;
  const canPublish = preparation?.paymentStatus === "paid_in_full" && !!effectiveCommission &&
    !!rule && effectiveCommission.basis === rule.basis;

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<Preparation>(`${route}/pricing`, "GET", undefined, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setPreparation(data);
    }).catch(err => {
      if (!controller.signal.aborted) setError(requestError(err));
    });
    return () => controller.abort();
  }, [route, attempt]);

  function reload() {
    setPreparation(undefined);
    setAttempt(value => value + 1);
  }

  return <Card title="订单报价" extra={<Tag>{preparation?.allocation?.stoppedAt || order.stoppedAt ? "已停送" : statuses[preparation?.dispatchStatus ?? order.dispatchStatus]}</Tag>}>
    <Typography.Paragraph className="club-order-number">订单号 {order.id}</Typography.Paragraph>
    <Typography.Paragraph>{sources[order.source]} · {order.recipientGameAccount} · 原订购 {order.requestedHearts} 颗</Typography.Paragraph>
    {order.deliveryPeriodPreference ? <Typography.Paragraph>
      客户期望时段 · {deliveryPeriodPreferenceLabel[order.deliveryPeriodPreference]}
    </Typography.Paragraph> : null}
    {error ? <Alert type="error" showIcon title={error} action={<Button onClick={reload}>重试</Button>} /> : null}
    {!preparation && !error ? <Spin aria-label="加载订单报价" /> : null}
    {preparation?.dispatchStatus === "published" ? <PublishedPricing pricing={preparation.dispatchPricing} showSegments={!quote} /> : null}
    {preparation?.allocation ? <AllocationResult allocation={preparation.allocation} onReload={() => setAttempt(value => value + 1)} /> : null}
    {preparation && preparation.dispatchStatus !== "published" && !rule ? <Alert type="warning" showIcon title="俱乐部尚未配置抽成规则"
      action={<Button onClick={reload}>重新加载</Button>} /> : null}
    {preparation && preparation.dispatchStatus !== "published" && !pricing ? <Alert type="info" showIcon title="历史订购数量按原单位保留" /> : null}
    {pricing ? <Typography.Paragraph>
      原派抽 ¥{formatCentsAsYuan(pricing.dispatchFeeCents)}/{commissionUnit(pricing.basis)}
    </Typography.Paragraph> : null}
    {pricing && !quote ? <ul>{pricing.segments.map((segment, index) => <li key={index}>{periods[segment.period]} · {segment.hearts} 颗 · ¥{formatCentsAsYuan(segment.unitPriceCents)}/颗</li>)}</ul> : null}
    {quote ? <QuoteDetails quote={quote} /> : null}
    {preparation?.pendingActivity ? <Alert type="warning" showIcon title="买赠与折扣叠加规则待核对"
      description={`拟议折后爱心款 ¥${formatCentsAsYuan(preparation.pendingActivity.proposedDiscountedHeartsAmountCents)}。确认活动规则后才可登记实收和派发。`}
      style={{ marginTop: 16 }} /> : null}
    {quote?.totalAmountCents === 0 && !receipt ? <Alert type="info" showIcon title="免单确认与派发流程待确认" style={{ marginTop: 16 }} /> : null}
    {preparation && quote && quote.totalAmountCents > 0 && !receipt && preparation.dispatchStatus !== "published" ? <ReceiptForm key={quote.revision}
      quote={quote} route={`${route}/receipts`}
      onRecorded={result => setPreparation(current => current && { ...current, ...result })} onReload={reload} /> : null}
    {receipt && preparation ? <>
      <Alert type={preparation.paymentStatus === "paid_in_full" ? "success" : "warning"} showIcon
        title={paymentStatusLabel[preparation.paymentStatus]} style={{ marginTop: 16 }}
        description={<>
          <div>实收金额 ¥{formatCentsAsYuan(receipt.receivedAmountCents)} · 收款时间 {dayjs(receipt.receivedAt).format("YYYY-MM-DD HH:mm")}</div>
          <div>收款人 {receipt.receivedByUserId} · 经办人 {receipt.recordedByUserId} · 登记时间 {dayjs(receipt.recordedAt).format("YYYY-MM-DD HH:mm")}</div>
          <div style={{ overflowWrap: "anywhere" }}>登记编号 {receipt.requestId}</div>
        </>} />
      {preparation.dispatchStatus !== "published" ? <section aria-label="正式派发" style={{ marginTop: 16 }}>
        <Button type="primary" disabled={!canPublish} onClick={() => setPublishing(true)}>正式派发</Button>
        {preparation.paymentStatus !== "paid_in_full" ? <Typography.Paragraph style={{ marginTop: 8 }}>
          请先核对实收差额。
        </Typography.Paragraph> : null}
      </section> : null}
    </> : null}
    {publishing && canPublish && rule && quote && receipt && effectiveCommission ? <PublishDispatch route={route} fulfillmentHearts={fulfillmentHearts}
      summary={`${sources[order.source]} · ${order.recipientGameAccount} · 交付 ${fulfillmentHearts} 颗`}
      receivedAmountCents={receipt.receivedAmountCents} quoteAmountCents={quote.totalAmountCents} pricingRevision={quote.revision}
      ruleVersion={rule.version} commissionReviewRevision={preparation?.commissionReview?.revision ?? 0}
      basis={rule.basis} dispatchFeeCents={effectiveCommission.dispatchFeeCents} clubFeeCents={rule.clubFeeCents}
      onClose={() => setPublishing(false)} onReload={() => { setPublishing(false); reload(); }}
      onPublished={(result, recipients) => {
        setPublishing(false);
        onPublished(fulfillmentHearts);
        const names = new Map(recipients.map(recipient => [recipient.userId, recipient.nickname]));
        setPreparation(previous => previous && {
          ...previous,
          pricing: null,
          rule: null,
          dispatchStatus: "published",
          dispatchPricing: result.dispatchPricing,
          allocation: {
            publicHearts: result.allocation.publicHearts,
            publicRemainingHearts: result.allocation.publicHearts,
            directedPendingHearts: fulfillmentHearts - result.allocation.publicHearts,
            claimedHearts: 0,
            directed: result.allocation.directed.map(share => ({
              ...share, nickname: names.get(share.userId) ?? null, accepted: false,
            })),
            shares: [],
          },
        });
        setAttempt(value => value + 1);
      }} /> : null}
  </Card>;
}

function QuoteDetails({ quote }: { quote: CustomerQuote }) {
  const counts = quoteHeartCounts(quote.segments);
  const original = quote.originalHeartsAmountCents;
  return <section aria-label="客户报价" style={{ marginTop: 16 }}>
    <Typography.Title level={5}>客户报价 V{quote.revision}</Typography.Title>
    <ul>{quote.segments.map((segment, index) => <li key={index}>{periods[segment.period]} · 付费 {segment.hearts} 颗 × ¥{formatCentsAsYuan(segment.unitPriceCents)}/颗 = ¥{formatCentsAsYuan(segment.hearts * segment.unitPriceCents)}{segment.giftHearts ? ` · 赠心 ${segment.giftHearts} 颗` : ""}</li>)}</ul>
    {counts?.giftHearts ? <div>付费 {counts.paidHearts} 颗 · 赠心 {counts.giftHearts} 颗 · 共交付 {counts.fulfillmentHearts} 颗</div> : null}
    {original === undefined ? <div>爱心款 ¥{formatCentsAsYuan(quote.heartsAmountCents)}</div> : <>
      <div>折前爱心款 ¥{formatCentsAsYuan(original)} · 折后爱心款 ¥{formatCentsAsYuan(quote.heartsAmountCents)}</div>
      <div>折扣差额 ¥{formatCentsAsYuan(original - quote.heartsAmountCents)} · 承担方待确认</div>
    </>}
    <Typography.Text strong>报价总额 ¥{formatCentsAsYuan(quote.totalAmountCents)}</Typography.Text>
  </section>;
}

function ReceiptForm({ quote, route, onRecorded, onReload }: {
  quote: CustomerQuote;
  route: string;
  onRecorded: (result: ReceiptResult) => void;
  onReload: () => void;
}) {
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const submitted = useRef<{ payload: string; id: string } | undefined>(undefined);

  async function record({ amount, time }: { amount: string; time: string }) {
    if (pending) return;
    const receivedAmountCents = parseYuanAsCents(amount);
    const localTime = new Date(time);
    if (receivedAmountCents === null || !Number.isFinite(localTime.getTime())) return;
    const input = { pricingRevision: quote.revision, receivedAmountCents, receivedAt: localTime.toISOString() };
    const payload = JSON.stringify(input);
    if (submitted.current?.payload !== payload) submitted.current = { payload, id: crypto.randomUUID() };
    setPending(true);
    setError("");
    try {
      onRecorded(await employeeRequest<ReceiptResult>(route, "POST", { ...input, requestId: submitted.current.id }));
    } catch (err) {
      setError(requestError(err));
      setConflict(err instanceof RequestError && err.status === 409);
    } finally {
      setPending(false);
    }
  }

  return <section style={{ marginTop: 16 }}>
    <Typography.Title level={5}>登记本人实际收款</Typography.Title>
    <Form layout="vertical" disabled={pending} onFinish={record}>
      <Form.Item name="amount" label="实收金额（元）" rules={[{ required: true }, { validator: (_, raw: string | null) =>
        !raw || (parseYuanAsCents(raw) ?? 0) > 0 ? Promise.resolve() : Promise.reject(new Error("请输入大于零的金额，最多两位小数")) }]}>
        <Input inputMode="decimal" />
      </Form.Item>
      <Form.Item label="收款时间（本地时间）" name="time" rules={[{ required: true }]}>
        <Input type="datetime-local" />
      </Form.Item>
      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} /> : null}
      <Flex wrap gap="small">
        <Button htmlType="submit" type="primary" loading={pending}>登记实收</Button>
        {conflict ? <Button onClick={onReload}>重新加载</Button> : null}
      </Flex>
    </Form>
  </section>;
}

function PublishedPricing({ pricing, showSegments }: { pricing: DispatchPricing | null; showSegments: boolean }) {
  if (!pricing) return <Empty description="该历史订单没有规则快照" />;
  const unit = commissionUnit(pricing.basis);
  return <>
    <Typography.Paragraph>规则 V{pricing.version} · {commissionBasisLabel[pricing.basis]}</Typography.Paragraph>
    <Typography.Paragraph>派抽 ¥{formatCentsAsYuan(pricing.dispatchFeeCents)}/{unit} · 团抽 ¥{formatCentsAsYuan(pricing.clubFeeCents)}/{unit}</Typography.Paragraph>
    {showSegments ? <ul>{pricing.segments.map((segment, index) => <li key={index}>{periods[segment.period]} · 付费 {segment.hearts} 颗{segment.giftHearts ? ` · 赠心 ${segment.giftHearts} 颗` : ""} · ¥{formatCentsAsYuan(segment.unitPriceCents)}/颗</li>)}</ul> : null}
  </>;
}
