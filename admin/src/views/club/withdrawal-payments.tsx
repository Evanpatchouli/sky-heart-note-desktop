import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Form, Input, InputNumber, Spin, Tag, Typography } from "antd";
import { formatCentsAsYuan, parseYuanAsCents, type ClubWithdrawal } from "@sky-club/common";
import type Resp from "@/models/Resp";
import { createAppRequest } from "@/api/request";
import { useLoginStore } from "@/auth/store";

const api = createAppRequest("/admin/club/withdrawals");
const money = (cents: number) => `¥${formatCentsAsYuan(cents)}`;
const date = (value: string) => new Date(value).toLocaleString("zh-CN");
type PaymentInput = { requestId: string; amountCents: number; occurredAt: string; transferReference?: string };
const paymentKey = (userId: string, withdrawalId: string) => `sky-club.withdrawal.payment.${userId}.${withdrawalId}`;
function readPayment(key: string): PaymentInput | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value && typeof value.requestId === "string" && Number.isSafeInteger(value.amountCents) && value.amountCents > 0 && typeof value.occurredAt === "string" && Number.isFinite(Date.parse(value.occurredAt)) ? value as PaymentInput : null;
  } catch { return null; }
}
function persistPayment(key: string, value: PaymentInput | null) {
  try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* 页面内仍可重试。 */ }
}
const localNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
};

export default function WithdrawalPayments({ onSaved }: { onSaved: () => void }) {
  const userId = useLoginStore(state => state.userInfo?.id) ?? "";
  return <WithdrawalPaymentList key={userId} userId={userId} onSaved={onSaved} />;
}

function WithdrawalPaymentList({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  const [items, setItems] = useState<ClubWithdrawal[]>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string>();
  const refresh = () => { setError(""); setRevision(value => value + 1); };
  useEffect(() => {
    let active = true;
    (async () => {
      const response: Resp<{ items: ClubWithdrawal[] }> = await api.get("");
      const data = response.getData();
      if (!data) throw new Error("提现申请加载失败");
      if (active) {
        let confirmed = false;
        for (const item of data.items) {
          const key = paymentKey(userId, item.id);
          const pending = readPayment(key);
          if (pending && item.payments.some(payment => payment.requestId === pending.requestId && payment.recordedByUserId === userId && payment.amountCents === pending.amountCents && payment.occurredAt === pending.occurredAt && (payment.transferReference ?? "") === (pending.transferReference ?? ""))) { persistPayment(key, null); confirmed = true; }
        }
        if (confirmed) { setSelected(undefined); onSaved(); }
        setItems(data.items);
      }
    })().catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "提现申请加载失败"); });
    return () => { active = false; };
  }, [revision, userId, onSaved]);
  return <Card size="small" title="提现实付登记" extra={<Button onClick={refresh}>刷新申请</Button>}>
    <Flex vertical gap="middle">
      <Typography.Text type="secondary">请在线下实际打款后登记。分次实付收满申请金额后标记付清。</Typography.Text>
      {error ? <Alert type="error" showIcon title={error} /> : !items ? <Spin aria-label="加载提现申请" /> : !items.length ? <Empty description="暂无已批准提现" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : items.map(row => {
        const paid = row.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
        const pending = readPayment(paymentKey(userId, row.id));
        return <Card size="small" key={row.id}>
          <Flex vertical gap="small">
            <div><Tag color={row.status === "paid" ? "green" : "blue"}>{row.status === "paid" ? "已付清" : "待实付"}</Tag>团员 {row.memberUserId} · 申请 {money(row.amountCents)}</div>
            <Typography.Text copyable type="secondary">申请 {row.id}</Typography.Text>
            <div>申请 {date(row.requestedAt)}{row.decidedAt ? ` · 审批 ${row.decidedByUserId ?? ""} ${date(row.decidedAt)}` : ""}</div>
            <div>已实付 {money(paid)} · 待实付 {money(row.amountCents - paid)}</div>
            {row.payments.map(payment => <div key={payment.requestId}>实付 {money(payment.amountCents)} · {date(payment.occurredAt)} · 登记人 {payment.recordedByUserId}{payment.transferReference ? ` · 凭据 ${payment.transferReference}` : ""}</div>)}
            {(row.status === "approved" || pending) && selected !== row.id ? <Button style={{ alignSelf: "flex-start" }} disabled={!!selected} onClick={() => setSelected(row.id)}>{pending ? "核对并重试实付" : "登记实付"}</Button> : null}
            {selected === row.id ? <PaymentForm key={`${userId}.${row.id}`} userId={userId} row={row} remaining={row.amountCents - paid} onSaved={() => { setSelected(undefined); refresh(); onSaved(); }} onCancel={() => setSelected(undefined)} /> : null}
          </Flex>
        </Card>;
      })}
    </Flex>
  </Card>;
}

