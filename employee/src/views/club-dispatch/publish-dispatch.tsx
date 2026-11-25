import { useEffect, useRef, useState } from "react";
import { Alert, Button, Flex, Form, InputNumber, Modal, Select, Spin, Typography } from "antd";
import { commissionBasisLabel, commissionUnit, formatCentsAsYuan, type DispatchPricing } from "@sky-club/common";
import { RequestError } from "@sky-club/common/web-auth";
import { employeeRequest } from "#/service/request";

type DirectedShare = { userId: string; hearts: number };
type Recipient = { userId: string; nickname: string | null };
type AllocationPlan = { publicHearts: number; directed: DirectedShare[] };
export type Publication = {
  publishedAt: string;
  dispatchPricing: DispatchPricing;
  allocation: AllocationPlan;
};
export type DispatchAllocation = {
  withdrawnAt?: string;
  stoppedAt?: string;
  originallyUnclaimedHearts?: number;
  publicHearts: number;
  publicRemainingHearts: number;
  directedPendingHearts: number;
  claimedHearts: number;
  directed: (DirectedShare & { nickname: string | null; accepted: boolean })[];
  shares: (DirectedShare & { nickname: string | null; kind: "public" | "directed" })[];
};

type PublishFields = { directed: DirectedShare[] };
type Props = {
  route: string;
  summary: string;
  fulfillmentHearts: number;
  receivedAmountCents: number;
  quoteAmountCents: number;
  pricingRevision: number;
  ruleVersion: number;
  commissionReviewRevision: number;
  basis: DispatchPricing["basis"];
  dispatchFeeCents: number;
  clubFeeCents: number;
  onClose: () => void;
  onReload: () => void;
  onPublished: (result: Publication, recipients: Recipient[]) => void;
};

function recipientLabel({ nickname, userId }: Recipient) {
  return nickname ? `${nickname} · ${userId}` : userId;
}

export default function PublishDispatch({
  route, summary, fulfillmentHearts, receivedAmountCents, quoteAmountCents,
  pricingRevision, ruleVersion, commissionReviewRevision, basis, dispatchFeeCents,
  clubFeeCents, onClose, onReload, onPublished,
}: Props) {
  const [form] = Form.useForm<PublishFields>();
  const directed = Form.useWatch("directed", form) ?? [];
  const remaining = directed.reduce((total, share) => total - (share?.hearts ?? 0), fulfillmentHearts);
  const [recipients, setRecipients] = useState<Recipient[]>();
  const [loadingError, setLoadingError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submitted = useRef<{ payload: string; requestId: string } | undefined>(undefined);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingError("");
    employeeRequest<Recipient[]>("club/dispatch-recipients", "GET", undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setRecipients(data); })
      .catch(err => {
        if (!controller.signal.aborted) setLoadingError(err instanceof RequestError ? err.message : "团员名单加载失败，请重试");
      });
    return () => controller.abort();
  }, [attempt]);

  async function publish(values: PublishFields) {
    if (inFlight.current) return;
    const directed = values.directed ?? [];
    const publicHearts = directed.reduce((total, share) => total - share.hearts, fulfillmentHearts);
    if (publicHearts < 0) {
      setError("定向份额合计不得超过订购颗数");
      return;
    }
    if (new Set(directed.map(({ userId }) => userId)).size !== directed.length) {
      setError("同一团员只能指定一份份额");
      return;
    }
    const input = { pricingRevision, ruleVersion, commissionReviewRevision, publicHearts, directed };
    const payload = JSON.stringify(input);
    if (submitted.current?.payload !== payload) submitted.current = { payload, requestId: crypto.randomUUID() };
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    setConflict(false);
    try {
      const result = await employeeRequest<Publication>(`${route}/publish`, "POST", {
        ...input, requestId: submitted.current.requestId,
      });
      onPublished(result, recipients ?? []);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "派发请求未确认，请再次提交核对结果");
      setConflict(err instanceof RequestError && err.status === 409);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return <Modal open title="确认正式派发" onCancel={onClose} onOk={() => form.submit()}
    okText="确认派发" cancelText="取消" confirmLoading={submitting} closable={!submitting}
    keyboard={!submitting} mask={{ closable: !submitting }} cancelButtonProps={{ disabled: submitting }}>
    <Typography.Paragraph strong>{summary}</Typography.Paragraph>
    <dl className="club-order-facts">
      <div><dt>原报价</dt><dd>¥{formatCentsAsYuan(quoteAmountCents)}</dd></div>
      <div><dt>原实收</dt><dd>¥{formatCentsAsYuan(receivedAmountCents)}</dd></div>
    </dl>
    <Typography.Paragraph>
      规则 V{ruleVersion} · {commissionBasisLabel[basis]} · 派抽 ¥{formatCentsAsYuan(dispatchFeeCents)}/{commissionUnit(basis)}
      {" · "}团抽 ¥{formatCentsAsYuan(clubFeeCents)}/{commissionUnit(basis)}
    </Typography.Paragraph>
    <Form layout="vertical" form={form} onFinish={publish} disabled={submitting} initialValues={{ directed: [] }}>
      <Form.List name="directed">
        {(fields, { add, remove }) => <>
          {fields.map(({ key, name }) => <div className="club-directed-row" key={key}>
            <Form.Item label="指定团员" name={[name, "userId"]} rules={[{ required: true }]}>
              <Select aria-label="指定团员" showSearch={{ optionFilterProp: "label" }} options={recipients?.map(member => ({
                value: member.userId,
                label: recipientLabel(member),
                disabled: directed.some((share, index) => index !== name && share?.userId === member.userId),
              }))} />
            </Form.Item>
            <Form.Item label="指定颗数" name={[name, "hearts"]}
              rules={[{ required: true, type: "integer", min: 1, max: fulfillmentHearts }]}>
              <InputNumber min={1} max={fulfillmentHearts} changeOnBlur={false} style={{ width: "100%" }} />
            </Form.Item>
            <Button onClick={() => remove(name)}>移除</Button>
          </div>)}
          <Button onClick={() => add({})} disabled={!recipients?.length || fields.length >= recipients.length || remaining <= 0}>
            添加定向份额
          </Button>
        </>}
      </Form.List>
    </Form>
    {!recipients && !loadingError ? <Spin size="small" aria-label="加载可指派团员" /> : null}
    {loadingError ? <Alert type="warning" showIcon title={loadingError}
      action={<Button size="small" onClick={() => setAttempt(value => value + 1)}>重试</Button>} /> : null}
    <Typography.Paragraph style={{ marginBlock: 12 }}>
      {remaining >= 0 ? <>公开抢单 <strong>{remaining} 颗</strong></> : <>定向份额超出交付总量 {-remaining} 颗</>}
    </Typography.Paragraph>
    {error ? <Alert type="error" showIcon title={error}
      action={conflict ? <Button size="small" onClick={onReload}>重新加载</Button> : undefined} /> : null}
  </Modal>;
}

