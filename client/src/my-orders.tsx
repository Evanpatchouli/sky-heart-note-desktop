import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { deliveryPeriodPreferenceLabel, formatCentsAsYuan, isGiftOrderProgress, paymentStatusLabel, platformPromotionLabels, priceAdjustmentStateLabel,
  type PriceAdjustment, type PriceAdjustmentDecision } from "@sky-club/common";
import { getAppToken, RequestError, useAuthSession } from "@sky-club/common/web-auth";
import {
  clientRequest, clientOrdersPath, detailHref, dispatchLabel, orderDispatcher, sourceLabel, useClientRead, type Order,
} from "./order-api";
import { CancelPendingOrder } from "./cancel-pending-order";
import { OrderGiftPriceAdjustment } from "./order-gift-price-adjustment";
import { OrderGiftTermination } from "./order-gift-termination";
import { OrderGiftSettlement } from "./order-gift-settlement";
import { TerminationActions, TerminationFacts } from "./order-termination";
import { ContinuationFacts, CustomerContinuation, giftCount, GiftOrderProgress, totalGiftPayments } from "./order-gift-progress";
import { orderCursor, orderListHref, orderSource, readClientContext, rememberClientContext, rememberedOrderList, useClientScroll } from "./navigation";

const periodLabel = { normal: "普通期", double: "双倍期" };
type OrderPage = { items: Order[]; nextCursor: string | null };
const loadError = "暂时无法读取订单，请检查网络连接后重试。";

export function MyOrders() {
  const { token, id } = useAuthSession();
  const cursor = orderCursor();
  const source = orderSource();
  const [page, setPage] = useState<OrderPage | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (cursor) query.set("after", cursor);
    if (source) query.set("source", source);
    const path = query.size ? `/client/orders?${query}` : "/client/orders";
    clientRequest<OrderPage>(token, path, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setPage(data); })
      .catch(err => {
        if (controller.signal.aborted) return;
        setError(err instanceof RequestError ? err.message : loadError);
      });
    return () => controller.abort();
  }, [cursor, source, attempt, token]);

  const context = `orders:${source ?? "all"}:${cursor ?? "first"}`;
  useClientScroll(id, context, !!page);
  const focusKey = `focus:${context}`;
  useLayoutEffect(() => {
    if (!page) return;
    const orderId = readClientContext(id, focusKey);
    if (orderId && page.items.some(order => order.id === orderId)) {
      document.getElementById(`client-order-${orderId}`)?.focus({ preventScroll: true });
      rememberClientContext(id, focusKey, "");
    }
  }, [page, id, focusKey]);

  function reload() {
    setPage(null);
    setError("");
    setAttempt(value => value + 1);
  }

  return <>
    <div className="client-orders__heading">
      <h1>我的订单</h1>
      <button type="button" onClick={reload}>刷新</button>
    </div>
    <label>订单来源 <select value={source ?? ""} onChange={event => window.location.assign(orderListHref(null, event.target.value))}>
      <option value="">全部来源</option>
      <option value="direct_dispatch">直接派单</option>
      <option value="client_order">客户端下单</option>
    </select></label>
    {error ? <p role="alert">{error}</p> : page ? <>
      {page.items.length ? <div className="client-orders__list">{page.items.map(order => <OrderCard key={order.id} order={order} onOpen={() => rememberClientContext(id, focusKey, order.id)} />)}</div>
        : <p>暂无归属本账号的送心订单。</p>}
      {cursor || page.nextCursor ? <nav className="client-orders__heading" aria-label="订单分页">
        {cursor ? <a className="client-orders__action" href={orderListHref(null, source)}>回到第一页</a> : null}
        {page.nextCursor ? <a className="client-orders__action" href={orderListHref(page.nextCursor, source)}>下一页</a> : null}
      </nav> : null}
    </> : <p role="status">正在读取订单…</p>}
  </>;
}

