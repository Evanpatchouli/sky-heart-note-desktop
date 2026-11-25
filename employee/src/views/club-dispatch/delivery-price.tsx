import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Flex, Form, Input, InputNumber, Select, Typography } from "antd";
import {
  formatCentsAsYuan, parseYuanAsCents, priceAdjustmentStateLabel, PRICING_PERIODS,
  type DeliveryPeriodBreakdown, type DeliveryPeriodShift, type DeliveryPriceComparison,
  type DeliveryPriceIssue, type PriceAdjustment, type PriceAdjustmentIssue, type PriceAdjustmentReviewRecord,
} from "@sky-club/common";
import { getAppToken, RequestError, useAuthSession } from "@sky-club/common/web-auth";
import { actualPeriodLabels } from "#/components/ClubDeliveryPeriods";
import { employeeRequest } from "#/service/request";

const issueLabels = {
  quote_unavailable: "缺少一致的发布报价和原收款依据。",
  receipt_amount_mismatch: "原报价与原单已登记实收金额不一致，需先核对原收款。",
  incomplete: "订单仍有未交付数量，整单价差待核算。",
  segment_over_plan: "原报价段已有超出计划的到账，剩余如何分段仍需核对。",
  unmatched_period: "部分日报的实际时段或报价段关联待核对。",
  quantity_mismatch: "部分日报的实际赠送次数与通常的到账倍率有差异。",
  excess_delivery: "有份额外的额外到账，超量计价规则待确认。",
  pending_reports: "有待核对的补报或更正申请。",
  promotion_allocation: "本单涉及买赠或折扣，变更时的活动金额分配待确认。",
  amount_overflow: "金额超出可核算的整数分范围。",
  historical_view: "当前查看指定业务日的累计实绩。查看当前累计后可核对拟价差。",
  shift_exceeds_remaining: "拟转移数量超过原报价段的未交付数量，请刷新后核对。",
  shift_target_unchanged: "请选择与原报价段不同的目标时段。",
  double_quantity_unresolved: "拟交付的双倍期数量有单颗余量，额外到账规则待确认。",
  formal_adjustment_recorded: "本单已有正式改价。",
} satisfies Record<DeliveryPriceIssue, string>;

const unavailableLabels: Record<PriceAdjustmentIssue, string> = {
  customer_not_linked: "客户平台归属待核实。试算可供线下核对，客户确认入口在绑定后方可使用。",
  allocation_unavailable: "历史承接方案待核对。",
  dispatch_withdrawn: "本单已撤回派发，正式改价待核对。",
  unverified_quote_or_delivery: "报价、实绩或续送方案待核对。",
  no_supplement_due: "当前差额无须补款。减价和已完单差额的处理待核对。",
  adjustment_exists: "本单已有正式改价。",
};

function yuan(cents: number) {
  return `${formatCentsAsYuan(cents)} 元`;
}

function Issues({ issues }: { issues: DeliveryPriceIssue[] }) {
  return issues.length ? <Alert type="info" showIcon title="价差待核算"
    description={<ul className="club-report-terms">{issues.map(issue => <li key={issue}>{issueLabels[issue]}</li>)}</ul>} /> : null;
}

type ChangeWrite = {
  operation: "proposal" | "payment" | "review";
  requestId: string;
  body: Record<string, unknown>;
};

function persistedWrite(key: string): ChangeWrite | undefined {
  try {
    const input: ChangeWrite | null = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (input && ["proposal", "payment", "review"].includes(input.operation) && typeof input.requestId === "string" && input.body)
      return input;
  } catch {
    return;
  }
}

