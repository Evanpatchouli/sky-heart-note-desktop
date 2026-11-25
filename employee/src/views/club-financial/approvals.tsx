import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Form, Input, Modal, Spin, Typography } from "antd";
import type { ClubAdjustmentDecision, ClubAdjustmentList, ClubAdjustmentRecord } from "@webapp-template/common";
import { useAuthSession } from "@webapp-template/common/web-auth";
import Header from "#/components/Header";
import { employeeRequest } from "#/service/request";
import { requestMessage } from "../club-assignments/types";
import { AdjustmentSummary, money } from "./adjustment-summary";

const route = "club/financial-adjustments";
type Decision = { row: ClubAdjustmentRecord; decision: ClubAdjustmentDecision };

export default function AdjustmentApprovals() {
  const { token } = useAuthSession();
  return <>
    <Header />
    <main className="club-claim-page">
      <Typography.Title level={2}>调整审批</Typography.Title>
      <PendingApprovals key={token} />
    </main>
  </>;
}

function PendingApprovals() {
  const [data, setData] = useState<ClubAdjustmentList>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<Decision>();
  const [result, setResult] = useState("");
  const refresh = () => setAttempt(value => value + 1);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<ClubAdjustmentList>(route, "GET", undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(requestMessage(reason)); });
    return () => controller.abort();
  }, [attempt]);

  return <Flex vertical gap="middle">
    <Button onClick={refresh} style={{ alignSelf: "flex-end" }}>刷新审批</Button>
    {result ? <Alert type="success" showIcon title={result} /> : null}
    {error ? <Alert type="error" showIcon title={error} /> : !data ? <Spin aria-label="加载待审批调整" /> :
      data.records.length ? data.records.map(row => <Card size="small" key={row.id}>
        <AdjustmentSummary row={row} names={data.memberNames} showOrder />
        <Flex gap="small" wrap="wrap">
          <Button type="primary" onClick={() => { setResult(""); setPending({ row, decision: "approved" }); }}>批准</Button>
          <Button danger onClick={() => { setResult(""); setPending({ row, decision: "rejected" }); }}>驳回</Button>
        </Flex>
      </Card>) : <Empty description="暂无待确认调整" />}
    {pending ? <ReviewAdjustment action={pending} close={() => setPending(undefined)} onSaved={record => {
      setPending(undefined);
      setData(previous => previous ? { ...previous, records: previous.records.filter(row => row.id !== record.id) } : previous);
      setResult(record.status === "rejected" ? "调整已驳回" : record.kind === "member_penalty" ? "罚款已生效" : "补偿已批准，待派单人登记实退");
      refresh();
    }} /> : null}
  </Flex>;
}

function ReviewAdjustment({ action, close, onSaved }: { action: Decision; close: () => void; onSaved: (record: ClubAdjustmentRecord) => void }) {
  const [form] = Form.useForm<{ reason?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const approved = action.decision === "approved";
  const label = action.row.kind === "member_penalty" ? "罚款" : "额外补偿";

  async function submit(fields: { reason?: string }) {
    if (busy) return;
    const reason = fields.reason?.trim();
    setBusy(true);
    setError("");
    try {
      onSaved(await employeeRequest<ClubAdjustmentRecord>(`${route}/${action.row.id}/decision`, "PATCH", {
        expectedRevision: action.row.revision, decision: action.decision, ...(reason ? { reason } : {}),
      }));
    } catch (issue) {
      setError(requestMessage(issue));
    } finally {
      setBusy(false);
    }
  }

  return <Modal open title={`${approved ? "批准" : "驳回"}${label}`} okText={approved ? "确认批准" : "确认驳回"}
    cancelText="取消" onOk={form.submit} confirmLoading={busy} onCancel={() => { if (!busy) close(); }}>
    <Typography.Paragraph>{label} {money(action.row.amountCents)} · {action.row.reason}</Typography.Paragraph>
    {approved ? <Typography.Paragraph type="secondary">{action.row.kind === "member_penalty"
      ? "罚款批准后生效，随订单结单扣记并归入团费。" : "批准后由本单派单人核实线下退款并登记。"}</Typography.Paragraph> : null}
    <Form form={form} layout="vertical" onFinish={submit} disabled={busy}>
      <Form.Item name="reason" label="审核说明（选填）"><Input.TextArea maxLength={240} /></Form.Item>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Form>
  </Modal>;
}
