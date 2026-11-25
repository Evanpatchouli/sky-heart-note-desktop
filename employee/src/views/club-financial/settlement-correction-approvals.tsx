import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Form, Input, Modal, Spin, Typography } from "antd";
import { settlementCashMovementLabel, type ClubAdjustmentDecision, type GiftReportLine, type SettlementCorrection } from "@webapp-template/common";
import { employeeRequest } from "#/service/request";
import { requestMessage } from "../club-assignments/types";
import { money, showDate } from "./adjustment-summary";

type Review = { row: SettlementCorrection; decision: ClubAdjustmentDecision };
type Corrections = { records: SettlementCorrection[]; memberNames: Record<string, string | null> };

export default function SettlementCorrectionApprovals() {
  const [data, setData] = useState<Corrections>();
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [review, setReview] = useState<Review>();
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<Corrections>("club/settlement-corrections", "GET", undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(requestMessage(reason)); });
    return () => controller.abort();
  }, [attempt]);

  return <Flex vertical gap="middle">
    <Button onClick={() => setAttempt(value => value + 1)} style={{ alignSelf: "flex-end" }}>刷新更正申请</Button>
    {result ? <Alert type="success" showIcon title={result} /> : null}
    {error ? <Alert type="error" showIcon title={error} /> : !data ? <Spin aria-label="加载结单更正" /> :
      data.records.length ? data.records.map(row => <Card size="small" key={`${row.orderId}:${row.requestId}`}
        title={row.kind === "cash" ? "实收实退更正" : "已结单日报更正"}>
        <Flex vertical gap="small">
          <Typography.Text>申请人 {data.memberNames[row.requestedByUserId] ?? row.requestedByUserId} · {showDate(row.requestedAt)}</Typography.Text>
          <Typography.Text type="secondary" copyable={{ text: row.orderId }}>订单 {row.orderId}</Typography.Text>
          <Typography.Text>更正原因 · {row.reason}</Typography.Text>
          {row.kind === "cash" ? <>
            <Typography.Text>{settlementCashMovementLabel[row.movement.kind]} · {showDate(row.movement.occurredAt)} · {money(row.movement.effectiveAmountCents)} → {money(row.correctedAmountCents)}</Typography.Text>
            <Typography.Text style={{ overflowWrap: "anywhere" }}>原转账凭据 · {row.evidence}</Typography.Text>
          </> : <>
            <Typography.Text>{row.businessDate} 日报 · 当前版本 {row.expectedVersion}</Typography.Text>
            <ReportLines label="原日报" lines={row.previousLines} />
            <ReportLines label="拟更正日报" lines={row.lines} />
          </>}
          <Flex gap="small" wrap="wrap">
            <Button type="primary" onClick={() => setReview({ row, decision: "approved" })}>批准更正</Button>
            <Button danger onClick={() => setReview({ row, decision: "rejected" })}>驳回更正</Button>
          </Flex>
        </Flex>
      </Card>) : <Empty description="暂无待确认的结单更正" />}
    {review ? <ReviewCorrection review={review} close={() => setReview(undefined)} onSaved={row => {
      setReview(undefined);
      setResult(row.status === "approved" ? "更正已生效" : "更正已驳回");
      setData(previous => previous ? { ...previous, records: previous.records.filter(item => item.orderId !== row.orderId || item.requestId !== row.requestId) } : previous);
      setAttempt(value => value + 1);
    }} /> : null}
  </Flex>;
}

function ReportLines({ label, lines }: { label: string; lines: GiftReportLine[] }) {
  const periods = { normal: "普通期", double: "双倍期", unconfirmed: "时段待核对" };
  return <div>
    <Typography.Text strong>{label}</Typography.Text>
    {lines.map((line, index) => <div key={index}>{line.quoteSegment ? `第 ${line.quoteSegment} 段 · ` : ""}
      {periods[line.period]} · {line.giftTimes} 次 · 到账 {line.receivedHearts == null ? "未知" : `${line.receivedHearts} 颗`}</div>)}
  </div>;
}

function ReviewCorrection({ review, close, onSaved }: { review: Review; close: () => void; onSaved: (row: SettlementCorrection) => void }) {
  const [form] = Form.useForm<{ reason?: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = review.decision === "approved" ? "确认批准更正" : "确认驳回更正";
  async function submit({ reason }: { reason?: string }) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await employeeRequest<SettlementCorrection>(
        `club/orders/${review.row.orderId}/settlement/corrections/${review.row.requestId}/decision`, "PATCH",
        { expectedRevision: 1, decision: review.decision, ...(reason?.trim() ? { reason: reason.trim() } : {}) },
      ));
    } catch (problem) {
      setError(requestMessage(problem));
    } finally {
      setBusy(false);
    }
  }
  return <Modal open title={title} okText={title} cancelText="取消" onOk={form.submit} confirmLoading={busy}
    onCancel={() => { if (!busy) close(); }}>
    <Form form={form} layout="vertical" onFinish={submit} disabled={busy}>
      <Form.Item name="reason" label="审核说明（选填）"><Input.TextArea maxLength={240} /></Form.Item>
      {error ? <Alert type="error" showIcon title={error} /> : null}
    </Form>
  </Modal>;
}
