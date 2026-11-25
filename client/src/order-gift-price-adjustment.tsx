import { useRef, useState } from "react";
import { formatCentsAsYuan, type GiftPriceAdjustment } from "@webapp-template/common";
import { RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { clientRequest } from "./order-api";

const periods = { normal: "普通期", double: "双倍期" };
const stateLabels = {
  awaiting_decision: "等待答复", awaiting_supplement: "已同意，待核对补款到账",
  continuing: "已登记实补，可以续送", stopped: "已拒补，停止后续送心",
  needs_requote: "过去的履约记录已更新，原改价方案失效",
  superseded: "原改价方案已失效，已恢复按现有约定履约",
};

function money(cents: number | null) {
  return cents === null ? "待核对" : `¥${formatCentsAsYuan(cents)}`;
}

function Summary({ value }: { value: GiftPriceAdjustment }) {
  const { preview, decision } = value;
  return <>
    <p>{stateLabels[value.state]} · 提出于 {new Date(value.submittedAt).toLocaleString("zh-CN")}</p>
    <p>改价原因：{value.reason}</p>
    <p>原报价 {money(preview.originalQuoteCents)} · 改价前实收 {money(preview.cumulativeReceivedCents)}</p>
    <p>发起时已送 {preview.deliveredGiftTimes} 次、剩余 {preview.remainingGiftTimes} 次 · 实际到账 {preview.actualReceivedHearts ?? "待核对"} {preview.actualReceivedHearts === null ? "" : "颗"}</p>
    <p>第 {preview.quoteSegment} 段涉及 {preview.giftTimes} 次 · {periods[preview.originalPeriod]} {money(preview.originalUnitPriceCents)}/次 → {periods[preview.targetPeriod]} {money(preview.targetUnitPriceCents)}/次</p>
    <p>拟总价 {money(preview.proposedTotalCents)} · 拟补款 {money(preview.differenceCents)} · 如拒绝并停送，应退 {money(preview.refundIfDeclinedCents)}</p>
    {decision && <p>{decision.source === "customer" ? "老板本人答复" : "派单人登记的线下协商"}
      {" · "}{decision.value === "accept" ? "同意补差" : "拒绝补差并停送"} · {new Date(decision.decidedAt).toLocaleString("zh-CN")}
      {decision.evidence && ` · ${decision.evidence}`}</p>}
    <p>原实收 {money(value.originalReceivedCents)} · 累计实补 {money(value.supplementReceivedCents)} · 应退 {money(value.refundDueCents)}
      {" · "}实退 {money(value.refundedCents)} · 净实收 {money(value.netReceivedCents)}</p>
    {value.state === "stopped" && value.latestFactChange && <p>已按最新有效日报重新核对应退。</p>}
    {value.state === "stopped" && value.refundedCents > value.refundDueCents &&
      <p>已退超出最新应退 {money(value.refundedCents - value.refundDueCents)}，实际退款记录仍可核对。</p>}
    {!!value.payments.length && <ul>{value.payments.map(payment => <li key={payment.requestId}>
      {payment.kind === "supplement" ? "实补" : "实退"} {money(payment.amountCents)} · {new Date(payment.occurredAt).toLocaleString("zh-CN")}
    </li>)}</ul>}
  </>;
}

export function OrderGiftPriceAdjustment({ route, value, history, reload }: {
  route: string; value: GiftPriceAdjustment; history?: GiftPriceAdjustment[]; reload: () => void;
}) {
  const { id, token } = useAuthSession();
  const [decision, setDecision] = useState<"accept" | "decline">();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const pending = useRef<{ key: string; requestId: string }>(undefined);
  const key = `sky-heart.client.gift-price:${id}:${route}:${value.id}:${value.revision}:${decision}`;

  async function confirm() {
    if (!decision || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    if (pending.current?.key !== key) {
      let saved: string | null = null;
      try { saved = sessionStorage.getItem(key); } catch { /* Storage is optional. */ }
      pending.current = { key, requestId: saved ?? crypto.randomUUID() };
    }
    try {
      try { sessionStorage.setItem(key, pending.current.requestId); } catch { /* Storage is optional. */ }
      await clientRequest(token, route + "/price-adjustment/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, adjustmentId: value.id, expectedRevision: value.revision, requestId: pending.current.requestId }),
      });
      try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ }
      setDecision(undefined);
      reload();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "未收到答复登记结果，请用原选项重试。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section aria-label="已付款订单改价">
    <h2>已付款订单改价</h2>
    <Summary value={value} />
    {value.state === "awaiting_decision" && (!decision ? <div className="client-orders__actions">
      <button type="button" onClick={() => setDecision("accept")}>同意补差</button>
      <button type="button" onClick={() => setDecision("decline")}>拒绝补差并停送</button>
    </div> : <div>
      <p>{decision === "accept"
        ? `确认同意补差 ${money(value.preview.differenceCents)}？派单人登记实际补款后恢复送心。`
        : `确认停止送心？已送次数保留，应退 ${money(value.preview.refundIfDeclinedCents)}。`}</p>
      <div className="client-orders__actions">
        <button type="button" disabled={busy} onClick={confirm}>{decision === "accept" ? "确认同意补差" : "确认停送"}</button>
        <button type="button" disabled={busy} onClick={() => { setDecision(undefined); setError(""); }}>返回核对</button>
      </div>
    </div>)}
    {error && <p role="alert">{error}</p>}
    {history?.map(item => <details key={item.id}><summary>历次改价 · {new Date(item.submittedAt).toLocaleString("zh-CN")}</summary><Summary value={item} /></details>)}
  </section>;
}
