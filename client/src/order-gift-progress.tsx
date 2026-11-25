import { useRef, useState, type FormEvent } from "react";
import { formatCentsAsYuan, type ContinuationQuote, type ContinuationRequest, type CustomerGiftProgress, type GiftPeriodProgress, type PricingPeriod } from "@sky-club/common";
import { RequestError, useAuthSession } from "@sky-club/common/web-auth";
import { clientRequest } from "./order-api";

const periods = { normal: "普通期", double: "双倍期", unconfirmed: "实际时段待核对" };
const fulfillment = { not_started: "尚未开始", in_progress: "履约中", completed: "约定次数已送完", stopped: "已停送" };

export function giftCount(hearts: number | string | null) {
  return hearts === null ? "未知" : `${hearts} 颗`;
}

function PeriodProgress({ rows }: { rows: GiftPeriodProgress[] }) {
  return rows.length ? <ul>{rows.map(row => <li key={row.period}>
    {periods[row.period]} · 实报 {row.observedGiftTimes} 次 · {row.deliveredGiftTimes === null ? "计入约定的次数待核对" : `计入约定 ${row.deliveredGiftTimes} 次`}
    <br />按实际时段预计 {giftCount(row.estimatedDeliveredHearts)} · 日报到账 {giftCount(row.actualReceivedHearts)}
    {row.unknownReceivedLines > 0 && `（${row.knownReceivedLines > 0 ? `已知 ${giftCount(row.knownReceivedHearts)}，` : ""}${row.unknownReceivedLines} 条未知）`}
  </li>)}</ul> : null;
}

export function GiftOrderProgress({ progress }: { progress: CustomerGiftProgress }) {
  const observed = progress.claimObservedReceivedHearts.map(giftCount);
  return <section className="client-orders__progress" aria-label="赠送履约进度">
    <h3>赠送履约进度</h3>
    <p>约定 {progress.agreedGiftTimes} 次 · 已送 {progress.deliveredGiftTimes} 次 · 剩余 {progress.remainingGiftTimes} 次</p>
    {progress.promotionalGiftTimes ? <p>付费 {progress.deliveredPaidGiftTimes}/{progress.paidGiftTimes} 次 · 促销赠送 {progress.deliveredPromotionalGiftTimes}/{progress.promotionalGiftTimes} 次</p> : null}
    <progress aria-label="约定赠送完成进度" value={progress.deliveredGiftTimes} max={progress.agreedGiftTimes} />
    <p>{progress.closedAt && !["completed", "stopped"].includes(progress.fulfillmentStatus) ? "履约已结束" : fulfillment[progress.fulfillmentStatus]}
      {" · "}{progress.closedAt ? "派单人已确认结单" : "尚未结单"}</p>
    <dl>
      <dt>建单预计实收爱心</dt><dd>{giftCount(progress.estimatedReceivedHearts)}</dd>
      <dt>按实报赠送次数和实际时段预计到账</dt><dd>{giftCount(progress.estimatedDeliveredHearts)}</dd>
      <dt>接单时登记的实际实收爱心</dt><dd>
        {observed.length ? observed.join("、") : "未知"}
        {progress.unknownClaimObservations > 0 && observed.length > 0 ? "，另有未记录的接单观察" : ""}
      </dd>
      <dt>日报累计实际到账爱心</dt><dd>
        {giftCount(progress.actualReceivedHearts)}
        {progress.unknownReceivedLines ? `（${progress.knownReceivedLines ? `已知小计 ${giftCount(progress.knownReceivedHearts)}，` : ""}${progress.unknownReceivedLines} 条未知）` : ""}
      </dd>
    </dl>
    {progress.periods.length > 0 && <>
      <p>仅改变到账倍率的价差 ¥{formatCentsAsYuan(progress.periodOnlyDifferenceCents)}。实际履约按对应段的单价核对。</p>
      <PeriodProgress rows={progress.periods} />
    </>}
    {progress.pendingPromotionalGiftTimes ? <p>促销赠送有 {progress.pendingPromotionalGiftTimes} 次待核对付费履约记录。</p>
      : progress.excessGiftTimes !== 0 ? <p>超出约定的实报次数 {progress.excessGiftTimes} 次待业务核对。</p> : null}
    {progress.segments.length ? <ul>
      {progress.segments.map(segment => <li key={segment.segmentIndex}>
        第 {segment.segmentIndex + 1} 段 · {periods[segment.period]} · {segment.promotionalGiftTimes ? "促销赠送" : "约定"} {segment.agreedGiftTimes} 次 · {segment.dailyGiftTimes} 次/日
        {!segment.promotionalGiftTimes && ` · ¥${formatCentsAsYuan(segment.unitPriceCents)}/次`}
        <br />已送 {segment.deliveredGiftTimes} 次 · 剩余 {segment.remainingGiftTimes} 次 · 本段预计到账 {giftCount(segment.estimatedReceivedHearts)}
        <br />按实际时段预计 {giftCount(segment.estimatedDeliveredHearts)} · 日报到账 {giftCount(segment.actualReceivedHearts)}
        {segment.claimObservedReceivedHearts.length > 0 ? <><br />接单时观察 {segment.claimObservedReceivedHearts.map(giftCount).join("、")}</> : null}
        {segment.window ? <><br />执行 {segment.window.startDate} 至 {segment.window.endDate}</> : null}
        <PeriodProgress rows={segment.periods} />
      </li>)}
    </ul> : null}
  </section>;
}

