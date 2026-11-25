import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Flex, Form, Input, InputNumber, Select, Spin, Typography } from "antd";
import {
  calculateGiftQuote, formatCentsAsYuan, parseYuanAsCents,
  type CommissionRule, type ContinuationQuote, type DispatchPricing, type GiftPriceSegment, type OrderPricing,
} from "@webapp-template/common";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";

type GiftOrder = {
  requestedGiftTimes: number;
  estimatedReceivedHearts?: number;
};

type Quote = { revision: number; heartsAmountCents: number; unlockAmountCents: number; totalAmountCents: number };
type Preparation = {
  dispatchStatus: string;
  dispatchPricing: DispatchPricing | null;
  pricing: (OrderPricing & { unlock?: { quantity: number; unitPriceCents: number } }) | null;
  rule: CommissionRule | null;
  continuationQuotes: ContinuationQuote[];
  quote?: Quote | null;
  receipt?: { receivedAmountCents: number; receivedAt: string; receivedByUserId: string } | null;
  paymentStatus?: string;
  commissionReview?: { revision: number; ruleVersion: number; dispatchFeeCents: number } | null;
};
type SegmentFields = Omit<GiftPriceSegment, "unitPriceCents"> & { unitPrice: string };
type PendingContinuation = Pick<ContinuationQuote, "requestId" | "segment">;
type PriceFields = {
  dispatchFee: string;
  segments: SegmentFields[];
  unlockQuantity?: number;
  unlockPrice?: string;
};
const periods = { normal: "普通期", double: "双倍期" };
const periodOptions = Object.entries(periods).map(([value, label]) => ({ value, label }));
const integerRules = [{ required: true, type: "integer" as const, min: 1, max: Number.MAX_SAFE_INTEGER }];

function readContinuation(key: string): PendingContinuation | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as PendingContinuation | null;
    if (saved?.segment && typeof saved.requestId === "string" && calculateGiftQuote([saved.segment])) return saved;
  } catch {
    // The current page also keeps the request in memory.
  }
}

function saveContinuation(key: string, input?: PendingContinuation) {
  try {
    if (input) sessionStorage.setItem(key, JSON.stringify(input));
    else sessionStorage.removeItem(key);
  } catch {
    // The current page also keeps the request in memory.
  }
}

function requestError(error: unknown) {
  return error instanceof RequestError ? error.message : "请求失败，请检查网络连接后重试";
}

function money(cents: number) {
  return "¥" + formatCentsAsYuan(cents);
}

function decodeSegment({ unitPrice, ...fields }: SegmentFields): GiftPriceSegment {
  return { ...fields, unitPriceCents: parseYuanAsCents(unitPrice) ?? 0 };
}

function segmentFields(prefix: number | undefined) {
  const path = (field: keyof SegmentFields) => prefix === undefined ? field : [prefix, field];
  return <>
    <Form.Item name={path("period")} label="交付时段" rules={[{ required: true }]}><Select options={periodOptions} /></Form.Item>
    <Form.Item name={path("paidGiftTimes")} label="付费赠送次数" rules={integerRules}><InputNumber min={1} /></Form.Item>
    <Form.Item name={path("dailyGiftTimes")} label="日量（次/日）" rules={integerRules}><InputNumber min={1} /></Form.Item>
    <Form.Item name={path("unitPrice")} label="每次服务单价（元/次）" rules={[{ required: true }]}><Input inputMode="decimal" /></Form.Item>
  </>;
}

function SegmentPrice({ segment }: { segment: GiftPriceSegment }) {
  return <Typography.Paragraph>
    {periods[segment.period]} · {segment.paidGiftTimes} 次 · {segment.dailyGiftTimes} 次/日 · {money(segment.unitPriceCents)}/次
  </Typography.Paragraph>;
}