export function OrderDetail({ orderId }: { orderId: string }) {
  const { id } = useAuthSession();
  const { data: order, error, loading, reload } = useClientRead<Order>(`${clientOrdersPath}/${orderId}`, loadError);
  useClientScroll(id, `detail:${orderId}`, !!order && !loading);
  const progress = isGiftOrderProgress(order?.deliveryProgress) ? order.deliveryProgress : undefined;

  return <>
    <a className="client-orders__back" href={rememberedOrderList(id)}>返回我的订单</a>
    <div className="client-orders__heading">
      <h1>订单详情</h1>
      <button type="button" disabled={loading} onClick={reload}>刷新</button>
    </div>
    {error ? <p role="alert">{error}</p> : loading ? <p role="status">正在读取订单…</p> : order ? <section className="client-orders__card">
      <div className="client-orders__summary"><OrderSummaryContent order={order} /></div>
      <OrderDetailsContent order={order} manageContinuation />
      {order.settlement ? <OrderGiftSettlement value={order.settlement} showTerminationEvidence={!progress?.termination} /> : null}
      {progress?.priceAdjustment && <OrderGiftPriceAdjustment key={progress.priceAdjustment.id}
        route={`${clientOrdersPath}/${orderId}`} value={progress.priceAdjustment} history={progress.priceAdjustmentHistory}
        stopped={progress.fulfillmentStatus === "stopped"} reload={reload} />}
      {progress && <OrderGiftTermination route={`${clientOrdersPath}/${orderId}`}
        canRequest={progress.canRequestTermination} value={progress.termination}
        awaitingPriceDecision={progress.priceAdjustment?.state === "awaiting_decision"} reload={reload} />}
      <CustomerContinuation route={`${clientOrdersPath}/${orderId}`}
        canRequest={isGiftOrderProgress(order.deliveryProgress) && order.deliveryProgress.canRequestContinuation}
        requests={order.continuationRequests} quotes={order.continuationQuotes} reload={reload} />
      {order.dispatchStatus === "pending_assignment" ? <CancelPendingOrder order={order} onChange={reload} /> : null}
      {order.priceAdjustment && (!order.termination || order.termination.origin === "declined_adjustment")
        ? <ChangeDecision key={order.priceAdjustment.id} order={order} adjustment={order.priceAdjustment} reload={reload} /> : null}
      <TerminationActions key={order.id} order={order} reload={reload} />
      <div className="client-orders__detail-actions">
        <a className="client-orders__action" href="/order">下单</a>
      </div>
    </section> : null}
  </>;
}

function OrderSummaryContent({ order }: { order: Order }) {
  const progress = order.deliveryProgress;
  const hasContinuation = !!(order.continuationQuotes?.length || order.continuationRequests?.length);
  const quoteLabel = order.pendingActivity ? "活动报价待核对" : order.quote ? `${hasContinuation ? "原报价" : "报价"} ¥${formatCentsAsYuan(order.quote.totalAmountCents)}`
    : order.quoteSegments?.length ? "已录分时段报价" : order.dispatchStatus === "published" ? "暂无报价记录" : "待报价";
  return <>
    <strong>{order.recipientGameAccount} · {order.requestedGiftTimes !== undefined
      ? `${hasContinuation ? "初次订购" : "订购"} ${order.requestedGiftTimes} 次`
      : `${order.pendingActivity ? "原订购" : "承诺"} ${order.fulfillmentHearts ?? order.requestedHearts} 颗`}</strong>
    <span>{sourceLabel[order.source]} · {order.termination ? "已停送" : dispatchLabel[order.dispatchStatus]}</span>
    {isGiftOrderProgress(progress) ? <span className="client-orders__summary-progress">
      约定 {progress.agreedGiftTimes} 次 · 已送 {progress.deliveredGiftTimes} 次 · 剩余 {progress.remainingGiftTimes} 次
      {" · "}日报到账 {giftCount(progress.actualReceivedHearts)} · {progress.closedAt ? "已确认结单" : "尚未结单"}
    </span> : progress ? <span className="client-orders__summary-progress">
      到账 {progress.observedHearts} 颗 · {order.termination ? `已停送 ${order.termination.stoppedHearts} 颗` : `剩余 ${progress.remainingHearts} 颗`}
    </span> : null}
    <span>{quoteLabel} · {order.settlement?.cashCorrected ? "实收实退已按审批更正" : hasContinuation && order.receipt
      ? `原收款 ${amount(order.receipt.receivedAmountCents)} · 累计已登记收款 ${amount(totalGiftPayments(order.receipt.receivedAmountCents, order.continuationQuotes))}`
      : paymentStatusLabel[order.paymentStatus]}</span>
    {order.termination ? <span>{order.termination.refundRemainingCents === 0 && !order.termination.review.length ? "退款已核对" : "停送 · 退款核对中"}
      {order.termination.netReceivedCents !== null ? ` · 净付 ${amount(order.termination.netReceivedCents)}` : ""}</span>
      : order.priceAdjustment ? <span>{priceAdjustmentStateLabel[order.priceAdjustment.state]} · 已付 {amount(order.priceAdjustment.netReceivedCents)}</span> : null}
  </>;
}

