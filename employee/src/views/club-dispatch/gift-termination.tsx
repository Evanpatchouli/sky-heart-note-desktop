import { useRef, useState, type FormEvent } from "react";
import { Alert, Button, Card, Flex, Input } from "antd";
import { formatCentsAsYuan, parseYuanAsCents, type GiftDispatchSupervision, type GiftTermination } from "@webapp-template/common";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";

const money = (cents: number) => `¥${formatCentsAsYuan(cents)}`;
const date = (value: string) => new Date(value).toLocaleString("zh-CN");

function TerminationFacts({ value }: { value: GiftTermination }) {
  return <>
    <p>已停送 · {date(value.stoppedAt)} · 已送 {value.deliveredGiftTimes} 次，停止 {value.stoppedGiftTimes} 次</p>
    <p>{value.origin === "declined_adjustment" ? "拒绝补差" : value.origin === "customer_request" ? "老板本人提出" : "派单人登记老板线下提出"}</p>
    {value.reason && <p>停送说明 {value.reason}</p>}
    {value.customerRequestReference && <p>线下依据 {value.customerRequestReference}</p>}
    {value.change && <p>登记原因 {value.change.reason} · {date(value.change.recordedAt)} · 经手 {value.change.recordedByUserId}</p>}
    <p>停止付费 {value.stoppedPaidGiftTimes} 次 · 停止促销赠送 {value.stoppedPromotionalGiftTimes} 次</p>
    <p>已履约折后爱心款 {money(value.fulfilledServiceCents)} · 已兑现个人让利 {money(value.fulfilledPersonalDiscountCents)}
      {" · "}已兑现平台优惠 {money(value.fulfilledPlatformDiscountCents)}</p>
    <p>原实收 {money(value.originalReceivedCents)}
      {!!value.continuationReceivedCents && <> · 续段实收 {money(value.continuationReceivedCents)}</>}
      {" · "}实补 {money(value.supplementReceivedCents)} · 净实收 {money(value.netReceivedCents)}</p>
    <p>应退爱心款 {money(value.refundDueCents)} · 实退 {money(value.refundedCents)} · 待退 {money(value.refundRemainingCents)}</p>
    {value.couponStatus && <p>{value.couponStatus === "returned" ? "优惠券已返还" : "优惠券保持已使用"}</p>}
    {!!value.excessRefundCents && <Alert type="warning" showIcon title={`已退比最新应退多 ${money(value.excessRefundCents)}`} />}
    {!!value.refunds.length && <ul aria-label="实退明细">{value.refunds.map(refund => <li key={refund.requestId}>
      实退 {money(refund.amountCents)} · 实际退款 {date(refund.occurredAt)} · 登记 {date(refund.recordedAt)} · 经手 {refund.recordedByUserId}
      {refund.refundDueAtRecordingCents !== undefined && <> · 登记时应退 {money(refund.refundDueAtRecordingCents)}</>}
    </li>)}</ul>}
  </>;
}

export function GiftTerminationPanel({ route, progress, reload }: {
  route: string; progress: GiftDispatchSupervision; reload: () => void;
}) {
  const { token } = useAuthSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pending = useRef<{ key: string; id: string }>(undefined);
  const value = progress.termination;

  async function write(path: "changes" | "refunds", fields: object) {
    if (inFlight.current || getAppToken("employee") !== token) return;
    const key = JSON.stringify([route, path, fields]);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await employeeRequest(`${route}/termination/${path}`, "POST", { ...fields, requestId: pending.current.id });
      if (getAppToken("employee") !== token) return;
      pending.current = undefined;
      setOpen(false);
      reload();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "未收到登记结果，请核对当前记录或使用相同内容重试。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function recordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason")).trim();
    const customerRequestReference = value ? "" : String(form.get("reference")).trim();
    if (!reason || (!value && !customerRequestReference)) return setError("请填写停送原因和所需的线下依据。");
    void write("changes", { expectedRevision: value?.revision ?? 0, reason, ...(customerRequestReference ? { customerRequestReference } : {}) });
  }

  function recordRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value) return;
    const form = new FormData(event.currentTarget);
    const amountCents = parseYuanAsCents(String(form.get("amount")));
    const time = new Date(String(form.get("occurredAt")));
    if (!amountCents || amountCents > value.refundRemainingCents || !Number.isFinite(time.getTime()))
      return setError("请核对实际退款金额、时间和当前待退金额。");
    void write("refunds", { amountCents, occurredAt: time.toISOString(), confirmed: true, terminationId: value.id, expectedRevision: value.revision });
  }

  if (!value && !progress.canRequestTermination) return null;
  const canChange = !progress.closedAt && (!value || value.origin !== "declined_adjustment" && !value.change);
  const canRefund = !progress.closedAt && value?.origin !== "declined_adjustment" && value?.change && value.refundRemainingCents > 0;
  return <Card size="small" title="停送与退款">
    {value && <TerminationFacts value={value} />}
    {canChange && (!open ? <Button onClick={() => setOpen(true)}>{value ? "登记停送原因" : "登记线下停送"}</Button> :
      <form onSubmit={recordChange}>
        {!value && <p><label>老板线下提出停送的依据 <Input name="reference" required maxLength={240} /></label></p>}
        <p><label>停送原因 <Input.TextArea name="reason" required maxLength={240} rows={2} /></label></p>
        <Flex gap="small" wrap>
          <Button type="primary" htmlType="submit" loading={busy}>{value ? "保存停送原因" : "确认停送"}</Button>
          <Button disabled={busy} onClick={() => { setOpen(false); setError(""); }}>返回核对</Button>
        </Flex>
      </form>)}
    {canRefund && <form onSubmit={recordRefund}>
      <p>在线下实际退回款项后登记，可分次记录。</p>
      <Flex gap="small" wrap>
        <label>实际退款金额（元） <Input required name="amount" inputMode="decimal" /></label>
        <label>实际退款时间 <Input required name="occurredAt" type="datetime-local" step={1} /></label>
      </Flex>
      <p><Button type="primary" htmlType="submit" loading={busy}>登记实退</Button></p>
    </form>}
    {error && <Alert type="error" showIcon title={error} />}
  </Card>;
}
