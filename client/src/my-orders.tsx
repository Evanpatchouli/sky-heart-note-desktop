import { useEffect, useState } from "react";
import { deliveryPeriodPreferenceLabel, formatCentsAsYuan, isGiftOrderProgress, type ContinuationQuote, type ContinuationRequest, type CustomerGiftProgress, type CustomerQuote, type GiftPriceSegment, type PriceSegment } from "@webapp-template/common";
import { authRequest, invalidateSession, RequestError, useAuthSession } from "@webapp-template/common/web-auth";

import { ContinuationFacts, CustomerContinuation, giftCount, GiftOrderProgress, totalGiftPayments } from "./order-gift-progress";
import { CancelPendingOrder } from "./cancel-pending-order";
import { clubOrderPath, detailHref, dispatchLabel, orderDispatcher, orderHref, sourceLabel, useClientRead, type OrderSummary } from "./order-api";

const periods = { normal: "普通期", double: "双倍期" };
type Order = OrderSummary & {
  segments?: PriceSegment[];
  giftSegments?: GiftPriceSegment[];
  quote?: CustomerQuote;
  receipt?: { receivedAmountCents: number; receivedAt: string };
  continuationQuotes?: ContinuationQuote[];
  continuationRequests?: ContinuationRequest[];
  closedAt?: string | null;
  deliveryProgress?: CustomerGiftProgress | {
    priceUnit: "received_hearts";
    agreedDeadline: string | null;
    observedHearts: number | string;
    creditedHearts: number;
    remainingHearts: number;
  };
};
type Page = { items: Order[]; nextCursor: string | null };

