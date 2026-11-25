import { useEffect, useState } from "react";
import { Alert, Button, Flex, Form, Input, Modal, Select, Spin, Tag, Typography } from "antd";
import { formatCentsAsYuan, parseYuanAsCents, settlementCashMovementLabel, type SettlementCashMovement, type SettlementCorrection } from "@sky-club/common";
import { employeeRequest } from "#/service/request";
import { requestMessage } from "../club-assignments/types";
import { money, showDate } from "./adjustment-summary";

const statusLabel = { pending: "待确认", approved: "已生效", rejected: "已驳回" };
const movementKey = (movement: SettlementCashMovement) => `${movement.kind}:${movement.requestId}`;
type Fields = { movementRequestId: string; amount: string; evidence: string; reason: string };
type CashRequest = Extract<SettlementCorrection, { kind: "cash" }>;
type CashData = { movements: SettlementCashMovement[]; records: CashRequest[] };

export default function CashCorrections({ orderRoute, onSaved }: { orderRoute: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button onClick={() => setOpen(true)}>实收实退更正</Button>
    {open ? <CashCorrectionDialog route={`${orderRoute}/settlement/cash-correction-requests`}
      onClose={() => setOpen(false)} onSaved={onSaved} /> : null}
  </>;
}

function CashCorrectionDialog({ route, onClose, onSaved }: { route: string; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm<Fields>();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [data, setData] = useState<CashData>();
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<CashData>(route, "GET", undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(requestMessage(reason)); });
    return () => controller.abort();
  }, [route, refresh]);
  const movements = data?.movements.filter(movement => !data.records.some(row =>
    row.status === "pending" && movementKey(row.movement) === movementKey(movement))) ?? [];

  async function submit(fields: Fields) {
    const movement = movements.find(item => movementKey(item) === fields.movementRequestId);
    const correctedAmountCents = parseYuanAsCents(fields.amount);
    if (busy || !movement || correctedAmountCents === null) return;
    setBusy(true);
    setError("");
    try {
      await employeeRequest<SettlementCorrection>(route, "POST", {
        requestId, movementRequestId: movement.requestId, movementKind: movement.kind, expectedRevision: movement.revision,
        correctedAmountCents, evidence: fields.evidence.trim(), reason: fields.reason.trim(),
      });
      form.resetFields();
      setRequestId(crypto.randomUUID());
      setFeedback("更正申请已提交，待团长或副团长确认");
      setRefresh(value => value + 1);
      onSaved();
    } catch (reason) {
      setError(requestMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return <Modal open title="实收实退更正" okText="提交更正申请" cancelText="关闭"
    onCancel={() => { if (!busy) onClose(); }} onOk={form.submit} confirmLoading={busy} okButtonProps={{ disabled: !movements.length }}>
    <Flex vertical gap="small">
      <Typography.Text>提交原转账凭据和更正原因。获批后追加账面差额。</Typography.Text>
      {error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => { setError(""); setRefresh(value => value + 1); }}>刷新</Button>} /> : null}
      {feedback ? <Alert type="success" showIcon title={feedback} /> : null}
      {!data && !error ? <Spin aria-label="加载收退款" /> : null}
      {movements.length ? <Form form={form} layout="vertical" onFinish={submit} disabled={busy}>
        <Form.Item name="movementRequestId" label="选择原收退款" rules={[{ required: true }]} >
          <Select onChange={id => {
            const movement = movements.find(item => movementKey(item) === id);
            if (movement) form.setFieldValue("amount", formatCentsAsYuan(movement.effectiveAmountCents));
          }} options={movements.map(row => ({ value: movementKey(row), label: `${settlementCashMovementLabel[row.kind]} · ${money(row.effectiveAmountCents)} · ${showDate(row.occurredAt)}` }))} />
        </Form.Item>
        <Form.Item name="amount" label="实际转账金额（元）" rules={[{ validator: (_, value: string) =>
          parseYuanAsCents(value) !== null ? Promise.resolve() : Promise.reject(new Error("请输入有效的金额，精确到分")) }]} >
          <Input inputMode="decimal" />
        </Form.Item>
        <Form.Item name="evidence" label="原转账凭据" rules={[{ required: true, whitespace: true }]} >
          <Input.TextArea maxLength={1000} placeholder="如银行流水号或可核对的凭据" />
        </Form.Item>
        <Form.Item name="reason" label="更正原因" rules={[{ required: true, whitespace: true }]} >
          <Input.TextArea maxLength={240} />
        </Form.Item>
      </Form> : null}
      {data?.records.map(row => <div key={row.requestId}>
        <Tag>{statusLabel[row.status]}</Tag>
        <Typography.Text>{settlementCashMovementLabel[row.movement.kind]} · {money(row.movement.effectiveAmountCents)} → {money(row.correctedAmountCents)}</Typography.Text>
        <div>{row.reason}{row.decisionReason ? ` · ${row.decisionReason}` : ""}</div>
      </div>)}
    </Flex>
  </Modal>;
}