function PaymentForm({ userId, row, remaining, onSaved, onCancel }: { userId: string; row: ClubWithdrawal; remaining: number; onSaved: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const storageKey = paymentKey(userId, row.id);
  const [initialRequest] = useState(() => readPayment(storageKey));
  const request = useRef<PaymentInput | null>(initialRequest);
  async function submit(fields: { amount: string; occurredAt: string; transferReference?: string }) {
    if (lock.current) return;
    const amountCents = parseYuanAsCents(fields.amount);
    if (amountCents === null || amountCents <= 0 || (!request.current && amountCents > remaining)) return;
    const transferReference = fields.transferReference?.trim();
    const input = request.current ?? { requestId: crypto.randomUUID(), amountCents, occurredAt: new Date(fields.occurredAt).toISOString(), ...(transferReference ? { transferReference } : {}) };
    request.current = input; persistPayment(storageKey, input); lock.current = true; setBusy(true); setError("");
    try { await api.post(`/${encodeURIComponent(row.id)}/payments`, input); request.current = null; persistPayment(storageKey, null); onSaved(); }
    catch (reason) {
      const status = reason && typeof reason === "object" && "status" in reason ? Number(reason.status) : 0;
      if (status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status)) { request.current = null; persistPayment(storageKey, null); }
      setError(`${reason && typeof reason === "object" && "message" in reason ? String(reason.message) : "登记失败"}${request.current ? "。请重试同一笔实付，避免重复登记。" : ""}`);
    }
    finally { lock.current = false; setBusy(false); }
  }
  const localPaymentTime = initialRequest ? (() => { const value = new Date(initialRequest.occurredAt); return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 23); })() : localNow();
  return <Form layout="vertical" initialValues={{ amount: formatCentsAsYuan(initialRequest?.amountCents ?? remaining), occurredAt: localPaymentTime, transferReference: initialRequest?.transferReference }} onFinish={submit}>
    {request.current ? <Alert type="warning" showIcon title="上次实付登记结果待确认，请重试原记录以核对。" style={{ marginBottom: 8 }} /> : null}
    <Form.Item name="amount" label="实际打款金额（元）" rules={[{ required: true, message: "请输入金额" }, { validator: (_, value) => {
      const cents = parseYuanAsCents(value); return cents !== null && cents > 0 && (request.current || cents <= remaining) ? Promise.resolve() : Promise.reject(new Error("请输入大于零且不超过待实付金额的金额，最多两位小数"));
    } }]}><InputNumber<string> stringMode min="0.01" step="0.01" disabled={busy || !!request.current} /></Form.Item>
    <Form.Item name="occurredAt" label="实际打款时间" rules={[{ required: true, message: "请输入实际打款时间" }, { validator: (_, value) => {
      const time = new Date(value).getTime(); return Number.isFinite(time) && (!row.decidedAt || time >= new Date(row.decidedAt).getTime()) && time <= Date.now() ? Promise.resolve() : Promise.reject(new Error("打款时间须在批准后且不晚于当前时间"));
    } }]}><Input type="datetime-local" step="0.001" disabled={busy || !!request.current} /></Form.Item>
    <Form.Item name="transferReference" label="线下打款凭据（选填）"><Input maxLength={240} placeholder="例如打款渠道和流水号" disabled={busy || !!request.current} /></Form.Item>
    <Flex gap="small"><Button type="primary" htmlType="submit" loading={busy}>{request.current ? "重试登记" : "确认登记"}</Button><Button disabled={busy || !!request.current} onClick={onCancel}>取消</Button></Flex>
    {error ? <Alert type="error" showIcon title={error} style={{ marginTop: 8 }} /> : null}
  </Form>;
}
