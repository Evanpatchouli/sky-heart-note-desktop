import { useRef, useState, type FormEvent } from "react";
import { formatCentsAsYuan, type CustomerGiftTermination } from "@sky-club/common";
import { getAppToken, RequestError, useAuthSession } from "@sky-club/common/web-auth";
import { clientRequest } from "./order-api";

const money = (cents: number) => `¥${formatCentsAsYuan(cents)}`;
const date = (value: string) => new Date(value).toLocaleString("zh-CN");

function TerminationFacts({ value }: { value: CustomerGiftTermination }) {
  return <>
    <p>已停送 · {date(value.stoppedAt)} · 已送 {value.deliveredGiftTimes} 次，停止 {value.stoppedGiftTimes} 次</p>
    <p>{value.origin === "declined_adjustment" ? "拒绝补差" : value.origin === "customer_request" ? "老板本人提出" : "派单人登记老板线下提出"}</p>
    {value.reason && <p>停送说明 {value.reason}</p>}
    {value.change && <p>派单人登记原因 {value.change.reason}</p>}
    <p>停止付费 {value.stoppedPaidGiftTimes} 次
      {!!value.stoppedPromotionalGiftTimes && <> · 停止促销赠送 {value.stoppedPromotionalGiftTimes} 次</>}</p>
    <dl>
      <dt>原实收</dt><dd>{money(value.originalReceivedCents)}</dd>
      {!!value.continuationReceivedCents && <><dt>续段实收</dt><dd>{money(value.continuationReceivedCents)}</dd></>}
      <dt>实补</dt><dd>{money(value.supplementReceivedCents)}</dd>
      <dt>已履约折后爱心款</dt><dd>{money(value.fulfilledServiceCents)}</dd>
      <dt>应退爱心款</dt><dd>{money(value.refundDueCents)}</dd>
      <dt>实退</dt><dd>{money(value.refundedCents)}</dd>
      <dt>待退</dt><dd>{money(value.refundRemainingCents)}</dd>
      <dt>净实收</dt><dd>{money(value.netReceivedCents)}</dd>
    </dl>
    {value.couponStatus && <p>{value.couponStatus === "returned" ? "优惠券已返还" : "优惠券保持已使用"}</p>}
    {!!value.excessRefundCents && <p>已退比最新应退多 {money(value.excessRefundCents)}。</p>}
    {!!value.refunds.length && <ul aria-label="实退明细">{value.refunds.map(refund => <li key={`${refund.occurredAt}:${refund.amountCents}`}>
      {money(refund.amountCents)} · {date(refund.occurredAt)}
    </li>)}</ul>}
  </>;
}

export function OrderGiftTermination({ route, value, canRequest, awaitingPriceDecision, reload }: {
  route: string; value?: CustomerGiftTermination; canRequest: boolean; awaitingPriceDecision?: boolean; reload: () => void;
}) {
  const { id, token } = useAuthSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ reason: string; requestId: string }>(undefined);
  const inFlight = useRef(false);
  const key = `sky-heart.client.gift-stop:${id}:${route}`;

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || getAppToken("client") !== token) return;
    const reason = String(new FormData(event.currentTarget).get("reason")).trim();
    let stored: typeof pending.current;
    try { stored = JSON.parse(sessionStorage.getItem(key) ?? "null") ?? undefined; } catch { /* Storage is optional. */ }
    const previous = pending.current ?? stored;
    const requestId = previous?.reason === reason ? previous.requestId : crypto.randomUUID();
    pending.current = { reason, requestId };
    try { sessionStorage.setItem(key, JSON.stringify(pending.current)); } catch { /* Storage is optional. */ }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await clientRequest(token, route + "/termination", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, confirmed: true, ...(reason ? { reason } : {}) }),
      });
      if (getAppToken("client") !== token) return;
      try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ }
      reload();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "未收到停送结果，请使用相同说明重试或刷新订单。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!value && (!canRequest || awaitingPriceDecision)) return null;
  return <section aria-label="停送与退款">
    <h2>停送与退款</h2>
    {value ? <TerminationFacts value={value} /> : open ? <form onSubmit={confirm}>
      <p>确认后立即停止剩余送心，已送明细会保留。派单人核实退款后登记实退。</p>
      <p><label>停送说明（选填） <input name="reason" maxLength={240} disabled={busy} /></label></p>
      <div className="client-orders__actions">
        <button type="submit" disabled={busy}>确认申请退单</button>
        <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>返回核对</button>
      </div>
    </form> : <button type="button" onClick={() => setOpen(true)}>申请退单</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