export default function DeliveryPrice({ route, breakdown, comparison, adjustment, history, reviews, historical, stopped, onRefresh }: {
  route: string;
  breakdown: DeliveryPeriodBreakdown;
  comparison: DeliveryPriceComparison;
  adjustment?: PriceAdjustment;
  history?: PriceAdjustment[];
  reviews?: PriceAdjustmentReviewRecord[];
  historical: boolean;
  stopped: boolean;
  onRefresh: () => void;
}) {
  const { id, token } = useAuthSession();
  const storageKey = `sky-club.price-adjustment.v1:${id}:${route}`;
  const [pending, setPending] = useState(() => persistedWrite(storageKey));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef<AbortController>(undefined);
  useEffect(() => () => inFlight.current?.abort(), []);

  function keep(input?: ChangeWrite) {
    setPending(input);
    try {
      if (input) sessionStorage.setItem(storageKey, JSON.stringify(input));
      else sessionStorage.removeItem(storageKey);
    } catch {
      // 当前页面仍可重试。
    }
  }

  async function submit(input: ChangeWrite) {
    if (inFlight.current || historical || getAppToken("employee") !== token) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    const suffix = { proposal: "", payment: "/payments", review: "/reviews" }[input.operation];
    const path = `${route}/historical-price-adjustment${suffix}`;
    inFlight.current = controller;
    keep(input);
    setSaving(true);
    setError("");
    try {
      const result = await employeeRequest<PriceAdjustment>(path, "POST", { ...input.body, requestId: input.requestId }, controller.signal);
      if (getAppToken("employee") !== token) return;
      if (!result?.id) throw new Error("未收到改价回执");
      keep();
      onRefresh();
    } catch (err) {
      if (getAppToken("employee") !== token) return;
      if (err instanceof RequestError && [400, 403, 404, 409].includes(err.status)) {
        keep();
        setError(err.message);
      } else setError("提交结果待确认，请检查网络后重试。");
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = undefined;
      setSaving(false);
    }
  }

  function start(operation: ChangeWrite["operation"], body: Record<string, unknown>) {
    void submit({ operation, requestId: crypto.randomUUID(), body });
  }

  const { original, proposal } = comparison;
  const disabled = !!pending || saving;
  return <Flex vertical gap="small">
    {!historical && pending ? <Alert type="warning" title="改价提交结果待确认"
      action={<Button type="primary" loading={saving} onClick={() => void submit(pending)}>重试本次提交</Button>} /> : null}
    {error ? <Alert type="error" showIcon title={error} action={<Button onClick={onRefresh}>刷新核对</Button>} /> : null}
    {adjustment ? <AdjustmentDetails adjustment={adjustment} stopped={stopped} disabled={historical || disabled || comparison.issues.includes("pending_reports")}
      onRecord={body => start("payment", body)} /> : null}
    {adjustment && comparison.issues.includes("pending_reports") ? <Alert type="warning" title="有待核对的补报或更正，登记收退款前需复核依据。" /> : null}
    {history?.length ? <details><summary>查看历次改价</summary>
      {history.map(value => <AdjustmentDetails key={value.id} adjustment={value} archived disabled onRecord={() => undefined} />)}
    </details> : null}
    {reviews?.length ? <details>
      <summary>查看已登记的待核价差（{reviews.length}）</summary>
      {reviews.map(review => <Card size="small" key={review.id} title={`待核价差 · ${new Date(review.submittedAt).toLocaleString("zh-CN")}`}>
        <Typography.Paragraph>{review.reason} · {review.submittedByUserId}</Typography.Paragraph>
        <Typography.Paragraph>实到 {review.observedHearts} 颗 · 剩余 {review.remainingHearts} 颗</Typography.Paragraph>
        <Issues issues={review.issues} />
        {review.proposal ? <Proposal proposal={review.proposal} /> : null}
      </Card>)}
    </details> : null}
    {stopped || (adjustment && adjustment.state !== "continuing") ? null : <>
    <Typography.Text strong>拟价差核对</Typography.Text>
    {original ? <dl className="club-order-facts">
      <div><dt>原报价</dt><dd>{yuan(original.totalCents)} · 爱心款 {yuan(original.heartsCents)}</dd></div>
      <div><dt>原单已登记实收</dt><dd>{original.receivedCents === null ? "未登记" : yuan(original.receivedCents)}</dd></div>
      <div><dt>发布依据</dt><dd>报价版本 {original.quoteRevision} · 计抽规则版本 {original.ruleVersion}</dd></div>
    </dl> : null}
    <Issues issues={comparison.issues} />
    {proposal ? <>
      <Proposal proposal={proposal} />
      {proposal.basis === "recorded_delivery" && proposal.differenceCents ? <Typography.Text type="secondary">本单已无待续送数量，已到实绩与原价的差额待核对。</Typography.Text> : null}
    </> : null}
    {comparison.manualReviewVersion ? <ReasonForm name="record-current-price-review" title="登记待核价差" disabled={disabled}
      description="保留当前价差、原因和实绩依据，供核对。订单和收退款状态维持现状。"
      onSubmit={reason => start("review", { expectedVersion: comparison.manualReviewVersion, reason })} /> : null}
    {comparison.canPreviewRemaining ? <RemainingPreview route={route} segments={breakdown.segments}
      disabled={disabled} onPropose={body => start("proposal", body)} onReview={body => start("review", body)} /> : null}
    </>}
  </Flex>;
}