export default function MyOrders() {
  const { token } = useAuthSession();
  const [source, setSource] = useState("");
  const [after, setAfter] = useState<string>();
  const [page, setPage] = useState<Page>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (after) params.set("after", after);
    authRequest<Page>(`/client/orders?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    }).then(result => {
      if (!controller.signal.aborted) setPage(result);
    }).catch(err => {
      if (controller.signal.aborted) return;
      if (err instanceof RequestError && err.status === 401) invalidateSession("client");
      else setError(err instanceof Error ? err.message : "订单加载失败");
    });
    return () => controller.abort();
  }, [token, after, source, attempt]);

  function goTo(cursor?: string) {
    setPage(undefined);
    setError("");
    setAfter(cursor);
  }

  return <section>
    <div className="client-orders__actions">
      <h1>我的订单</h1>
      <button type="button" onClick={() => { setError(""); setAttempt(value => value + 1); }}>刷新</button>
    </div>
    <label>订单来源 <select value={source} onChange={event => { goTo(); setSource(event.target.value); }}>
      <option value="">全部来源</option>
      <option value="direct_dispatch">直接派单</option>
      <option value="client_order">客户端下单</option>
    </select></label>
    {error ? <p role="alert">{error} <button type="button" onClick={() => {
      setError("");
      setAttempt(value => value + 1);
    }}>重试</button></p> : page ? page.items.length ? <ul className="client-orders__list">
      {page.items.map(order => <li key={order.id}>
        <details>
          <summary>{order.recipientGameAccount} · {sourceLabel[order.source]} · {dispatchLabel[order.dispatchStatus]}
            {isGiftOrderProgress(order.deliveryProgress) && <>
              {" · "}约定 {order.deliveryProgress.agreedGiftTimes} 次 · 已送 {order.deliveryProgress.deliveredGiftTimes} 次
              {" · "}剩余 {order.deliveryProgress.remainingGiftTimes} 次 · 日报到账 {giftCount(order.deliveryProgress.actualReceivedHearts)}
              {" · "}{order.deliveryProgress.closedAt ? "已确认结单" : "尚未结单"}
              {order.receipt && !!(order.continuationQuotes?.length || order.continuationRequests?.length) && <>
                {" · "}累计已登记收款 ¥{formatCentsAsYuan(totalGiftPayments(order.receipt.receivedAmountCents, order.continuationQuotes))}
              </>}
            </>}
          </summary>
          <OrderFacts order={order} />
          <a className="client-orders__action" href={detailHref(order)}>查看订单详情</a>
        </details>
      </li>)}
    </ul> : <p>暂无订单</p> : <p role="status">加载中…</p>}
    {after || page?.nextCursor ? <nav aria-label="订单分页">
      <button type="button" disabled={!after} onClick={() => goTo()}>返回首页</button>
      <button type="button" disabled={!page?.nextCursor} onClick={() => goTo(page?.nextCursor ?? undefined)}>下一页</button>
    </nav> : null}
  </section>;
}

export function OrderDetail({ clubId, orderId }: { clubId: string; orderId: string }) {
  const { data: order, error, loading, reload } = useClientRead<Order>(
    `${clubOrderPath(clubId)}/${orderId}`, "订单加载失败",
  );
  return <section className="client-orders__panel">
    <h1>订单详情</h1>
    <div className="client-orders__actions">
      <a className="client-orders__action" href="/">返回我的订单</a>
      <a className="client-orders__action" href={orderHref(clubId)}>向此俱乐部下单</a>
      <button type="button" disabled={loading} onClick={reload}>刷新</button>
    </div>
    {error ? <p role="alert">{error} <button type="button" onClick={reload}>重试</button></p>
      : loading ? <p role="status">正在读取订单…</p> : order ? <>
        <h2>{order.recipientGameAccount}</h2>
        <p>{sourceLabel[order.source]} · <strong>{dispatchLabel[order.dispatchStatus]}</strong></p>
        <OrderFacts order={order} manageContinuation />
        <CustomerContinuation route={`${clubOrderPath(clubId)}/${orderId}`}
          canRequest={isGiftOrderProgress(order.deliveryProgress) && order.deliveryProgress.canRequestContinuation}
          requests={order.continuationRequests} quotes={order.continuationQuotes} reload={reload} />
        {order.dispatchStatus === "pending_assignment" ? <CancelPendingOrder order={order} onChange={reload} /> : null}
      </> : null}
  </section>;
}

function OrderFacts({ order, manageContinuation = false }: { order: Order; manageContinuation?: boolean }) {
  const hasContinuation = !!(order.continuationQuotes?.length || order.continuationRequests?.length);
  return <>
    <p>订单号 {order.id}</p>
    <p>俱乐部 {order.clubId} · 派单人 {orderDispatcher(order)} · {hasContinuation ? "初次订购" : "订购"} {order.requestedGiftTimes !== undefined ? `${order.requestedGiftTimes} 次` : `${order.requestedHearts} 颗`}</p>
    {isGiftOrderProgress(order.deliveryProgress)
      ? <GiftOrderProgress progress={order.deliveryProgress} />
      : order.deliveryProgress ? <p>历史按颗 · 实际到账 {order.deliveryProgress.observedHearts} 颗 · 已履约 {order.deliveryProgress.creditedHearts} 颗 · 剩余 {order.deliveryProgress.remainingHearts} 颗
        {" · "}{order.closedAt ? "派单人已确认结单" : "尚未结单"}
        {order.deliveryProgress.agreedDeadline && <> · 约定截止 {order.deliveryProgress.agreedDeadline}</>}</p> : null}
    {order.requestedGiftTimes !== undefined && !isGiftOrderProgress(order.deliveryProgress) &&
      <p>建单预计实收爱心 {order.estimatedReceivedHearts === undefined ? "未知" : <>{order.estimatedReceivedHearts} 颗</>}</p>}
    {order.deliveryPeriodPreference || order.doubleGiftTimes !== undefined ? <p>
      {order.deliveryPeriodPreference ? `期望交付时段 ${deliveryPeriodPreferenceLabel[order.deliveryPeriodPreference]}` : ""}
      {order.doubleGiftTimes === undefined ? "" : ` · 双倍期 ${order.doubleGiftTimes} 次`}
    </p> : null}
    {(order.quote?.segments ?? order.segments)?.map((segment, index) => <p key={index}>
      {periods[segment.period]} · {segment.hearts} 颗 × ¥{formatCentsAsYuan(segment.unitPriceCents)}/颗
      {segment.giftHearts ? ` · 赠心 ${segment.giftHearts} 颗` : ""}
    </p>)}
    {(order.quote?.giftSegments ?? order.giftSegments)?.map((segment, index) => <p key={index}>
      {periods[segment.period]} · {segment.paidGiftTimes} 次 × ¥{formatCentsAsYuan(segment.unitPriceCents)}/次 = ¥{formatCentsAsYuan(segment.paidGiftTimes * segment.unitPriceCents)} · {segment.dailyGiftTimes} 次/日
    </p>)}
    {order.quote ? <dl>
      {order.quote.originalHeartsAmountCents === undefined ? null : <>
        <dt>折前爱心款</dt><dd>¥{formatCentsAsYuan(order.quote.originalHeartsAmountCents)}</dd>
      </>}
      <dt>爱心款</dt><dd>¥{formatCentsAsYuan(order.quote.heartsAmountCents)}</dd>
      <dt>预估解锁款</dt><dd>{order.quote.unlock.quantity} 次 × ¥{formatCentsAsYuan(order.quote.unlock.unitPriceCents)}/次 = ¥{formatCentsAsYuan(order.quote.unlockAmountCents)}</dd>
      <dt>{hasContinuation ? "原报价合计" : "报价合计"}</dt><dd>¥{formatCentsAsYuan(order.quote.totalAmountCents)}</dd>
    </dl> : null}
    {order.receipt ? <>
      <p>{hasContinuation ? "原收款" : "已登记实收"} ¥{formatCentsAsYuan(order.receipt.receivedAmountCents)} · {new Date(order.receipt.receivedAt).toLocaleString("zh-CN")}</p>
      {hasContinuation && <p>累计已登记收款 ¥{formatCentsAsYuan(totalGiftPayments(order.receipt.receivedAmountCents, order.continuationQuotes))}</p>}
    </> : null}
    {!manageContinuation && <ContinuationFacts requests={order.continuationRequests} quotes={order.continuationQuotes} />}
  </>;
}
