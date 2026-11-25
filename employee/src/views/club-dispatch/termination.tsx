import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Flex, Form, Input, Select, Tag, Typography } from "antd";
import {
  formatCentsAsYuan, parseYuanAsCents, terminationReviewLabel, type DispatchTermination, type TerminationHeartRule,
} from "@sky-club/common";
import { getAppToken, RequestError, useAuthSession } from "@sky-club/common/web-auth";
import { employeeRequest } from "#/service/request";
import { actualPeriodLabels } from "#/components/ClubDeliveryPeriods";

type Write = { path: "changes" | "refunds"; body: Record<string, unknown> };
type Change = {
  reason: string;
  heartRule: TerminationHeartRule;
  customerRequestReference?: string;
  priorPostingReference?: string;
};

function pendingWrite(key: string): Write | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (value && ["changes", "refunds"].includes(value.path) && typeof value.body?.requestId === "string") return value;
  } catch { /* 当前页面仍可提交。 */ }
}

function money(value: number | null) {
  return value === null ? "待核对" : `¥${formatCentsAsYuan(value)}`;
}

export default function DispatchTerminationPanel({ route, termination, mayRecord, historical, onRefresh }: {
  route: string;
  termination?: DispatchTermination;
  mayRecord: boolean;
  historical: boolean;
  onRefresh: () => void;
}) {
  const { id, token } = useAuthSession();
  const key = `sky-club.dispatch-termination.v1:${id}:${route}`;
  const [pending, setPending] = useState(() => pendingWrite(key));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<AbortController>(undefined);
  useEffect(() => () => active.current?.abort(), []);

  function keep(value?: Write) {
    setPending(value);
    try {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    } catch { /* 当前页面仍可重试。 */ }
  }

  async function submit(write: Write) {
    if (active.current || historical || getAppToken("employee") !== token) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    active.current = controller;
    setSaving(true);
    setError("");
    keep(write);
    try {
      const reply = await employeeRequest<DispatchTermination>(`${route}/termination/${write.path}`, "POST", write.body, controller.signal);
      if (getAppToken("employee") !== token) return;
      if (!reply?.id) throw new Error("未收到记录回执");
      keep();
      onRefresh();
    } catch (err) {
      if (getAppToken("employee") !== token) return;
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

  function saveChange(values: Change) {
    const { customerRequestReference, priorPostingReference, ...change } = values;
    void submit({
      path: "changes",
      body: {
        ...change, requestId: crypto.randomUUID(), expectedRevision: termination?.revision ?? 0,
        ...(customerRequestReference?.trim() ? { customerRequestReference: customerRequestReference.trim() } : {}),
        ...(priorPostingReference?.trim() ? { priorPostingReference: priorPostingReference.trim() } : {}),
      },
    });
  }

  const disabled = historical || !!pending || saving;
  const stopped = !!termination;
  if (!stopped && !mayRecord && !pending) return null;
  const declined = termination?.origin === "declined_adjustment";
  const onlyPriorPosting = !!termination?.change?.customerConfirmedAt || declined;
  const showChange = !historical && (mayRecord || stopped) && !(onlyPriorPosting && termination?.priorPostingReference);
  const refundRemaining = termination?.refundRemainingCents ?? 0;
  const canRefund = termination && refundRemaining > 0 && !termination.review.includes("late_reports_pending");
  return <Card title="停送与退款" size="small">
    <Flex vertical gap="small">
      {termination ? <TerminationDetails stop={termination} /> : null}
      {pending && !historical ? <Alert type="warning" title="提交结果待确认"
        action={<Button loading={saving} onClick={() => void submit(pending)}>重试本次提交</Button>} /> : null}
      {error ? <Alert type="error" title={error} action={<Button onClick={onRefresh}>刷新核对</Button>} /> : null}
      {showChange ? <details>
        <summary>{onlyPriorPosting ? "登记已有入账待核依据" : stopped ? "登记停送变更" : "登记线下已收到的停送请求"}</summary>
        <Form<Change> layout="vertical" disabled={disabled} onFinish={saveChange}
          initialValues={declined || onlyPriorPosting ? { heartRule: "original_paid" } : undefined}>
          <Form.Item name="reason" label="变更原因" rules={[{ required: true, whitespace: true, message: "请填写变更原因" }]}>
            <Input.TextArea maxLength={240} autoSize />
          </Form.Item>
          {!stopped ? <Form.Item name="customerRequestReference" label="实际收到客户停送的凭据"
            rules={[{ required: true, whitespace: true, message: "请填写已收到请求的日期、渠道或可追溯编号" }]}>
            <Input maxLength={240} />
          </Form.Item> : null}
          <Form.Item name="heartRule" label="未送付费心款约定" hidden={declined || onlyPriorPosting} rules={[{ required: true, message: "请选择本单约定" }]}>
            <Select options={[{ value: "original_paid", label: "按原付款核对未送付费心退款" }, { value: "pending_review", label: "心款退法仍待核对" }]} />
          </Form.Item>
          {!termination?.priorPostingReference ? <Form.Item name="priorPostingReference" label={onlyPriorPosting ? "已有入账凭据" : "已有入账凭据（如适用）"}
            rules={onlyPriorPosting ? [{ required: true, whitespace: true }] : []}>
            <Input maxLength={240} />
          </Form.Item> : null}
          <Button type="primary" htmlType="submit" style={{ minHeight: 44 }}>{onlyPriorPosting ? "保存待核依据" : stopped ? "提交停送变更" : "确认登记线下停送"}</Button>
        </Form>
      </details> : null}
      {canRefund && !historical ? <details>
        <summary>登记实际退款</summary>
        <Form layout="vertical" disabled={disabled} onFinish={({ amount, time, confirmed }) => {
          const amountCents = parseYuanAsCents(amount);
          const occurredAt = new Date(time);
          if (!confirmed || amountCents === null || amountCents <= 0 || amountCents > refundRemaining || !Number.isFinite(occurredAt.getTime())) return;
          void submit({
            path: "refunds",
            body: {
              requestId: crypto.randomUUID(), terminationId: termination.id, expectedRevision: termination.revision,
              amountCents, occurredAt: occurredAt.toISOString(), confirmed: true,
            },
          });
        }}>
          <Form.Item label="本次实际退回（元）" name="amount" rules={[{
            validator: (_, value) => {
              const cents = parseYuanAsCents(value);
              return cents !== null && cents > 0 && cents <= refundRemaining
                ? Promise.resolve() : Promise.reject(new Error(`请输入实际退回金额，最多 ${money(refundRemaining)}。`));
            },
          }]}><Input inputMode="decimal" /></Form.Item>
          <Form.Item label="实际退款时间" name="time" rules={[{ required: true, message: "请选择实际退款时间" }]}>
            <Input type="datetime-local" step={1} />
          </Form.Item>
          <Form.Item name="confirmed" valuePropName="checked" rules={[{
            validator: (_, value) => value ? Promise.resolve() : Promise.reject(new Error("请核对实退事实")),
          }]}><Checkbox>已核对该笔款项实际退给客户</Checkbox></Form.Item>
          <Button type="primary" htmlType="submit" style={{ minHeight: 44 }}>确认登记实际退款</Button>
        </Form>
      </details> : null}
    </Flex>
  </Card>;
}

function TerminationDetails({ stop }: { stop: DispatchTermination }) {
  return <>
    <Flex wrap gap="small">
      <Tag color="warning">停送 {stop.stoppedHearts} 颗</Tag>
      <Typography.Text>{new Date(stop.stoppedAt).toLocaleString("zh-CN")}</Typography.Text>
    </Flex>
    {stop.reason ? <Typography.Text>停送说明 {stop.reason}</Typography.Text> : null}
    {stop.customerRequestReference ? <Typography.Text>线下客户请求依据 {stop.customerRequestReference}</Typography.Text> : null}
    {stop.change ? <Typography.Text>变更原因 {stop.change.reason} · {stop.change.customerConfirmedAt ? "客户已确认" : "客户约定待确认"}</Typography.Text> : null}
    {stop.priorPostingReference ? <Typography.Text>已有入账待核依据 {stop.priorPostingReference} · {stop.priorPostingReason}</Typography.Text> : null}
    <dl className="club-order-facts">
      <div><dt>原实收</dt><dd>{money(stop.originalReceivedCents)}</dd></div>
      <div><dt>实际补款</dt><dd>{money(stop.supplementReceivedCents)}</dd></div>
      <div><dt>原付未送心款</dt><dd>{money(stop.originalUnfulfilledCents)}</dd></div>
      {stop.supplementUnfulfilledCents ? <div><dt>未履约补款</dt><dd>{money(stop.supplementUnfulfilledCents)}</dd></div> : null}
      <div><dt>可核对应退</dt><dd>{money(stop.refundDueCents)}</dd></div>
      <div><dt>实际已退</dt><dd>{money(stop.refundedCents)}</dd></div>
      <div><dt>上述应退尚待退</dt><dd>{money(stop.refundRemainingCents)}</dd></div>
      <div><dt>当前净实收</dt><dd><strong>{money(stop.netReceivedCents)}</strong></dd></div>
    </dl>
    {stop.review.length ? <ul className="club-report-terms">{stop.review.map(item => <li key={item}>{terminationReviewLabel[item]}</li>)}</ul> : null}
    {stop.segments.length ? <details>
      <summary>查看停送时的原计价及实绩依据</summary>
      <ul className="club-report-terms">{stop.segments.map(row => <li key={row.number}>
        第 {row.number} 段 · {actualPeriodLabels[row.period]} · 实到 {row.observedHearts} 颗 · 未履约 {row.unfulfilledHearts} 颗 · 原付 {money(row.originalUnitPriceCents)}/颗
        {row.effectiveUnitPriceCents !== row.originalUnitPriceCents ? ` · 已生效 ${money(row.effectiveUnitPriceCents)}/颗` : ""}
      </li>)}</ul>
    </details> : null}
    {stop.refunds.length ? <details>
      <summary>查看实际退款记录（{stop.refunds.length} 笔）</summary>
      <ul className="club-report-terms">{stop.refunds.map(refund => <li key={refund.id}>
        {money(refund.amountCents)} · {new Date(refund.occurredAt).toLocaleString("zh-CN")} · 登记人 {refund.recordedByUserId}
      </li>)}</ul>
    </details> : null}
  </>;
}
