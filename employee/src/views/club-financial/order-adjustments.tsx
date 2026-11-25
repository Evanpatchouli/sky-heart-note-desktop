import { useEffect, useState } from "react";
import { Alert, Button, Card, Descriptions, Empty, Flex, Form, Input, Modal, Select, Spin, Typography } from "antd";
import dayjs from "dayjs";
import { formatCentsAsYuan, parseYuanAsCents, type ClubAdjustmentKind, type ClubAdjustmentRecord,
  type OrderAdjustmentList, type RecordCompensationRefund, type RequestClubAdjustment } from "@webapp-template/common";
import { employeeRequest } from "#/service/request";
import { requestMessage } from "../club-assignments/types";
import { AdjustmentSummary, money, showDate } from "./adjustment-summary";

type RequestFields = { memberUserId?: string; amount: string; reason: string };
type RefundFields = { amount: string; occurredAt: string; evidence?: string };
type AdjustmentAction = { requestId: string } & ({ kind: ClubAdjustmentKind } | { refund: ClubAdjustmentRecord });

export default function OrderAdjustments({ orderRoute, onChanged }: { orderRoute: string; onChanged: () => void }) {
  const route = `${orderRoute}/financial-adjustments`;
  const [data, setData] = useState<OrderAdjustmentList>();
  const [action, setAction] = useState<AdjustmentAction>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [success, setSuccess] = useState("");
  const refresh = () => setAttempt(value => value + 1);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<OrderAdjustmentList>(route, "GET", undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(requestMessage(reason)); });
    return () => controller.abort();
  }, [route, attempt]);

  function open(next: Omit<Extract<AdjustmentAction, { kind: string }>, "requestId"> | { refund: ClubAdjustmentRecord }) {
    setSuccess("");
    setAction({ ...next, requestId: crypto.randomUUID() });
  }

  function saved(record: ClubAdjustmentRecord) {
    setData(previous => previous ? {
      ...previous,
      records: previous.records.some(row => row.id === record.id)
        ? previous.records.map(row => row.id === record.id ? record : row)
        : [record, ...previous.records],
    } : previous);
    setSuccess(record.status === "pending" ? "申请已提交" : "实退已登记");
    setAction(undefined);
    refresh();
    onChanged();
  }

  return <Card size="small" title="额外补偿与罚款" extra={<Button size="small" onClick={refresh}>刷新调整</Button>}>
    {error ? <Alert type="error" showIcon title={error} /> : !data ? <Spin aria-label="加载资金调整" /> :
      <Flex vertical gap="middle">
        {data.canRequest ? <Flex gap="small" wrap="wrap">
          {data.canRequestPenalty ? <Button onClick={() => open({ kind: "member_penalty" })}>申请罚款</Button> : null}
          <Button onClick={() => open({ kind: "customer_compensation" })}>申请额外补偿</Button>
        </Flex> : null}
        {success ? <Alert type="success" showIcon title={success} /> : null}
        {data.records.length ? data.records.map(row => {
          const refunded = row.refunds.reduce((total, item) => total + item.amountCents, 0);
          const compensation = row.kind === "customer_compensation" && row.status === "approved";
          return <Card key={row.id} size="small">
            <AdjustmentSummary row={row} names={data.memberNames} />
            {compensation ? <Flex vertical gap="small">
              <Descriptions size="small" column={1} items={[
                { key: "paid", label: "已实退", children: money(refunded) },
                { key: "remaining", label: "待退", children: money(Math.max(0, row.amountCents - refunded)) },
              ]} />
              {row.refunds.map(refund => <Typography.Text key={refund.requestId}>
                {money(refund.amountCents)} · {showDate(refund.occurredAt)} · {refund.evidence ?? "已登记"}
              </Typography.Text>)}
              {refunded < row.amountCents ? <Button style={{ alignSelf: "flex-start" }} onClick={() => open({ refund: row })}>登记实退</Button> : null}
            </Flex> : null}
          </Card>;
        }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无额外补偿或罚款" />}
      </Flex>}
    {data && action ? "kind" in action ? <RequestAdjustment key={action.requestId} route={route} action={action}
      data={data} close={() => setAction(undefined)} onSaved={saved} />
      : <RefundAdjustment key={action.requestId} route={route} action={action} close={() => setAction(undefined)} onSaved={saved} /> : null}
  </Card>;
}

function RequestAdjustment({ route, action, data, close, onSaved }: {
  route: string;
  action: Extract<AdjustmentAction, { kind: string }>;
  data: OrderAdjustmentList;
  close: () => void;
  onSaved: (record: ClubAdjustmentRecord) => void;
}) {
  const [form] = Form.useForm<RequestFields>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const penalty = action.kind === "member_penalty";

  async function submit(fields: RequestFields) {
    const amountCents = parseYuanAsCents(fields.amount);
    if (!amountCents || busy) return;
    const input: RequestClubAdjustment = { ...action, amountCents, reason: fields.reason.trim(),
      ...(penalty ? { memberUserId: fields.memberUserId } : {}) };
    setBusy(true);
    setError("");
    try {
      onSaved(await employeeRequest<ClubAdjustmentRecord>(route, "POST", input));
    } catch (reason) {
      setError(requestMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return <Modal open title={penalty ? "申请罚款" : "申请额外补偿"} okText="提交申请" cancelText="取消"
    onOk={form.submit} onCancel={() => { if (!busy) close(); }} confirmLoading={busy}>
    <Form form={form} layout="vertical" onFinish={submit} disabled={busy}>
      {penalty ? <Form.Item name="memberUserId" label="责任团员" rules={[{ required: true, message: "请选择责任团员" }]}>
        <Select showSearch={{ optionFilterProp: "label" }} options={data.candidates.map(({ userId, nickname }) => ({
          value: userId, label: nickname ? `${nickname} · ${userId}` : userId,
        }))} />
      </Form.Item> : <Typography.Paragraph>补偿退给本单老板，由团费承担。获批后请在线下退款，再登记实退。</Typography.Paragraph>}
      <Form.Item name="amount" label={penalty ? "罚款金额（元）" : "补偿金额（元）"} rules={[{ validator: (_, value) => validateAmount(value) }]}>
        <Input inputMode="decimal" />
      </Form.Item>
      <Form.Item name="reason" label={penalty ? "罚款原因" : "补偿原因"} rules={[{ required: true, whitespace: true, message: "请填写原因" }]}>
        <Input.TextArea maxLength={240} />
      </Form.Item>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Form>
  </Modal>;
}

function RefundAdjustment({ route, action, close, onSaved }: {
  route: string;
  action: Extract<AdjustmentAction, { refund: ClubAdjustmentRecord }>;
  close: () => void;
  onSaved: (record: ClubAdjustmentRecord) => void;
}) {
  const [form] = Form.useForm<RefundFields>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const row = action.refund;
  const remaining = row.amountCents - row.refunds.reduce((total, item) => total + item.amountCents, 0);

  async function submit(fields: RefundFields) {
    const amountCents = parseYuanAsCents(fields.amount);
    if (!amountCents || busy) return;
    const evidence = fields.evidence?.trim();
    const input: RecordCompensationRefund = { requestId: action.requestId, expectedRevision: row.revision,
      amountCents, occurredAt: new Date(fields.occurredAt).toISOString(), ...(evidence ? { evidence } : {}) };
    setBusy(true);
    setError("");
    try {
      onSaved(await employeeRequest<ClubAdjustmentRecord>(`${route}/${row.id}/refunds`, "POST", input));
    } catch (reason) {
      setError(requestMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return <Modal open title="登记额外补偿实退" okText="确认登记实退" cancelText="取消"
    onOk={form.submit} onCancel={() => { if (!busy) close(); }} confirmLoading={busy}>
    <Typography.Paragraph>待退 {money(remaining)}。核实线下退款后可分次登记。</Typography.Paragraph>
    <Form form={form} layout="vertical" onFinish={submit} disabled={busy}
      initialValues={{ amount: formatCentsAsYuan(remaining), occurredAt: dayjs().format("YYYY-MM-DDTHH:mm:ss") }}>
      <Form.Item name="amount" label="实退金额（元）" rules={[{ validator: (_, value) => validateAmount(value, remaining) }]}>
        <Input inputMode="decimal" />
      </Form.Item>
      <Form.Item name="occurredAt" label="实际退款时间" rules={[{ required: true, message: "请选择实际退款时间" }]}>
        <Input type="datetime-local" step={1} />
      </Form.Item>
      <Form.Item name="evidence" label="退款凭据（选填）">
        <Input.TextArea maxLength={240} placeholder="线下转账流水号或可核对的凭据" />
      </Form.Item>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Form>
  </Modal>;
}

async function validateAmount(value: string | undefined, max?: number) {
  const cents = parseYuanAsCents(value);
  if (!cents) throw new Error("请输入大于零且最多两位小数的金额");
  if (max !== undefined && cents > max) throw new Error("实退金额不能超过待退额");
}