function OrderCard({ order, onOpen }: { order: Order; onOpen: () => void }) {
  const { id } = useAuthSession();
  const openingKey = `open:${order.id}`;
  const [open, setOpen] = useState(() => readClientContext(id, openingKey) === "true");
  return <details className="client-orders__card" open={open} onToggle={event => {
    const next = event.currentTarget.open;
    setOpen(next);
    rememberClientContext(id, openingKey, String(next));
  }}>
    <summary id={`client-order-${order.id}`} className="client-orders__summary"><OrderSummaryContent order={order} /></summary>
    <OrderDetailsContent order={order} />
    <div className="client-orders__detail-actions">
      <a className="client-orders__action" href={detailHref(order)} onClick={onOpen}>查看订单详情</a>
    </div>
  </details>;
}

function OrderDetailsContent({ order, manageContinuation = false }: { order: Order; manageContinuation?: boolean }) {
  const { quote, receipt, deliveryProgress, pendingActivity } = order;
  const hasContinuation = !!(order.continuationQuotes?.length || order.continuationRequests?.length);
  const segments = quote?.segments ?? order.quoteSegments;
  const fulfillmentHearts = order.fulfillmentHearts ?? order.requestedHearts;
  const original = quote?.originalHeartsAmountCents;
  return (
    <div className="client-orders__detail">
      {isGiftOrderProgress(deliveryProgress) ? <GiftOrderProgress progress={deliveryProgress} />
        : deliveryProgress ? <section className="client-orders__progress" aria-label="交付进度">
        <h3>交付进度</h3>
        <div className="client-orders__progress-count">
          <span>实际到账 <strong>{deliveryProgress.observedHearts}</strong> 颗</span>
          <span>{pendingActivity ? "原订购" : "承诺"} {fulfillmentHearts} 颗</span>
        </div>
        <progress aria-label="约定送心完成进度" value={deliveryProgress.creditedHearts} max={fulfillmentHearts} />
        <p>{order.termination ? `原未履约 ${deliveryProgress.remainingHearts} 颗 · 已停送 ${order.termination.stoppedHearts} 颗`
          : `剩余 ${deliveryProgress.remainingHearts} 颗 · ${deliveryProgress.agreedDeadline ? `约定截止 ${deliveryProgress.agreedDeadline}` : "未约定截止业务日"}`}</p>
        {String(deliveryProgress.observedHearts) !== String(deliveryProgress.creditedHearts) ? <p>其中 {deliveryProgress.creditedHearts} 颗已计入约定份额，额外到账待核对。</p> : null}
        {order.dispatchStatus === "published" && <p>{order.closedAt ? "派单人已确认结单" : "尚未结单"}</p>}
      </section> : null}
      <p className="client-orders__id">订单号 {order.id}</p>
      <dl>
        {order.requestedGiftTimes === undefined ? null : <><dt>{hasContinuation ? "初次订购赠送次数" : "订购赠送次数"}</dt><dd>{order.requestedGiftTimes} 次</dd></>}
        {order.requestedGiftTimes === undefined || isGiftOrderProgress(deliveryProgress) ? null : <>
          <dt>建单预计实收爱心</dt><dd>{order.estimatedReceivedHearts === undefined ? "待确认" : `${order.estimatedReceivedHearts} 颗`}</dd>
        </>}
        {order.giftHearts ? <><dt>付费 / 赠心</dt><dd>{order.requestedHearts} / {order.giftHearts} 颗</dd></> : null}
        <dt>派单人</dt><dd>{orderDispatcher(order)}</dd>
        {order.deliveryPeriodPreference ? <>
          <dt>期望交付时段</dt><dd>{deliveryPeriodPreferenceLabel[order.deliveryPeriodPreference]}</dd>
        </> : null}
        {order.doubleGiftTimes === undefined ? null : <><dt>预计双倍期赠送</dt><dd>{order.doubleGiftTimes} 次</dd></>}
      </dl>
      {segments?.length ? <>
        <h3>{pendingActivity ? "待核对的分时段报价" : "分时段报价"}</h3>
        <ul>{segments.map((segment, index) => <li key={index}>
          {periodLabel[segment.period]} · 付费 {segment.hearts} 颗 × ¥{formatCentsAsYuan(segment.unitPriceCents)}/颗 = ¥{formatCentsAsYuan(segment.hearts * segment.unitPriceCents)}{segment.giftHearts ? ` · 赠心 ${segment.giftHearts} 颗` : ""}
        </li>)}</ul>
      </> : null}
      {quote?.giftSegments?.length ? <>
        <h3>{hasContinuation ? "原分段报价" : "分段报价"}</h3>
        <ul>{quote.giftSegments.map((segment, index) => <li key={index}>
          {periodLabel[segment.period]} · {segment.paidGiftTimes} 次 × {amount(segment.unitPriceCents)}/次 = {amount(segment.paidGiftTimes * segment.unitPriceCents)} · {segment.dailyGiftTimes} 次/日
        </li>)}</ul>
      </> : null}
      {!manageContinuation && <ContinuationFacts requests={order.continuationRequests} quotes={order.continuationQuotes} />}
      {pendingActivity ? <dl>
        <dt>拟议折后爱心款</dt><dd>¥{formatCentsAsYuan(pendingActivity.proposedDiscountedHeartsAmountCents)}</dd>
        <dt>应付总额</dt><dd>买赠与折扣叠加规则待核对</dd>
      </dl> : null}
      {quote ? <dl>
        {original === undefined ? null : <>
          <dt>折前爱心款</dt><dd>¥{formatCentsAsYuan(original)}</dd>
          {!quote.promotions && <><dt>折扣差额</dt><dd>¥{formatCentsAsYuan(original - quote.heartsAmountCents)}</dd></>}
        </>}
        {quote.promotions?.platform && <>
          <dt>{platformPromotionLabels[quote.promotions.platform.kind]} · 团费承担</dt>
          <dd>{quote.promotions.platform.name} −{amount(quote.promotions.platform.amountCents)}</dd>
        </>}
        {quote.promotions?.personal && <>
          <dt>派单人个人让利</dt><dd>−{amount(quote.promotions.personal.amountCents)}</dd>
        </>}
        {quote.promotions?.gift && <>
          <dt>平台赠送</dt>
          <dd>{quote.promotions.gift.segments.reduce((sum, gift) => sum + gift.promotionalGiftTimes, 0)} 次 · 首次报价总履约 {quote.promotions.totalGiftTimes} 次</dd>
        </>}
        {quote.promotions?.couponIssue && <><dt>原选优惠券</dt>
          <dd>{quote.promotions.couponIssue === "threshold" ? "折前服务款未达到使用门槛" : "当前不可用"}</dd></>}
        <dt>{hasContinuation ? "原报价应付服务款" : "应付服务款"}</dt><dd>¥{formatCentsAsYuan(quote.totalAmountCents)}</dd>
      </dl> : null}
      {receipt ? <dl>
        <dt>{order.settlement?.cashCorrected ? "原登记首款" : hasContinuation ? "原收款" : "已登记实收"}</dt><dd>¥{formatCentsAsYuan(receipt.receivedAmountCents)}</dd>
        <dt>{hasContinuation ? "原收款时间" : "收款时间"}</dt><dd>{new Date(receipt.receivedAt).toLocaleString("zh-CN")}</dd>
        {hasContinuation && <><dt>{order.settlement?.cashCorrected ? "累计原登记收款" : "累计已登记收款"}</dt><dd>{amount(totalGiftPayments(receipt.receivedAmountCents, order.continuationQuotes))}</dd></>}
      </dl> : null}
      {order.termination ? <TerminationFacts stop={order.termination} /> : null}
      {order.priceAdjustment ? <AdjustmentSummary adjustment={order.priceAdjustment} stopped={!!order.termination} /> : null}
      {order.priceAdjustmentHistory?.length ? <details><summary>查看历次改价</summary>
        {order.priceAdjustmentHistory.map(adjustment => <AdjustmentSummary key={adjustment.id} adjustment={adjustment} />)}
      </details> : null}
    </div>
  );
}

