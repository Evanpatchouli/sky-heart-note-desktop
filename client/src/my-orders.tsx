import { useEffect, useState } from "react";
import { deliveryPeriodPreferenceLabel, formatCentsAsYuan, type ContinuationQuote, type CustomerQuote, type DeliveryPeriodPreference, type GiftPriceSegment, type PriceSegment } from "@webapp-template/common";
import { authRequest, invalidateSession, RequestError, useAuthSession } from "@webapp-template/common/web-auth";

const sources = { direct_dispatch: "直接派单", client_order: "客户端下单" };
const statuses = { draft: "待派发", pending: "待派单", published: "已派发" };
const periods = { normal: "普通期", double: "双倍期" };
type Order = {
  id: string;
  clubId: string;
  source: keyof typeof sources;
  dispatchStatus: keyof typeof statuses;
  dispatcherUserId: string;
  recipientGameAccount: string;
  requestedHearts?: number;
  requestedGiftTimes?: number;
  estimatedReceivedHearts?: number;
  deliveryPeriodPreference?: DeliveryPeriodPreference;
  doubleGiftTimes?: number;
  segments?: PriceSegment[];
  giftSegments?: GiftPriceSegment[];
  quote?: CustomerQuote;
  receipt?: { receivedAmountCents: number; receivedAt: string };
  continuationQuotes?: ContinuationQuote[];
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

  return <main style={{ maxWidth: 720, marginInline: "auto", padding: 16 }}>
    <h1>我的订单</h1>
    <label>订单来源 <select value={source} onChange={event => { goTo(); setSource(event.target.value); }}>
      <option value="">全部来源</option>
      <option value="direct_dispatch">直接派单</option>
      <option value="client_order">客户端下单</option>
    </select></label>
    {error ? <p role="alert">{error} <button type="button" onClick={() => {
      setError("");
      setAttempt(value => value + 1);
    }}>重试</button></p> : page ? page.items.length ? <ul>
      {page.items.map(order => <li key={order.id}>
        <details>
          <summary>{order.recipientGameAccount} · {sources[order.source]} · {statuses[order.dispatchStatus]}</summary>
          <p>订单号 {order.id}</p>
          <p>俱乐部 {order.clubId} · 派单人 {order.dispatcherUserId} · 订购 {order.requestedGiftTimes !== undefined ? `${order.requestedGiftTimes} 次` : `${order.requestedHearts} 颗`}</p>
          {order.requestedGiftTimes === undefined ? null : <p>
            建单预计实收爱心 {order.estimatedReceivedHearts === undefined ? "待确认" : `${order.estimatedReceivedHearts} 颗`}
            {order.deliveryPeriodPreference ? ` · ${deliveryPeriodPreferenceLabel[order.deliveryPeriodPreference]}` : ""}
            {order.doubleGiftTimes === undefined ? "" : ` · 双倍期 ${order.doubleGiftTimes} 次`}
          </p>}
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
            <dt>报价合计</dt><dd>¥{formatCentsAsYuan(order.quote.totalAmountCents)}</dd>
          </dl> : null}
          {order.receipt ? <p>已登记实收 ¥{formatCentsAsYuan(order.receipt.receivedAmountCents)} · {new Date(order.receipt.receivedAt).toLocaleString("zh-CN")}</p> : null}
          {order.continuationQuotes?.map(({ requestId, segment, amountCents }) => <p key={requestId}>
            续段 {segment.paidGiftTimes} 次 · ¥{formatCentsAsYuan(segment.unitPriceCents)}/次 · 合计 ¥{formatCentsAsYuan(amountCents)} · 待核款
          </p>)}
        </details>
      </li>)}
    </ul> : <p>暂无订单</p> : <p role="status">加载中…</p>}
    {after || page?.nextCursor ? <nav aria-label="订单分页">
      <button type="button" disabled={!after} onClick={() => goTo()}>返回首页</button>
      <button type="button" disabled={!page?.nextCursor} onClick={() => goTo(page?.nextCursor ?? undefined)}>下一页</button>
    </nav> : null}
  </main>;
}
