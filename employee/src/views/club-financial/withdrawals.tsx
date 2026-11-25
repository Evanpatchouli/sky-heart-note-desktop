import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Form, InputNumber, Spin, Tag, Typography } from "antd";
import { parseYuanAsCents, type ClubWithdrawal } from "@sky-club/common";
import { RequestError, useAuthSession } from "@sky-club/common/web-auth";
import { employeeRequest } from "#/service/request";
import { requestMessage } from "../club-assignments/types";
import { money, showDate } from "./adjustment-summary";

const status = { pending: "待审批", approved: "已批准，待实付", rejected: "已驳回", paid: "已付清" };

function WithdrawalDetails({ row }: { row: ClubWithdrawal }) {
  const paid = row.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  return <Flex vertical gap="small">
    <div><Tag>{status[row.status]}</Tag><strong>{money(row.amountCents)}</strong> · 团员 {row.memberUserId}</div>
    <Typography.Text type="secondary" copyable>申请 {row.id}</Typography.Text>
    <div>申请时间 {showDate(row.requestedAt)}{row.decidedAt ? ` · 审批 ${row.decidedByUserId ?? ""} ${showDate(row.decidedAt)}` : ""}</div>
    {row.status !== "rejected" ? <div>已实付 {money(paid)} · 待实付 {money(row.amountCents - paid)}</div> : null}
    {row.payments.map(payment => <div key={payment.requestId}>实付 {money(payment.amountCents)} · {showDate(payment.occurredAt)} · 登记人 {payment.recordedByUserId}{payment.transferReference ? ` · 凭据 ${payment.transferReference}` : ""}</div>)}
  </Flex>;
}

function useWithdrawals(path: string) {
  const [items, setItems] = useState<ClubWithdrawal[]>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<{ items: ClubWithdrawal[] }>(path, "GET", undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setItems(data.items); })
      .catch(reason => { if (!controller.signal.aborted) setError(requestMessage(reason)); });
    return () => controller.abort();
  }, [path, revision]);
  return { items, error, refresh: () => setRevision(value => value + 1) };
}

export function Withdrawals({ onSaved }: { onSaved: () => void }) {
  const { id } = useAuthSession();
  const storageKey = `sky-club.withdrawal.request.${id}`;
  const list = useWithdrawals("club/withdrawals");
  const [form] = Form.useForm<{ amount: string }>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [initialRequest] = useState(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      return value && typeof value.requestId === "string" && Number.isSafeInteger(value.amountCents) && value.amountCents > 0 ? value as { requestId: string; amountCents: number } : null;
    } catch { return null; }
  });
  const request = useRef(initialRequest);
  function persist(value: typeof request.current) {
    request.current = value;
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* 页面内仍可重试。 */ }
  }
  useEffect(() => {
    const pending = request.current;
    if (pending && list.items?.some(row => row.requestId === pending.requestId && row.amountCents === pending.amountCents)) {
      persist(null); form.resetFields(); setResult("已核对到上次提现申请。"); onSaved();
    }
  }, [list.items]);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  async function submit({ amount }: { amount: string }) {
    if (lock.current) return;
    const amountCents = parseYuanAsCents(amount);
    if (amountCents === null || amountCents <= 0) return;
    const input = request.current ?? { requestId: crypto.randomUUID(), amountCents };
    persist(input);
    lock.current = true; setBusy(true); setError(""); setResult("");
    try {
      await employeeRequest("club/withdrawals", "POST", input);
      persist(null); form.resetFields(); setResult("提现申请已提交，申请和审批不会扣减余额。");
      list.refresh(); onSaved();
    } catch (reason) {
      if (reason instanceof RequestError && reason.status >= 400 && reason.status < 500 && ![401, 403, 408, 429].includes(reason.status)) persist(null);
      setError(`${requestMessage(reason)}${request.current ? "。请重试同一笔申请，避免重复提交。" : ""}`);
    }
    finally { lock.current = false; setBusy(false); }
  }
  return <Card size="small" title="提现申请" extra={<Button onClick={list.refresh}>刷新进度</Button>}>
    <Flex vertical gap="middle">
      <Typography.Text type="secondary">申请经团长或副团长批准后，由财务线下打款并登记实付，登记后扣减余额。</Typography.Text>
      {initialRequest && request.current ? <Alert type="warning" showIcon title="上次申请结果待确认，请重试原申请以核对。" /> : null}
      <Form form={form} layout="vertical" onFinish={submit} initialValues={initialRequest ? { amount: (initialRequest.amountCents / 100).toFixed(2) } : undefined}>
        <Form.Item name="amount" label="申请金额（元）" rules={[{ required: true, message: "请输入金额" }, { validator: (_, value) => {
          const cents = parseYuanAsCents(value); return cents !== null && cents > 0 ? Promise.resolve() : Promise.reject(new Error("请输入大于零的金额，最多两位小数"));
        } }]}><InputNumber<string> stringMode min="0.01" step="0.01" disabled={busy || !!request.current} /></Form.Item>
        <Button htmlType="submit" type="primary" loading={busy}>{request.current ? "重试申请" : "提交申请"}</Button>
      </Form>
      {error ? <Alert type="error" showIcon title={error} /> : null}{result ? <Alert type="success" showIcon title={result} /> : null}
      {list.error ? <Alert type="error" showIcon title={list.error} /> : !list.items ? <Spin aria-label="加载提现申请" /> : list.items.length ? list.items.map(row => <Card size="small" key={row.id}><WithdrawalDetails row={row} /></Card>) : <Empty description="暂无提现申请" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
    </Flex>
  </Card>;
}

export function WithdrawalReviews() {
  const list = useWithdrawals("club/withdrawals/review");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  async function decide(id: string, decision: "approved" | "rejected") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await employeeRequest(`club/withdrawals/${id}/decision`, "PATCH", { decision }); list.refresh(); }
    catch (reason) { setError(requestMessage(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Flex vertical gap="middle">
    <Button onClick={list.refresh} style={{ alignSelf: "flex-end" }}>刷新审批</Button>
    <Typography.Text type="secondary">批准不会扣减余额，财务登记实际线下打款后才入账。</Typography.Text>
    {error || list.error ? <Alert type="error" showIcon title={error || list.error} /> : null}
    {!list.items ? <Spin aria-label="加载提现审批" /> : list.items.length ? list.items.map(row => <Card size="small" key={row.id}>
      <WithdrawalDetails row={row} />
      {row.status === "pending" ? <Flex gap="small" style={{ marginTop: 12 }}><Button type="primary" disabled={busy} onClick={() => void decide(row.id, "approved")}>批准</Button><Button danger disabled={busy} onClick={() => void decide(row.id, "rejected")}>驳回</Button></Flex> : null}
    </Card>) : <Empty description="暂无提现审批" />}
  </Flex>;
}