function amount(cents: number) {
  return `¥${formatCentsAsYuan(cents)}`;
}

function AdjustmentSummary({ adjustment, stopped = false }: { adjustment: PriceAdjustment; stopped?: boolean }) {
  const { state, decision, reason, shift, supplement, refund } = adjustment;
  return <section aria-label="改价和收退款">
    <h3>跨期改价</h3>
    <p role="status">{stopped ? decision?.value === "decline" ? "已拒绝补差并停送" : "本单已停送，保留原改价记录" : priceAdjustmentStateLabel[state]}</p>
    <p>{reason}</p>
    <dl>
      <dt>提案时已到账</dt><dd>{adjustment.observedHearts} 颗</dd>
      <dt>跨期数量</dt><dd>{shift.hearts} 颗</dd>
      <dt>原报价第 {shift.quoteSegment} 段</dt><dd>{periodLabel[adjustment.originalPeriod]} · {amount(adjustment.originalUnitPriceCents)}/颗</dd>
      <dt>续送单价</dt><dd>{periodLabel[shift.targetPeriod]} · {amount(shift.targetUnitPriceCents)}/颗</dd>
      <dt>原实付</dt><dd>{amount(adjustment.originalReceivedCents)}</dd>
      <dt>拟补差</dt><dd>{amount(adjustment.differenceCents)}</dd>
      <dt>实补</dt><dd>{amount(supplement?.amountCents ?? 0)}</dd>
      {stopped ? null : decision?.value === "decline" ? <>
        <dt>未履约原付心款应退</dt><dd>{amount(adjustment.refundDueCents)}</dd>
        <dt>实退</dt><dd>{amount(refund?.amountCents ?? 0)}</dd>
      </> : <><dt>续送结清总价</dt><dd>{amount(adjustment.proposedTotalCents)}</dd></>}
      {!stopped ? <><dt>{decision?.value === "decline" ? "净付" : "累计实付"}</dt><dd><strong>{amount(adjustment.netReceivedCents)}</strong></dd></> : null}
      {decision ? <><dt>客户答复</dt><dd>{decision.value === "accept" ? "已同意" : "已拒绝"} · {new Date(decision.recordedAt).toLocaleString("zh-CN")}</dd></> : null}
      {supplement ? <><dt>补款时间</dt><dd>{new Date(supplement.occurredAt).toLocaleString("zh-CN")}</dd></> : null}
      {!stopped && refund ? <><dt>退款时间</dt><dd>{new Date(refund.occurredAt).toLocaleString("zh-CN")}</dd></> : null}
    </dl>
  </section>;
}

