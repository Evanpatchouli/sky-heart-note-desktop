import { useRef, useState } from "react";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { readClientContext, rememberClientContext } from "./navigation";
import { clientRequest, clientOrdersPath, type OrderSummary } from "./order-api";

const unknownResult = "暂时无法确认取消结果，请重试本次取消。";

export function CancelPendingOrder({ order, onChange }: { order: OrderSummary; onChange: () => void }) {
  const { id, token } = useAuthSession();
  const key = `cancel-before-assignment:${order.clubId}:${order.id}`;
  const [requestId, setRequestId] = useState(() => readClientContext(id, key));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(requestId ? unknownResult : "");
  const inFlight = useRef(false);

  async function cancel() {
    if (inFlight.current || getAppToken("client") !== token) return;
    const actionId = requestId || crypto.randomUUID();
    inFlight.current = true;
    setRequestId(actionId);
    rememberClientContext(id, key, actionId);
    setBusy(true);
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await clientRequest<{ id: string; dispatchStatus: string }>(
        token, `${clientOrdersPath}/${order.id}/cancel-before-assignment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: actionId }),
          signal: controller.signal,
        },
      );
      if (getAppToken("client") !== token) return;
      if (result?.id !== order.id || result.dispatchStatus !== "cancelled") throw new Error(unknownResult);
      rememberClientContext(id, key, "");
      onChange();
    } catch (err) {
      if (getAppToken("client") !== token) return;
      if (err instanceof RequestError && [400, 403, 404, 409].includes(err.status)) {
        rememberClientContext(id, key, "");
        setRequestId(null);
        setConfirming(false);
        setError(err.message);
        if (err.status === 409 || err.status === 404) onChange();
      } else {
        setError(unknownResult);
      }
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <div className="client-orders__detail-actions">
    {error ? <p role="alert">{error}</p> : null}
    {requestId ? <button type="button" disabled={busy} onClick={() => void cancel()}>
      {busy ? "正在取消…" : "重试本次取消"}
    </button> : confirming ? <>
      <button type="button" onClick={() => void cancel()}>确认取消</button>
      <button type="button" onClick={() => setConfirming(false)}>保留订单</button>
    </> : <button type="button" onClick={() => setConfirming(true)}>取消待分配订单</button>}
  </div>;
}