type Continuations = { requests?: ContinuationRequest[]; quotes?: ContinuationQuote[] };

export function totalGiftPayments(originalCents: number, quotes: ContinuationQuote[] = []) {
  return quotes.reduce((total, quote) => total + (quote.receipt?.receivedAmountCents ?? 0), originalCents);
}

function quoteState(quote: ContinuationQuote) {
  if (quote.receipt) return `已核款 ¥${formatCentsAsYuan(quote.receipt.receivedAmountCents)} · ${new Date(quote.receipt.receivedAt).toLocaleString("zh-CN")}`;
  if (quote.acceptance) return "报价已确认 · 待派单人核款";
  return quote.window ? "待确认报价" : "待派单人补充执行窗口";
}

export function ContinuationFacts({ requests = [], quotes = [], accept, busy }: Continuations & {
  accept?: (quoteId: string) => void;
  busy?: boolean;
}) {
  const waiting = requests.filter(request => !quotes.some(quote => quote.customerRequestId === request.requestId));
  if (!waiting.length && !quotes.length) return null;
  return <section aria-label="续段记录">
    <h3>续段记录</h3>
    <ul>
      {waiting.map(item => <li key={item.requestId}>
        {periods[item.period]} · {item.paidGiftTimes} 次 · {item.dailyGiftTimes} 次/日 · {item.startDate} 至 {item.endDate} · 待派单人报价
      </li>)}
      {quotes.map(item => <li key={item.requestId}>
        {item.segmentIndex === undefined ? "" : `第 ${item.segmentIndex + 1} 段 · `}
        {periods[item.segment.period]} · {item.segment.paidGiftTimes} 次 · {item.segment.dailyGiftTimes} 次/日
        {" · "}¥{formatCentsAsYuan(item.segment.unitPriceCents)}/次 · 报价 ¥{formatCentsAsYuan(item.amountCents)}
        {item.window ? <><br />执行 {item.window.startDate} 至 {item.window.endDate}</> : null}
        <br />{quoteState(item)}
        {accept && item.window && !item.acceptance && !item.receipt ? <>
          {" "}<button type="button" disabled={busy} onClick={() => accept(item.requestId)}>确认续段报价</button>
        </> : null}
      </li>)}
    </ul>
  </section>;
}

export function CustomerContinuation({ route, requests, quotes, canRequest, reload }: Continuations & {
  route: string;
  canRequest: boolean;
  reload: () => void;
}) {
  const { id, token } = useAuthSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const pending = useRef<{ payload: string; requestId: string }>(undefined);
  const storageKey = `sky-club.client.continuation:${id}:${route}`;

  async function submit(path: string, data: object) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const payload = JSON.stringify([path, data]);
    try {
      if (!pending.current) {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (saved?.payload === payload && typeof saved.requestId === "string") pending.current = saved;
      }
    } catch { /* The in-memory request is still available. */ }
    if (pending.current?.payload !== payload) pending.current = { payload, requestId: crypto.randomUUID() };
    const { requestId } = pending.current;
    try {
      try { sessionStorage.setItem(storageKey, JSON.stringify(pending.current)); } catch { /* The in-memory request is still available. */ }
      await clientRequest(token, route + path, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, ...data }),
      });
      pending.current = undefined;
      try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
      setOpen(false);
      reload();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "未收到提交结果，请用原内容重试。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit("/continuation-requests", {
      period: form.get("period") as PricingPeriod,
      paidGiftTimes: Number(form.get("paidGiftTimes")), dailyGiftTimes: Number(form.get("dailyGiftTimes")),
      startDate: form.get("startDate"), endDate: form.get("endDate"),
    });
  }

  return <section aria-label="原单追加计价段">
    <ContinuationFacts requests={requests} quotes={quotes} busy={busy} accept={canRequest
      ? quoteId => void submit(`/continuation-quotes/${quoteId}/acceptance`, {})
      : undefined} />
    {canRequest && <button type="button" disabled={busy} aria-expanded={open}
      onClick={() => setOpen(value => !value)}>{open ? "收起续段申请" : "在原单追加计价段"}</button>}
    {canRequest && open ? <form onSubmit={request}>
      <p>提交后由本单派单人报价。确认报价并登记实收后，新段才开始派发。</p>
      <p><label>交付时段 <select name="period"><option value="normal">普通期</option><option value="double">双倍期</option></select></label></p>
      <p><label>新增赠送次数 <input required name="paidGiftTimes" type="number" min={1} step={1} /></label></p>
      <p><label>每日赠送次数 <input required name="dailyGiftTimes" type="number" min={1} step={1} /></label></p>
      <p><label>执行起始日 <input required name="startDate" type="date" /></label></p>
      <p><label>执行截止日 <input required name="endDate" type="date" /></label></p>
      <button type="submit" disabled={busy}>提交续段需求</button>
    </form> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