function AdjustmentDetails({ adjustment, archived = false, stopped = false, disabled, onRecord }: {
  adjustment: PriceAdjustment;
  archived?: boolean;
  stopped?: boolean;
  disabled: boolean;
  onRecord: (body: Record<string, unknown>) => void;
}) {
  const { state, shift, decision, supplement, refund } = adjustment;
  const isStopped = decision?.value === "decline";
  const kind = stopped ? null : state === "awaiting_supplement" ? "supplement" : state === "refund_due" ? "refund" : null;
  const title = kind === "supplement" ? "登记补款到账" : "登记实际退款";
  const amount = kind === "supplement" ? adjustment.differenceCents : adjustment.refundDueCents;
  return <Card size="small" title="跨期改价">
    <Flex vertical gap="small">
      <Typography.Text strong role="status">{stopped ? "本单已停送，保留原改价记录" : archived ? "已实补，计价已生效" : priceAdjustmentStateLabel[state]}</Typography.Text>
      <Typography.Text>提交原因 {adjustment.reason}</Typography.Text>
      <Typography.Text>经办 {adjustment.submittedByUserId} · {new Date(adjustment.submittedAt).toLocaleString("zh-CN")}</Typography.Text>
      <dl className="club-order-facts">
        <div><dt>提交时已到账</dt><dd>{adjustment.observedHearts} 颗</dd></div>
        <div><dt>原报价第 {shift.quoteSegment} 段</dt><dd>{shift.hearts} 颗 · {actualPeriodLabels[adjustment.originalPeriod]} · {yuan(adjustment.originalUnitPriceCents)}/颗</dd></div>
        <div><dt>续送约定</dt><dd>{actualPeriodLabels[shift.targetPeriod]} · {yuan(shift.targetUnitPriceCents)}/颗</dd></div>
        <div><dt>原实收</dt><dd>{yuan(adjustment.originalReceivedCents)}</dd></div>
        <div><dt>拟补差</dt><dd>{yuan(adjustment.differenceCents)}</dd></div>
        <div><dt>实际补款</dt><dd>{yuan(supplement?.amountCents ?? 0)}</dd></div>
        {stopped ? null : isStopped ? <>
          <div><dt>未履约原付心款应退</dt><dd>{yuan(adjustment.refundDueCents)}</dd></div>
          <div><dt>实际退款</dt><dd>{yuan(refund?.amountCents ?? 0)}</dd></div>
        </> : <div><dt>续送结清总价</dt><dd>{yuan(adjustment.proposedTotalCents)}</dd></div>}
        {!stopped ? <div><dt>{isStopped ? "净实收" : "累计实收"}</dt><dd>{yuan(adjustment.netReceivedCents)}</dd></div> : null}
      </dl>
      {decision ? <Typography.Text>客户 {decision.userId} · {decision.value === "accept" ? "已同意" : "已拒绝"} · {new Date(decision.recordedAt).toLocaleString("zh-CN")}</Typography.Text> : null}
      {supplement || (!stopped && refund) ? <Typography.Text>实际{supplement ? "补款" : "退款"}时间 {new Date((supplement ?? refund)!.occurredAt).toLocaleString("zh-CN")} · 登记人 {(supplement ?? refund)!.recordedByUserId}</Typography.Text> : null}
      <details>
        <summary>查看提交时的计算依据</summary>
        <Typography.Text type="secondary">发布报价 V{adjustment.quoteRevision} · 抽成规则 V{adjustment.ruleVersion}</Typography.Text>
        <Proposal proposal={adjustment.calculation} />
      </details>
      {kind ? <Form key={kind} layout="vertical" disabled={disabled} onFinish={({ amountText, time }: { amountText: string; time: string }) => {
        const amountCents = parseYuanAsCents(amountText);
        const occurredAt = new Date(time);
        if (amountCents === amount && Number.isFinite(occurredAt.getTime())) onRecord({
          kind, amountCents, occurredAt: occurredAt.toISOString(), adjustmentId: adjustment.id, expectedRevision: adjustment.revision,
        });
      }}>
        <Form.Item label={kind === "supplement" ? "实际收到（元）" : "实际退回（元）"} name="amountText" rules={[
          { validator: (_, value) => parseYuanAsCents(value) === amount ? Promise.resolve() : Promise.reject(new Error(`请输入实际金额 ${yuan(amount)}。`)) },
        ]}><Input inputMode="decimal" /></Form.Item>
        <Form.Item label={kind === "supplement" ? "实际补款时间" : "实际退款时间"} name="time" rules={[{ required: true, message: "请选择实际发生时间" }]}>
          <Input type="datetime-local" step={1} />
        </Form.Item>
        <Button type="primary" htmlType="submit" style={{ minHeight: 44 }}>{title}</Button>
      </Form> : null}
    </Flex>
  </Card>;
}