type DecisionWrite = { decision: PriceAdjustmentDecision; adjustmentId: string; expectedRevision: number; requestId: string };

function readDecision(key: string, adjustmentId: string): DecisionWrite | undefined {
  try {
    const value: DecisionWrite | null = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (value?.adjustmentId === adjustmentId && typeof value.requestId === "string" &&
        (value.decision === "accept" || value.decision === "decline")) return value;
  } catch {
    return;
  }
}

function ChangeDecision({ order, adjustment, reload }: { order: Order; adjustment: PriceAdjustment; reload: () => void }) {
  const { id: userId, token } = useAuthSession();
  const storageKey = `sky-heart.price-decision.v1:${userId}:${order.clubId}:${order.id}:${adjustment.id}`;
  const [selected, setSelected] = useState<PriceAdjustmentDecision>();
  const [pending, setPending] = useState(() => readDecision(storageKey, adjustment.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef<AbortController>(undefined);
  const titleId = useId();
  useEffect(() => () => inFlight.current?.abort(), []);

  function keep(value?: DecisionWrite) {
    setPending(value);
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // 当前页面仍可重试。
    }
  }

  async function decide(value: DecisionWrite) {
    if (inFlight.current || getAppToken("client") !== token) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    keep(value);
    setSaving(true);
    setError("");
    try {
      const response = await clientRequest<PriceAdjustment>(token,
        `${clientOrdersPath}/${order.id}/historical-price-adjustment/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
          signal: controller.signal,
        });
      if (getAppToken("client") !== token) return;
      if (response?.id !== adjustment.id || response.decision?.value !== value.decision) throw new Error("未收到答复回执");
      keep();
      reload();
    } catch (err) {
      if (getAppToken("client") !== token) return;
      if (err instanceof RequestError && [400, 403, 404, 409].includes(err.status)) {
        keep();
        setError(err.message);
      } else setError("答复结果待确认，请检查网络后重试。");
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = undefined;
      setSaving(false);
    }
  }

  function ask(decision: PriceAdjustmentDecision) {
    setSelected(decision);
    dialog.current?.showModal();
  }

  return <div className="client-orders__detail-actions client-orders__actions">
    {pending ? <button type="button" disabled={saving} onClick={() => void decide(pending)}>重试本次答复</button>
      : adjustment.state === "awaiting_customer" ? <>
        <button type="button" className="client-orders__primary" onClick={() => ask("accept")}>同意补差</button>
        <button type="button" onClick={() => ask("decline")}>拒绝补差并停送</button>
      </> : null}
    {error ? <p role="alert">{error} <button type="button" onClick={reload}>刷新核对</button></p> : null}
    <dialog className="client-orders__dialog" ref={dialog} aria-labelledby={titleId}>
      <h3 id={titleId}>{selected === "accept" ? "同意补差继续送心？" : "确认停送并核对退款？"}</h3>
      {selected === "accept"
        ? <p>补差 {amount(adjustment.differenceCents)}。派单人登记实际补款后继续送心。</p>
        : <>
          <p>整单停止送心。未履约的已付心款预计退 {amount(adjustment.refundIfDeclinedCents)}，实际退款由派单人核对登记。</p>
        </>}
      <form method="dialog" className="client-orders__actions client-orders__dialog-actions">
        <button type="submit">返回</button>
        <button type="submit" className="client-orders__primary" onClick={() => {
          if (selected) void decide({ decision: selected, adjustmentId: adjustment.id, expectedRevision: adjustment.revision, requestId: crypto.randomUUID() });
        }}>{selected === "accept" ? "确认同意补差" : "确认停送退款"}</button>
      </form>
    </dialog>
  </div>;
}