export function AllocationResult({ allocation, onReload }: {
  allocation: DispatchAllocation;
  onReload: () => void;
}) {
  const publicShares = new Map<string, { hearts: number; nickname: string | null }>();
  for (const { userId, hearts, kind, nickname } of allocation.shares) {
    if (kind === "public") {
      publicShares.set(userId, { nickname, hearts: (publicShares.get(userId)?.hearts ?? 0) + hearts });
    }
  }
  return <section aria-label="派发分配" style={{ marginTop: 16 }}>
    <Flex justify="space-between" align="center" wrap>
      <Typography.Title level={5} style={{ margin: 0 }}>派发分配</Typography.Title>
      <Button onClick={onReload}>刷新承接状态</Button>
    </Flex>
    {allocation.withdrawnAt ? <Alert type="warning" showIcon title="已撤回，停止领取" /> : null}
    {allocation.stoppedAt ? <Alert type="warning" showIcon title="已停送，停止领取" /> : null}
    <dl className="club-order-facts">
      {allocation.stoppedAt ? <div><dt>停送时原未承接</dt><dd>{allocation.originallyUnclaimedHearts ?? 0} 颗</dd></div> : <>
        <div><dt>{allocation.withdrawnAt ? "撤回时未抢领" : "公开余量"}</dt><dd>{allocation.publicRemainingHearts} 颗</dd></div>
        <div><dt>{allocation.withdrawnAt ? "撤回时未确认" : "定向待确认"}</dt><dd>{allocation.directedPendingHearts} 颗</dd></div>
      </>}
      <div><dt>已承接</dt><dd>{allocation.claimedHearts} 颗</dd></div>
    </dl>
    {allocation.directed.length ? <ul className="club-share-list">
      {allocation.directed.map(share => <li key={share.userId}>
        <span>{recipientLabel(share)}</span><span>{share.hearts} 颗 · {share.accepted ? "已接受指派" : allocation.withdrawnAt || allocation.stoppedAt ? "已停止领取" : "待本人确认"}</span>
      </li>)}
    </ul> : null}
    {publicShares.size ? <ul className="club-share-list">
      {[...publicShares].map(([userId, { hearts, nickname }]) => <li key={userId}>
        <span>{recipientLabel({ userId, nickname })}</span><span>{hearts} 颗 · 已抢领</span>
      </li>)}
    </ul> : null}
  </section>;
}