function Proposal({ proposal }: { proposal: NonNullable<DeliveryPriceComparison["proposal"]> }) {
  const { differenceCents, basis } = proposal;
  const difference = differenceCents === 0 ? "按原报价核对无价差"
    : `${differenceCents > 0 ? "拟增加" : "拟减少"} ${yuan(Math.abs(differenceCents))}`;
  return <Alert type={differenceCents ? "warning" : "success"} showIcon title={difference} description={
    <Flex vertical gap={4}>
      <span>{basis === "recorded_delivery" ? "按已登记实绩核对" : "按拟定方案继续送完"} · 爱心款 {yuan(proposal.heartsCents)} · 拟合计 {yuan(proposal.totalCents)}</span>
      <details>
        <summary>查看分段计算依据</summary>
        <ul className="club-report-terms">
          {proposal.lines.filter(line => line.recordedHearts || line.assumedHearts || line.shiftedHearts).map(line =>
            <li key={`${line.quoteSegment}:${line.period}`}>
              原第 {line.quoteSegment} 段 · {actualPeriodLabels[line.period]} · {yuan(line.unitPriceCents)}/颗
              {line.recordedHearts ? ` · 实到 ${line.recordedHearts} 颗` : ""}
              {line.assumedHearts ? ` · 按原段待送 ${line.assumedHearts} 颗` : ""}
              {line.shiftedHearts ? ` · 拟跨期待送 ${line.shiftedHearts} 颗` : ""}
            </li>
          )}
        </ul>
      </details>
      <Typography.Text type="secondary">仅供核对，报价及原单收款以已登记记录为准。</Typography.Text>
    </Flex>
  } />;
}

type PreviewFields = Omit<DeliveryPeriodShift, "targetUnitPriceCents"> & { targetPrice: string };

function ReasonForm({ name, title, description, disabled, onSubmit }: {
  name: string; title: string; description: string; disabled: boolean; onSubmit: (reason: string) => void;
}) {
  return <Form layout="vertical" name={name} disabled={disabled}
    onFinish={({ reason }: { reason: string }) => onSubmit(reason.trim())}>
    <Form.Item name="reason" label="改价原因" rules={[{ required: true, whitespace: true, message: "请写明改价原因" }]}>
      <Input.TextArea maxLength={240} rows={3} />
    </Form.Item>
    <Typography.Paragraph>{description}</Typography.Paragraph>
    <Button type="primary" htmlType="submit" style={{ minHeight: 44 }}>{title}</Button>
  </Form>;
}

