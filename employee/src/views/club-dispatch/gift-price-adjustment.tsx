import { useRef, useState, type FormEvent } from "react";
import { Alert, Button, Popconfirm } from "antd";
import { formatCentsAsYuan, parseYuanAsCents, type GiftDispatchSupervision, type GiftPriceAdjustment, type GiftPricePreview } from "@webapp-template/common";
import { RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";

const periods = { normal: "普通期", double: "双倍期" };
const stateLabels = {
  awaiting_decision: "待老板答复", awaiting_supplement: "已同意，待登记实际补款",
  continuing: "已登记实补，可续送", stopped: "已拒补停送",
  needs_requote: "过去的履约记录已更新，原改价方案失效，待重新核对",
  superseded: "原改价方案已失效，已恢复按现有约定履约",
};
const unavailable = {
  no_price_change: "每次单价相同，到账倍率变化的价差为零。",
  lower_price: "已付款订单的剩余次数不办理降价。",
  adjustment_unavailable: "请核对老板账号、当前改价和订单状态。",
};

function money(cents: number | null) {
  return cents === null ? "待核对" : `${cents < 0 ? "−" : ""}¥${formatCentsAsYuan(Math.abs(cents))}`;
}

function localTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

function PriceComparison({ preview }: { preview: GiftPricePreview }) {
  return <>
    <p>原报价 {money(preview.originalQuoteCents)} · 试算时已登记实收 {money(preview.cumulativeReceivedCents)} · 改价前报价 {money(preview.currentQuoteCents)}</p>
    <p>已送 {preview.deliveredGiftTimes} 次 · 剩余 {preview.remainingGiftTimes} 次 · 实际到账 {preview.actualReceivedHearts ?? "待核对"} {preview.actualReceivedHearts === null ? "" : "颗"}</p>
    <p>第 {preview.quoteSegment} 段涉及 {preview.giftTimes} 次 · {periods[preview.originalPeriod]} {money(preview.originalUnitPriceCents)}/次 → {periods[preview.targetPeriod]} {money(preview.targetUnitPriceCents)}/次</p>
    <p>拟总价 {money(preview.proposedTotalCents)} · 拟差额 {money(preview.differenceCents)} · 如拒补停送应退 {money(preview.refundIfDeclinedCents)}</p>
  </>;
}

function PriceRecord({ value }: { value: GiftPriceAdjustment }) {
  return <>
    <p>{stateLabels[value.state]} · 发起人 {value.submittedByUserId} · {new Date(value.submittedAt).toLocaleString("zh-CN")}</p>
    <p>改价原因：{value.reason}</p>
    <PriceComparison preview={value.preview} />
    {value.decision && <p>{value.decision.source === "customer" ? "老板本人答复" : "派单人登记的线下协商"} ·
      {value.decision.value === "accept" ? " 同意补差" : " 拒绝补差并停送"} · {new Date(value.decision.decidedAt).toLocaleString("zh-CN")}
      {value.decision.evidence && ` · ${value.decision.evidence}`}</p>}
    <p>原实收 {money(value.originalReceivedCents)} · 累计实补 {money(value.supplementReceivedCents)} · 应退 {money(value.refundDueCents)}
      {" · "}实退 {money(value.refundedCents)} · 净实收 {money(value.netReceivedCents)}</p>
    {value.state === "stopped" && value.latestFactChange && <p>已按最新有效日报重新核对应退。</p>}
    {value.state === "stopped" && value.refundedCents > value.refundDueCents &&
      <Alert type="warning" showIcon title={`已退超出最新应退 ${money(value.refundedCents - value.refundDueCents)}，已保留实际退款记录。`} />}
    {value.newQuoteSegment && <p>本次改价续送使用第 {value.newQuoteSegment} 段。</p>}
    {!!value.payments.length && <ul>{value.payments.map(payment => <li key={payment.requestId}>
      {payment.kind === "supplement" ? "实补" : "实退"} {money(payment.amountCents)} · {new Date(payment.occurredAt).toLocaleString("zh-CN")}
      {" · "}登记人 {payment.recordedByUserId} · {payment.reason}
      {payment.refundDueAtRecordingCents !== undefined && ` · 登记时应退 ${money(payment.refundDueAtRecordingCents)}`}
    </li>)}</ul>}
  </>;
}

export function GiftPriceAdjustmentPanel({ route, progress, reload }: {
  route: string; progress: GiftDispatchSupervision; reload: () => void;
}) {
  const { id } = useAuthSession();
  const [preview, setPreview] = useState<GiftPricePreview>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const pending = useRef<{ payload: string; requestId: string }>(undefined);
  const { priceAdjustment: current, priceAdjustmentHistory: history, promotionBasis: accounting } = progress;
  const segmentOptions = progress.segments.filter(segment => segment.paidGiftTimes && segment.remainingGiftTimes);
  const [selected, setSelected] = useState(segmentOptions[0]?.segmentIndex);
  const segment = segmentOptions.find(item => item.segmentIndex === selected) ?? segmentOptions[0];
  const mayPropose = (progress.canRequestContinuation || current?.state === "needs_requote") && !!segment;
  const actions = current && { adjustmentId: current.id, expectedRevision: current.revision };
  const storageKey = `sky-heart.employee.gift-price:${id}:${route}`;

  async function submit<T>(path: string, fields: object, receive: (result: T) => void, write = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const payload = JSON.stringify([path, fields]);
    if (write) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (saved?.payload === payload && typeof saved.requestId === "string") pending.current = saved;
      } catch { /* Storage is optional. */ }
      if (pending.current?.payload !== payload) pending.current = { payload, requestId: crypto.randomUUID() };
      try { sessionStorage.setItem(storageKey, JSON.stringify(pending.current)); } catch { /* Storage is optional. */ }
    }
    try {
      const result = await employeeRequest<T>(route + path, "POST", write ? { ...fields, requestId: pending.current!.requestId } : fields);
      if (write) {
        pending.current = undefined;
        try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ }
      }
      receive(result);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "未收到提交结果，请用原内容重试。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function previewPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const targetUnitPriceCents = parseYuanAsCents(String(data.get("unitPrice")));
    if (targetUnitPriceCents === null) return setError("每次单价须为有效金额，最多两位小数。");
    void submit<GiftPricePreview>("/fulfillment/price-preview", {
      quoteSegment: Number(data.get("quoteSegment")), giftTimes: Number(data.get("giftTimes")),
      targetPeriod: data.get("targetPeriod"), targetUnitPriceCents,
    }, setPreview);
  }

  function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || !("version" in preview.adjustmentReview)) return;
    const { quoteSegment, giftTimes, targetPeriod, targetUnitPriceCents } = preview;
    const reason = String(new FormData(event.currentTarget).get("reason")).trim();
    if (!reason) return setError("请填写改价原因。");
    void submit("/price-adjustment", {
      quoteSegment, giftTimes, targetPeriod, targetUnitPriceCents, expectedVersion: preview.adjustmentReview.version, reason,
    }, reload, true);
  }

  function recordPayment(event: FormEvent<HTMLFormElement>, kind: "supplement" | "refund") {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = parseYuanAsCents(String(form.get("amount")));
    if (amountCents === null || amountCents < 1) return setError("请填写实际发生的有效金额。");
    const reason = String(form.get("reason")).trim();
    void submit("/price-adjustment/payments", {
      ...actions, kind, amountCents, occurredAt: new Date(String(form.get("occurredAt"))).toISOString(),
      ...(reason ? { reason } : {}),
    }, reload, true);
  }

  if (!current && !mayPropose) return null;
  const paymentKind = current?.state === "awaiting_supplement" ? "supplement" :
    current?.state === "stopped" && current.refundDueCents > current.refundedCents ? "refund" : null;
  const payable = paymentKind === "supplement" ? current!.preview.differenceCents! :
    current ? current.refundDueCents - current.refundedCents : 0;
  return <section aria-label="已付款订单改价">
    <h3>已付款订单改价</h3>
    {error && <Alert type="error" showIcon title={error} />}
    {current && <PriceRecord value={current} />}
    {current && accounting && <p>现有履约核对 · 爱心款 {money(accounting.customerServiceCents)} · 送心报酬合计 {money(accounting.memberFeeCents)}
      {" · "}派抽 {money(accounting.dispatchFeeCents)} · 团抽 {money(accounting.clubFeeCents)}</p>}
    {history?.map(item => <details key={item.id}><summary>历次改价 · {new Date(item.submittedAt).toLocaleString("zh-CN")}</summary><PriceRecord value={item} /></details>)}
    {mayPropose && <Button onClick={() => setOpen(value => !value)} aria-expanded={open}>
      {open ? "收起改价试算" : current?.state === "needs_requote" ? "重新试算改价" : "试算剩余次数改价"}
    </Button>}
    {current?.state === "needs_requote" && <Popconfirm title="按现有约定恢复履约？" okText="恢复履约" cancelText="取消"
      onConfirm={() => submit("/price-adjustment/resume", actions!, reload, true)}>
      <Button loading={busy}>按现有约定恢复履约</Button>
    </Popconfirm>}
    {mayPropose && open && <>
      <form onSubmit={previewPrice} onChange={() => setPreview(undefined)}>
        <p><label>原计价段 <select name="quoteSegment" value={segment!.segmentIndex + 1}
          onChange={event => setSelected(Number(event.target.value) - 1)} disabled={busy}>
          {segmentOptions.map(item => <option key={item.segmentIndex} value={item.segmentIndex + 1}>
            第 {item.segmentIndex + 1} 段 · {periods[item.period]} · {money(item.unitPriceCents)}/次 · 剩 {item.remainingGiftTimes} 次
          </option>)}
        </select></label></p>
        <fieldset key={segment!.segmentIndex} disabled={busy}>
          <p><label>涉及未送的付费次数 <input required name="giftTimes" type="number" min={1} max={segment!.remainingGiftTimes} defaultValue={segment!.remainingGiftTimes} /></label></p>
          <p><label>目标时段 <select name="targetPeriod" defaultValue={segment!.period}><option value="normal">普通期</option><option value="double">双倍期</option></select></label></p>
          <p><label>目标每次单价（元） <input required name="unitPrice" inputMode="decimal" defaultValue={formatCentsAsYuan(segment!.unitPriceCents)} /></label></p>
        </fieldset>
        <Button htmlType="submit" loading={busy}>核对价差</Button>
      </form>
      {preview && <PriceComparison preview={preview} />}
      {preview && "unavailable" in preview.adjustmentReview && <p>{unavailable[preview.adjustmentReview.unavailable]}</p>}
      {preview && "version" in preview.adjustmentReview && <form onSubmit={propose}>
        <p><label>改价原因 <textarea name="reason" required maxLength={240} /></label></p>
        <Button type="primary" htmlType="submit" loading={busy}>提交改价协商</Button>
      </form>}
    </>}
    {current?.state === "awaiting_decision" && <details>
      <summary>登记实际发生的线下协商</summary>
      <form onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const evidence = String(form.get("evidence")).trim();
        if (!evidence) return setError("请填写可追溯的线下协商依据。");
        void submit("/price-adjustment/decision", {
          ...actions, decision: form.get("decision"), evidence,
          occurredAt: new Date(String(form.get("occurredAt"))).toISOString(),
        }, reload, true);
      }}>
        <p><label>线下协商结果 <select name="decision"><option value="accept">同意补差</option><option value="decline">拒绝补差并停送</option></select></label></p>
        <p><label>实际协商时间 <input name="occurredAt" type="datetime-local" step={1} required defaultValue={localTime()} /></label></p>
        <p><label>线下协商依据 <textarea name="evidence" required maxLength={240} placeholder="例如经老板明确答复的渠道或可查编号" /></label></p>
        <Button htmlType="submit" loading={busy}>保存线下协商记录</Button>
      </form>
    </details>}
    {paymentKind && <form onSubmit={event => recordPayment(event, paymentKind)}>
      <p><label>实际{paymentKind === "refund" ? "退款" : "补款"}金额（元） <input required name="amount" inputMode="decimal" defaultValue={formatCentsAsYuan(payable)} /></label></p>
      <p><label>实际发生时间 <input name="occurredAt" type="datetime-local" step={1} required defaultValue={localTime()} /></label></p>
      <p><label>登记说明（选填） <input name="reason" maxLength={240} placeholder={current!.reason} /></label></p>
      <Button type="primary" htmlType="submit" loading={busy}>{paymentKind === "refund" ? "登记实际退款" : "登记实际补款"}</Button>
    </form>}
  </section>;
}