function QuoteSummary({ quote, allowUnlock }: { quote: Quote; allowUnlock: boolean }) {
  return <Typography.Paragraph style={{ marginTop: 8 }}>
    {allowUnlock ? <>爱心款 {money(quote.heartsAmountCents)} · 解锁款 {money(quote.unlockAmountCents)} · </> : null}
    报价合计 {money(quote.totalAmountCents)}
  </Typography.Paragraph>;
}

export default function GiftDispatchPricing({ route, order, onPublished, allowUnlock = false }: {
  route: string;
  order: GiftOrder;
  onPublished?: () => void;
  allowUnlock?: boolean;
}) {
  const { id: userId, token } = useAuthSession();
  const continuationKey = `sky-heart.employee.continuation.v1:${userId}:${route}`;
  const [form] = Form.useForm<PriceFields>();
  const [continuation] = Form.useForm<SegmentFields>();
  const [pendingContinuation, setPendingContinuation] = useState(() => readContinuation(continuationKey));
  const [preparation, setPreparation] = useState<Preparation>();
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const pending = useRef<{ path: string; payload: string; requestId: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    employeeRequest<Preparation>(route + "/pricing", "GET", undefined, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setPreparation(data);
      setDirty(false);
      const saved = readContinuation(continuationKey);
      if (saved && data.continuationQuotes.some(quote => quote.requestId === saved.requestId)) {
        saveContinuation(continuationKey);
        setPendingContinuation(undefined);
      }
      form.setFieldsValue({
        dispatchFee: data.pricing ? formatCentsAsYuan(data.commissionReview?.dispatchFeeCents ?? data.pricing.dispatchFeeCents) : "",
        segments: data.pricing?.giftSegments?.map(segment => ({ ...segment, unitPrice: formatCentsAsYuan(segment.unitPriceCents) }))
          ?? [{ period: "normal", paidGiftTimes: order.requestedGiftTimes, dailyGiftTimes: order.requestedGiftTimes, unitPrice: "" }],
        unlockQuantity: data.pricing?.unlock?.quantity,
        unlockPrice: data.pricing?.unlock ? formatCentsAsYuan(data.pricing.unlock.unitPriceCents) : undefined,
      });
    }).catch(err => {
      if (!controller.signal.aborted) setLoadError(requestError(err));
    });
    return () => controller.abort();
  }, [attempt, continuationKey, form, order.requestedGiftTimes, route]);

  async function write(path: string, method: "POST" | "PATCH", payload: object, onSuccess?: () => void, idempotent = false) {
    if (inFlight.current || getAppToken("employee") !== token) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      let input = payload;
      if (idempotent) {
        const serialized = JSON.stringify(payload);
        const previous = pending.current;
        if (!previous || previous.path !== path || previous.payload !== serialized) {
          pending.current = { path, payload: serialized, requestId: crypto.randomUUID() };
        }
        input = { ...payload, requestId: pending.current!.requestId };
      }
      await employeeRequest(route + path, method, input);
      if (getAppToken("employee") !== token) return;
      pending.current = null;
      onSuccess?.();
      setAttempt(value => value + 1);
    } catch (err) {
      setError(requestError(err));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  const { pricing, rule, receipt, quote, commissionReview, dispatchPricing: frozen } = preparation ?? {};
  const ruleReady = rule?.basis === "gift_times";
  const commissionVersion = commissionReview?.ruleVersion ?? pricing?.ruleVersion;
  const isPublished = preparation?.dispatchStatus === "published";
  const savedGiftQuote = pricing?.giftSegments && calculateGiftQuote(pricing.giftSegments);

  function save(fields: PriceFields) {
    const dispatchFeeCents = parseYuanAsCents(fields.dispatchFee);
    const giftSegments = fields.segments.map(decodeSegment);
    const amounts = calculateGiftQuote(giftSegments);
    const unitPriceCents = parseYuanAsCents(fields.unlockPrice ?? "0");
    if (!ruleReady || !rule || dispatchFeeCents === null || unitPriceCents === null ||
        !amounts || amounts.paidGiftTimes !== order.requestedGiftTimes) {
      setError("请核对各段付费次数、日量、单价、派抽及解锁费用。");
      return;
    }
    void write("/pricing", "PATCH", {
      ruleVersion: rule.version, expectedRevision: pricing?.revision ?? 0, dispatchFeeCents, giftSegments,
      ...(allowUnlock ? { unlock: { quantity: fields.unlockQuantity ?? 0, unitPriceCents } } : {}),
    });
  }

  function review() {
    if (!ruleReady || !rule || !quote) return;
    const dispatchFeeCents = parseYuanAsCents(form.getFieldValue("dispatchFee"));
    if (dispatchFeeCents === null) return setError("请输入合法的每次派抽金额");
    void write("/dispatch-commission", "PATCH", {
      pricingRevision: quote.revision, ruleVersion: rule.version,
      expectedReviewRevision: commissionReview?.revision ?? 0, dispatchFeeCents,
    });
  }

  function publish() {
    if (!ruleReady || !rule || !quote || !onPublished) return;
    void write("/publish", "POST", {
      pricingRevision: quote.revision, ruleVersion: rule.version, commissionReviewRevision: commissionReview?.revision ?? 0,
    }, onPublished, true);
  }

  function addQuote(fields: SegmentFields) {
    if (inFlight.current || pendingContinuation) return;
    const segment = decodeSegment(fields);
    if (!calculateGiftQuote([segment])) return setError("请核对续段的赠送次数、日量和单价。");
    const input = { requestId: crypto.randomUUID(), segment };
    saveContinuation(continuationKey, input);
    setPendingContinuation(input);
    submitContinuation(input);
  }

  function submitContinuation(input: PendingContinuation) {
    void write("/continuation-quotes", "POST", input, () => {
      saveContinuation(continuationKey);
      setPendingContinuation(undefined);
      continuation.resetFields();
    });
  }

  return <Card size="small" title="报价与派发规则">
    <Typography.Paragraph>
      订购 {order.requestedGiftTimes} 次{order.estimatedReceivedHearts === undefined ? "" : " · 预计实收 " + order.estimatedReceivedHearts + " 颗"}
    </Typography.Paragraph>
    {loadError ? <Alert type="error" showIcon title={loadError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
      : !preparation ? <Spin aria-label="加载报价" />
      : isPublished && frozen ? <>
        <Typography.Paragraph>首段规则 V{frozen.version} · 派抽 {money(frozen.dispatchFeeCents)}/次 · 团抽 {money(frozen.clubFeeCents)}/次</Typography.Paragraph>
        {(frozen.giftSegments ?? []).map((segment, index) => <SegmentPrice key={index} segment={segment} />)}
        {quote ? <QuoteSummary quote={quote} allowUnlock={allowUnlock} /> : null}
        {receipt ? <Typography.Paragraph>
          已登记实收 {money(receipt.receivedAmountCents)} · {new Date(receipt.receivedAt).toLocaleString("zh-CN")} · 收款人 {receipt.receivedByUserId}
        </Typography.Paragraph> : null}
        <Typography.Title level={5}>追加计价段报价</Typography.Title>
        {preparation.continuationQuotes.map(item => <div key={item.requestId}>
          <SegmentPrice segment={item.segment} />
          <Typography.Paragraph>报价 {money(item.amountCents)} · 待核款</Typography.Paragraph>
        </div>)}
        {pendingContinuation ? <>
          <SegmentPrice segment={pendingContinuation.segment} />
          <Button loading={busy} onClick={() => submitContinuation(pendingContinuation)}>重试续段报价</Button>
        </> : <Form form={continuation} layout="vertical" initialValues={{ period: "normal" }} onFinish={addQuote}>
          <Flex gap="small" wrap>{segmentFields(undefined)}</Flex>
          <Button type="primary" htmlType="submit" loading={busy}>保存续段报价</Button>
        </Form>}
      </> : !ruleReady ? <Alert type="warning" showIcon title="请由获授权的管理员配置每次团抽" />
      : <>
        <Typography.Paragraph>当前规则 V{rule.version} · 团抽 {money(rule.clubFeeCents)}/次</Typography.Paragraph>
        {!receipt ? <Form form={form} layout="vertical" onFinish={save} onValuesChange={() => setDirty(true)}>
          <Form.Item name="dispatchFee" label="每次派抽（元/次）" rules={[{ required: true }]}><Input inputMode="decimal" /></Form.Item>
          <Form.List name="segments">{(fields, { add, remove }) => <>
            {fields.map(field => <Flex key={field.key} gap="small" align="baseline" wrap>
              {segmentFields(field.name)}
              {fields.length > 1 ? <Button onClick={() => remove(field.name)}>移除</Button> : null}
            </Flex>)}
            <Button onClick={() => add({ period: "normal" })}>增加报价段</Button>
          </>}</Form.List>
          {allowUnlock ? <Flex gap="small" wrap>
            <Form.Item name="unlockQuantity" label="预估解锁数"><InputNumber min={0} max={Number.MAX_SAFE_INTEGER} precision={0} /></Form.Item>
            <Form.Item name="unlockPrice" label="单次解锁费（元）"><Input inputMode="decimal" /></Form.Item>
          </Flex> : null}
          <Button type="primary" htmlType="submit" loading={busy} style={{ marginTop: 8 }}>保存报价</Button>
        </Form> : <>
          <Typography.Paragraph>已登记实收 {money(receipt.receivedAmountCents)}</Typography.Paragraph>
          <Form form={form} layout="vertical" onFinish={review} onValuesChange={() => setDirty(true)}>
            <Form.Item name="dispatchFee" label="复核每次派抽（元/次）"><Input inputMode="decimal" /></Form.Item>
            <Button htmlType="submit" loading={busy}>保存派抽复核</Button>
          </Form>
        </>}
        {quote ? <QuoteSummary quote={quote} allowUnlock={allowUnlock} /> : savedGiftQuote ? <Typography.Paragraph style={{ marginTop: 8 }}>
          已保存爱心款报价 {money(savedGiftQuote.amountCents)}
        </Typography.Paragraph> : null}
        {onPublished && quote && !receipt && !dirty ? <Form key={quote.revision} layout="vertical" onFinish={({ amount, receivedAt }: { amount: string; receivedAt: string }) => {
          const receivedAmountCents = parseYuanAsCents(amount);
          const time = new Date(receivedAt);
          if (!receivedAmountCents || !Number.isFinite(time.getTime())) return setError("请填写实收金额和时间。");
          void write("/receipts", "POST", { pricingRevision: quote.revision, receivedAmountCents, receivedAt: time.toISOString() }, undefined, true);
        }}>
          <Flex gap="small" wrap>
            <Form.Item name="amount" label="实收金额（元）" initialValue={formatCentsAsYuan(quote.totalAmountCents)} rules={[{ required: true }]}><Input inputMode="decimal" /></Form.Item>
            <Form.Item name="receivedAt" label="实收时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
          </Flex>
          <Button htmlType="submit" loading={busy}>登记实收</Button>
        </Form> : null}
        {onPublished && receipt ? <Flex gap="small" align="center" style={{ marginTop: 8 }}>
          <Button type="primary" loading={busy}
            disabled={dirty || preparation.paymentStatus !== "paid_in_full" || commissionVersion !== rule.version} onClick={publish}>正式派发</Button>
          {preparation.paymentStatus !== "paid_in_full" ? <Typography.Text>实收与报价的差额待核对</Typography.Text>
            : commissionVersion !== rule.version ? <Typography.Text>规则已更新，请复核派抽</Typography.Text> : null}
        </Flex> : null}
      </>}
    {error ? <Alert type="error" showIcon title={error} style={{ marginTop: 8 }}
      action={<Button onClick={() => { setError(""); setAttempt(value => value + 1); }}>重新加载</Button>} /> : null}
  </Card>;
}