function RemainingPreview({ route, segments, disabled, onPropose, onReview }: {
  route: string; segments: DeliveryPeriodBreakdown["segments"]; disabled: boolean;
  onPropose: (body: Record<string, unknown>) => void;
  onReview: (body: Record<string, unknown>) => void;
}) {
  const [form] = Form.useForm<PreviewFields>();
  const fromNumber = Form.useWatch("quoteSegment", form);
  const from = segments.find(segment => segment.number === fromNumber);
  const [review, setReview] = useState<{ result: DeliveryPriceComparison; shift: DeliveryPeriodShift }>();
  const result = review?.result;
  const eligibility = result?.adjustmentReview;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef<AbortController>(undefined);
  useEffect(() => () => inFlight.current?.abort(), []);

  async function preview({ targetPrice, ...fields }: PreviewFields) {
    if (inFlight.current) return;
    const targetUnitPriceCents = parseYuanAsCents(targetPrice);
    if (targetUnitPriceCents === null || targetUnitPriceCents < 1) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setSaving(true);
    setError("");
    setReview(undefined);
    try {
      const response = await employeeRequest<DeliveryPriceComparison>(
        `${route}/fulfillment/historical-price-preview`, "POST", { ...fields, targetUnitPriceCents }, controller.signal,
      );
      if (!controller.signal.aborted) setReview({ result: response, shift: { ...fields, targetUnitPriceCents } });
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof RequestError ? err.message : "试算请求失败，请重试");
    } finally {
      inFlight.current = undefined;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return <details>
    <summary>试算剩余跨期价差</summary>
    <Typography.Paragraph type="secondary">填写要跨期的原报价段、颗数和目标时段约定单价，其余未送数量按原段试算。</Typography.Paragraph>
    <Form form={form} name="period-price-preview" layout="vertical" disabled={disabled || saving} onFinish={preview}
      onValuesChange={changed => {
        setReview(undefined);
        setError("");
        if ("quoteSegment" in changed) form.resetFields(["targetPeriod"]);
      }}>
      <Form.Item name="quoteSegment" label="原报价段" rules={[{ required: true, message: "请选择原报价段" }]}>
        <Select options={segments.filter(segment => segment.pendingHearts).map(segment => ({
          value: segment.number,
          label: `第 ${segment.number} 段 · ${actualPeriodLabels[segment.period]} · 未送 ${segment.pendingHearts} 颗`,
        }))} />
      </Form.Item>
      <Form.Item name="hearts" label="拟跨期颗数" rules={[{ required: true, type: "integer", min: 1, message: "请输入正整数颗数" }]}>
        <InputNumber min={1} max={from?.pendingHearts ?? Number.MAX_SAFE_INTEGER} precision={0} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item name="targetPeriod" label="拟目标时段" rules={[{ required: true, message: "请选择目标时段" }]}>
        <Select disabled={!from || saving} options={PRICING_PERIODS.filter(period => period !== from?.period).map(period => ({
          value: period, label: actualPeriodLabels[period],
        }))} />
      </Form.Item>
      <Form.Item name="targetPrice" label="拟目标单价（元/颗）" rules={[
        { required: true, message: "请输入约定的目标单价" },
        { validator: (_, value) => (parseYuanAsCents(value) ?? 0) > 0
          ? Promise.resolve() : Promise.reject(new Error("请输入大于零且最多两位小数的单价")) },
      ]}>
        <Input inputMode="decimal" />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={saving} style={{ minHeight: 44 }}>计算拟价差</Button>
    </Form>
    {error ? <Alert type="error" showIcon title={error} /> : null}
    {result?.proposal ? <Proposal proposal={result.proposal} /> : null}
    {result?.issues.length ? <Issues issues={result.issues} /> : null}
    {eligibility && "unavailable" in eligibility ? <Alert type="info" title={unavailableLabels[eligibility.unavailable]} /> : null}
    {review && eligibility && "version" in eligibility ? <ReasonForm name="submit-price-adjustment" title="提交改价" disabled={disabled}
      description="提交后暂停领取和送心，等待客户确认。同意后须登记补款才可续送。拒绝后整单停送，未履约部分按原实付核对退款。"
      onSubmit={reason => onPropose({ ...review.shift, expectedVersion: eligibility.version, reason })} /> : null}
    {review && result?.manualReviewVersion ? <ReasonForm name="record-preview-price-review" title="登记待核价差" disabled={disabled}
      description="保留试算数量、价格和原因，供核对。订单和收退款状态维持现状。"
      onSubmit={reason => onReview({ shift: review.shift, expectedVersion: result.manualReviewVersion, reason })} /> : null}
  </details>;
}
