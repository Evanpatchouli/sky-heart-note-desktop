import { useEffect, useId, useRef, useState } from "react";
import { formatCentsAsYuan, isGiftOrderProgress, terminationReviewLabel, type OrderTermination } from "@sky-club/common";
import { getAppToken, RequestError, useAuthSession } from "@sky-club/common/web-auth";
import { clientRequest, clientOrdersPath, type Order } from "./order-api";

function money(cents: number | null) {
  return cents === null ? "待核对" : `¥${formatCentsAsYuan(cents)}`;
}

export function TerminationFacts({ stop }: { stop: OrderTermination }) {
  return <section aria-label="停送与退款">
    <h3>停送与退款</h3>
    <p>停送时间 {new Date(stop.stoppedAt).toLocaleString("zh-CN")}</p>
    {stop.reason ? <p>停送说明 {stop.reason}</p> : null}
    {stop.change ? <p>变更说明 {stop.change.reason} · {stop.change.customerConfirmedAt ? "已确认约定" : "待确认约定"}</p> : null}
    <dl>
      <dt>原实付</dt><dd>{money(stop.originalReceivedCents)}</dd>
      <dt>实际补款</dt><dd>{money(stop.supplementReceivedCents)}</dd>
      <dt>原付未送心款</dt><dd>{money(stop.originalUnfulfilledCents)}</dd>
      {stop.supplementUnfulfilledCents ? <><dt>未履约补款</dt><dd>{money(stop.supplementUnfulfilledCents)}</dd></> : null}
      <dt>可核对应退</dt><dd>{money(stop.refundDueCents)}</dd>
      <dt>实际已退</dt><dd>{money(stop.refundedCents)}</dd>
      <dt>上述应退尚待退</dt><dd>{money(stop.refundRemainingCents)}</dd>
      <dt>当前净付</dt><dd><strong>{money(stop.netReceivedCents)}</strong></dd>
    </dl>
    {stop.review.length ? <ul>{stop.review.map(item => <li key={item}>{terminationReviewLabel[item]}</li>)}</ul> : null}
    {stop.refunds.length ? <details>
      <summary>查看退款记录（{stop.refunds.length} 笔）</summary>
      <ul>{stop.refunds.map(refund => <li key={refund.id}>{money(refund.amountCents)} · {new Date(refund.occurredAt).toLocaleString("zh-CN")}</li>)}</ul>
    </details> : null}
  </section>;
}

type Write = { kind: "request" | "confirm"; requestId: string; terminationId?: string; expectedRevision?: number; reason?: string };

function readPending(key: string): Write | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (value && ["request", "confirm"].includes(value.kind) && typeof value.requestId === "string") return value;
  } catch { /* 当前页面仍可提交。 */ }
}

export function TerminationActions({ order, reload }: { order: Order; reload: () => void }) {
  const { id, token } = useAuthSession();
  const key = `sky-club.termination.v1:${id}:${order.clubId}:${order.id}`;
  const [pending, setPending] = useState(() => readPending(key));
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController>(undefined);
  const heading = useId();
  useEffect(() => () => active.current?.abort(), []);
  const { deliveryProgress } = order;
  if (!deliveryProgress || isGiftOrderProgress(deliveryProgress)) return null;
  const stop = order.termination;
  const confirmTerms = !!stop?.change && !stop.change.customerConfirmedAt && !stop.review.includes("customer_not_linked");
  const mayStop = !stop && order.dispatchStatus === "published" && deliveryProgress.remainingHearts > 0 &&
    order.priceAdjustment?.state !== "awaiting_customer";

  function keep(value?: Write) {
    setPending(value);
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch { /* 当前页面仍可重试。 */ }
  }

  async function send(value: Write) {
    if (active.current || getAppToken("client") !== token) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    active.current = controller;
    setSaving(true);
    setError("");
    keep(value);
    const { kind, ...body } = value;
    try {
      const reply = await clientRequest<OrderTermination>(token,
        `${clientOrdersPath}/${order.id}/termination${kind === "confirm" ? "/confirmation" : ""}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ ...body, confirmed: true }),
        });
      if (getAppToken("client") !== token) return;
      if (!reply?.id || (kind === "confirm" && !reply.change?.customerConfirmedAt)) throw new Error("未收到停送回执");
      keep();
      reload();
    } catch (err) {
      if (getAppToken("client") !== token) return;
      if (err instanceof RequestError && [400, 403, 404, 409].includes(err.status)) {
        keep();
        setError(err.message);
      } else setError("提交结果待确认，请检查网络后重试本次提交。");
    } finally {
      window.clearTimeout(timeout);
      active.current = undefined;
      setSaving(false);
    }
  }

  if (!pending && !mayStop && !confirmTerms && !error) return null;
  return <div className="client-orders__detail-actions client-orders__actions">
    {pending ? <button type="button" disabled={saving} onClick={() => void send(pending)}>重试本次提交</button>
      : mayStop || confirmTerms ? <button type="button" onClick={() => dialog.current?.showModal()}>
        {confirmTerms ? "核对退款约定" : "申请退单"}
      </button> : null}
    {error ? <p role="alert">{error} <button type="button" onClick={reload}>刷新核对</button></p> : null}
    <dialog className="client-orders__dialog" ref={dialog} aria-labelledby={heading}>
      <h3 id={heading}>{confirmTerms ? "确认本单退款约定？" : "确认退单并停止送心？"}</h3>
      {confirmTerms && stop?.change ? <>
        <p>{stop.change.reason}</p>
        <p>{stop.change.heartRule === "original_paid" ? `未送的付费心按原付款核对退款。原付未送心款 ${money(stop.originalUnfulfilledCents)}。` : "未履约心款退法仍待双方核对。"}</p>
        <p>派单人会在款项实际退回后登记。</p>
      </> : <>
        <p>确认后停止余下 {deliveryProgress.remainingHearts} 颗的送心和领取，保留已到账 {deliveryProgress.observedHearts} 颗及已有履约记录。派单人会与您核对应退金额。</p>
        <label className="client-orders__field">退单说明（选填）<input maxLength={240} value={reason} onChange={event => setReason(event.target.value)} /></label>
      </>}
      <form method="dialog" className="client-orders__actions client-orders__dialog-actions">
        <button type="submit">返回</button>
        <button type="submit" className="client-orders__primary" onClick={() => {
          const requestId = crypto.randomUUID();
          const explanation = reason.trim();
          void send(confirmTerms && stop
            ? { kind: "confirm", requestId, terminationId: stop.id, expectedRevision: stop.revision }
            : { kind: "request", requestId, ...(explanation ? { reason: explanation } : {}) });
        }}>{confirmTerms ? "确认退款约定" : "确认退单并停送"}</button>
      </form>
    </dialog>
  </div>;
}
