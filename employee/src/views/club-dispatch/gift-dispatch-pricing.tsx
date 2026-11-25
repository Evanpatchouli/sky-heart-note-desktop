import { useEffect, useRef, useState } from "react";
import GiftSettlementCard from "../club-assignments/gift-settlement";
import { Alert, Button, Card, Flex, Form, Input, InputNumber, Modal, Select, Spin, Typography } from "antd";
import {
  calculateGiftQuote, deliveryPeriodPreferenceLabel, formatCentsAsYuan, giftFulfillmentSegments, parseYuanAsCents, platformPromotionDescription, platformPromotionLabels,
  type ClubPromotionPolicy, type CommissionRule, type ContinuationQuote, type ContinuationRequest, type CustomerQuote, type DeliveryPeriodPreference, type DispatchPricing, type GiftPriceSegment, type GiftSegmentDispatchInput, type OrderPricing, type PlatformPromotionSource,
} from "@webapp-template/common";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";
import { GiftDispatchForm, PublishedGiftAllocation } from "./gift-allocation";
import { GiftContinuationManagement } from "./gift-continuations";

type GiftOrder = {
  requestedGiftTimes: number;
  estimatedReceivedHearts?: number;
  deliveryPeriodPreference?: DeliveryPeriodPreference;
  doubleGiftTimes?: number;
};

type Receipt = { receivedAmountCents: number; receivedAt: string; receivedByUserId: string; recordedByUserId: string };
type Preparation = {
  dispatchStatus: string;
  dispatchPricing: DispatchPricing | null;
  pricing: OrderPricing | null;
  rule: CommissionRule | null;
  promotionPolicy?: ClubPromotionPolicy;
  promotionCoupons?: PlatformPromotionSource[];
  requestedPromotionCouponId?: string;
  continuationQuotes: ContinuationQuote[];
  continuationRequests?: ContinuationRequest[];
  canManageContinuation?: boolean;
  quote: CustomerQuote | null;
  receipt: Receipt | null;
  paymentStatus?: string;
  giftDeliveryStopped?: boolean;
  commissionReview?: { revision: number; ruleVersion: number; dispatchFeeCents: number } | null;
};
type SegmentFields = Omit<GiftPriceSegment, "unitPriceCents"> & { unitPrice: string };
type PendingContinuation = Pick<ContinuationQuote, "requestId" | "segment">;
type PriceFields = {
  dispatchFee: string;
  segments: SegmentFields[];
  personalDiscount?: string;
  platformCoupon?: string;
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

function decodeSegment({ unitPrice, promotionalGiftTimes, ...fields }: SegmentFields): GiftPriceSegment {
  return {
    ...fields, unitPriceCents: parseYuanAsCents(unitPrice) ?? 0,
    ...(promotionalGiftTimes == null ? {} : { promotionalGiftTimes }),
  };
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

function initialSegments(giftTimes: number, period?: DeliveryPeriodPreference, doubleTimes?: number) {
  const segment = (times: number, deliveryPeriod?: GiftPriceSegment["period"]) => ({
    period: deliveryPeriod, paidGiftTimes: times, dailyGiftTimes: times, unitPrice: "",
  });
  if (period === "split" && doubleTimes !== undefined) {
    return [segment(doubleTimes, "double"), segment(giftTimes - doubleTimes, "normal")];
  }
  return [segment(giftTimes, period === "split" ? undefined : period)];
}

function QuoteSummary({ quote }: { quote: CustomerQuote }) {
  const { promotions } = quote;
  return <div style={{ marginTop: 8 }}>
    {promotions && <>
      <p>折前爱心款 {money(promotions.originalServiceCents)}</p>
      {promotions.platform && <p>团费承担 · {platformPromotionLabels[promotions.platform.kind]}「{promotions.platform.name}」−{money(promotions.platform.amountCents)}</p>}
      {promotions.personal && <p>派单人承担 · 个人让利 −{money(promotions.personal.amountCents)}</p>}
      {promotions.gift && <p>团费承担 · 促销赠送 {promotions.gift.segments.reduce((sum, gift) => sum + gift.promotionalGiftTimes, 0)} 次 · 首次报价总履约 {promotions.totalGiftTimes} 次</p>}
    </>}
    <p>应付服务款 {money(quote.totalAmountCents)}</p>
  </div>;
}

function ReceiptDetails({ receipt }: { receipt: Receipt }) {
  return <Typography.Paragraph>
    {receipt.receivedAmountCents === 0
      ? `已确认零元单 · 确认人 ${receipt.recordedByUserId}`
      : `已登记实收 ${money(receipt.receivedAmountCents)} · 收款人 ${receipt.receivedByUserId} · 经办人 ${receipt.recordedByUserId}`}
    {" · "}{new Date(receipt.receivedAt).toLocaleString("zh-CN")}
  </Typography.Paragraph>;
}

export default function GiftDispatchPricing({ route, order, onPublished, onFulfillmentChanged }: {
  route: string;
  order: GiftOrder;
  onPublished?: () => void;
  onFulfillmentChanged?: () => void;
}) {
  const { id: userId, token } = useAuthSession();
  const { requestedGiftTimes, deliveryPeriodPreference, doubleGiftTimes } = order;
  const continuationKey = `sky-heart.employee.continuation.v1:${userId}:${route}`;
  const [form] = Form.useForm<PriceFields>();
  const [continuation] = Form.useForm<SegmentFields>();
  const [pendingContinuation, setPendingContinuation] = useState(() => readContinuation(continuationKey));
  const [preparation, setPreparation] = useState<Preparation>();
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const zeroReceipt = useRef<{ pricingRevision: number; receivedAt: string } | undefined>(undefined);
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
        segments: data.pricing?.giftSegments?.map((segment, index) => ({ ...segment, unitPrice: formatCentsAsYuan(segment.unitPriceCents),
          promotionalGiftTimes: data.pricing?.promotions?.gift?.segments.find(gift => gift.sourceSegmentIndex === index)?.promotionalGiftTimes }))
          ?? initialSegments(requestedGiftTimes, deliveryPeriodPreference, doubleGiftTimes),
        personalDiscount: data.pricing?.promotions?.personal ? formatCentsAsYuan(data.pricing.promotions.personal.amountCents) : "",
        platformCoupon: (data.pricing?.promotions ? data.pricing.promotions.selectedCouponId : data.requestedPromotionCouponId) ?? "",
      });
    }).catch(err => {
      if (!controller.signal.aborted) setLoadError(requestError(err));
    });
    return () => controller.abort();
  }, [attempt, continuationKey, form, requestedGiftTimes, deliveryPeriodPreference, doubleGiftTimes, route]);

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
  const maxGifts = Math.floor(requestedGiftTimes / 10);
  const executionSegments = quote?.giftSegments && giftFulfillmentSegments(quote.giftSegments, quote.promotions);
  const coupons = preparation?.promotionCoupons ?? [];
  const savedCouponId = (pricing?.promotions ? pricing.promotions.selectedCouponId : preparation?.requestedPromotionCouponId) ?? "";
  const commissionVersion = commissionReview?.ruleVersion ?? pricing?.ruleVersion;
  const isPublished = preparation?.dispatchStatus === "published";
  function save(fields: PriceFields) {
    const dispatchFeeCents = parseYuanAsCents(fields.dispatchFee);
    const giftSegments = fields.segments.map(decodeSegment);
    const amounts = calculateGiftQuote(giftSegments);
    const personalDiscountCents = parseYuanAsCents(fields.personalDiscount?.trim() || "0");
    const promotionalGiftTimes = giftSegments.reduce((sum, segment) => sum + (segment.promotionalGiftTimes ?? 0), 0);
    if (promotionalGiftTimes > maxGifts) {
      setError(`各段促销赠送合计最多 ${maxGifts} 次。`);
      return;
    }
    if (!ruleReady || !rule || dispatchFeeCents === null || personalDiscountCents === null ||
        !amounts || amounts.paidGiftTimes !== requestedGiftTimes) {
      setError("请核对各段付费次数、日量、单价、派抽和个人让利。");
      return;
    }
    void write("/pricing", "PATCH", {
      ruleVersion: rule.version, expectedRevision: pricing?.revision ?? 0, dispatchFeeCents, giftSegments,
      personalDiscountCents,
      ...(fields.platformCoupon !== undefined && fields.platformCoupon !== savedCouponId ? { platformCouponId: fields.platformCoupon || null } : {}),
    });
  }

  function confirmZeroReceipt(pricingRevision: number) {
    if (zeroReceipt.current?.pricingRevision !== pricingRevision) {
      zeroReceipt.current = { pricingRevision, receivedAt: new Date().toISOString() };
    }
    void write("/receipts", "POST", { ...zeroReceipt.current, receivedAmountCents: 0 }, undefined, true);
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

  function publish(giftDispatchSegments: GiftSegmentDispatchInput[]) {
    if (!ruleReady || !rule || !quote || !onPublished) return;
    void write("/publish", "POST", {
      pricingRevision: quote.revision, ruleVersion: rule.version, commissionReviewRevision: commissionReview?.revision ?? 0,
      giftDispatchSegments,
    }, () => { setPublishOpen(false); onPublished(); }, true);
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
      订购赠送 {requestedGiftTimes} 次 · 建单预计实收爱心 {order.estimatedReceivedHearts === undefined ? "待确认" : `${order.estimatedReceivedHearts} 颗`}
      {deliveryPeriodPreference ? ` · ${deliveryPeriodPreferenceLabel[deliveryPeriodPreference]}` : ""}
    </Typography.Paragraph>
    {loadError ? <Alert type="error" showIcon title={loadError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
      : !preparation ? <Spin aria-label="加载报价" />
      : preparation.giftDeliveryStopped && !isPublished ? <Flex vertical gap="middle">
        <Alert type="info" showIcon title="已停送" />
        {quote ? <QuoteSummary quote={quote} /> : null}
        {receipt ? <ReceiptDetails receipt={receipt} /> : null}
        <GiftSettlementCard route={route} revision={attempt} role="dispatcher" />
      </Flex>
      : isPublished && frozen ? <>
        <Typography.Paragraph>首段规则 V{frozen.version} · 派抽 {money(frozen.dispatchFeeCents)}/次 · 团抽 {money(frozen.clubFeeCents)}/次</Typography.Paragraph>
        {(frozen.giftSegments ?? []).map((segment, index) => <SegmentPrice key={index} segment={segment} />)}
        {quote ? <QuoteSummary quote={quote} /> : null}
        {receipt ? <ReceiptDetails receipt={receipt} /> : null}
        <GiftContinuationManagement route={route} requests={preparation.continuationRequests ?? []} quotes={preparation.continuationQuotes}
          enabled={!!preparation.canManageContinuation} onChange={() => {
            setAttempt(value => value + 1);
            onFulfillmentChanged?.();
          }} />
        {preparation.canManageContinuation && <details>
        <summary>直接新增续段报价</summary>
        {pendingContinuation ? <>
          <SegmentPrice segment={pendingContinuation.segment} />
          <Button loading={busy} onClick={() => submitContinuation(pendingContinuation)}>重试续段报价</Button>
        </> : <Form form={continuation} layout="vertical" initialValues={{ period: "normal" }} onFinish={addQuote}>
          <Flex gap="small" wrap>{segmentFields(undefined)}</Flex>
          <Button type="primary" htmlType="submit" loading={busy}>保存续段报价</Button>
        </Form>}</details>}
        <PublishedGiftAllocation route={route} revision={attempt} onChanged={onFulfillmentChanged} />
      </> : !ruleReady ? <Alert type="warning" showIcon title="请由获授权的管理员配置每次团抽" />
      : <>
        <Typography.Paragraph>当前规则 V{rule.version} · 团抽 {money(rule.clubFeeCents)}/次</Typography.Paragraph>
        {preparation.promotionPolicy?.activity && <p>本团全场折扣活动「{preparation.promotionPolicy.activity.name}」 · 服务款实付 {preparation.promotionPolicy.activity.payableBasisPoints / 100}%</p>}
        {!receipt ? <Form form={form} layout="vertical" onFinish={save} onValuesChange={() => setDirty(true)}>
          <Form.Item name="dispatchFee" label="每次派抽（元/次）" rules={[{ required: true }]}><Input inputMode="decimal" /></Form.Item>
          {maxGifts > 0 && <p>本单各段促销赠送合计最多 {maxGifts} 次，由本团团费承担。</p>}
          <Form.List name="segments">{(fields, { add, remove }) => <>
            {fields.map(field => <Flex key={field.key} gap="small" align="baseline" wrap>
              {segmentFields(field.name)}
              {maxGifts > 0 && <Form.Item name={[field.name, "promotionalGiftTimes"]} label={`第 ${field.name + 1} 段促销赠送次数`}>
                <InputNumber min={0} max={maxGifts} precision={0} placeholder="0" />
              </Form.Item>}
              {fields.length > 1 ? <Button onClick={() => remove(field.name)}>移除</Button> : null}
            </Flex>)}
            <Button onClick={() => add({ period: "normal" })}>增加报价段</Button>
          </>}</Form.List>
          <Flex gap="small" wrap>
            {(coupons.length > 0 || savedCouponId) && <Form.Item name="platformCoupon" label="老板优惠券" extra="有效用券时替代全场折扣。">
              <Select style={{ minWidth: 220 }} options={[
                { value: "", label: preparation.promotionPolicy?.activity ? "不用券 · 应用全场折扣" : "不用券" },
                ...(savedCouponId && !coupons.some(coupon => coupon.couponId === savedCouponId)
                  ? [{ value: savedCouponId, label: "原选券已不可用", disabled: true }] : []),
                ...coupons.map(coupon => ({ value: coupon.couponId!, label: platformPromotionDescription(coupon) })),
              ]} />
            </Form.Item>}
            <Form.Item name="personalDiscount" label="派单人个人让利（元）"><Input inputMode="decimal" placeholder="0.00" /></Form.Item>
          </Flex>
          <Button type="primary" htmlType="submit" loading={busy} style={{ marginTop: 8 }}>保存报价</Button>
        </Form> : <>
          {quote?.giftSegments?.map((segment, index) => <SegmentPrice key={index} segment={segment} />)}
          <ReceiptDetails receipt={receipt} />
          <Form form={form} layout="vertical" onFinish={review} onValuesChange={() => setDirty(true)}>
            <Form.Item name="dispatchFee" label="复核每次派抽（元/次）"><Input inputMode="decimal" /></Form.Item>
            <Button htmlType="submit" loading={busy}>保存派抽复核</Button>
          </Form>
        </>}
        {quote ? <QuoteSummary quote={quote} /> : null}
        {quote?.promotions?.couponIssue && <Alert type="warning" showIcon
          title={quote.promotions.couponIssue === "threshold" ? "原选券未达到折前服务款门槛" : "原选券已不可用"} />}
        {onPublished && quote && !receipt && !dirty ? quote.totalAmountCents === 0 ?
          <Button loading={busy} onClick={() => confirmZeroReceipt(quote.revision)}>确认零元单</Button> : <Form key={quote.revision} layout="vertical" onFinish={({ amount, receivedAt }: { amount: string; receivedAt: string }) => {
          const receivedAmountCents = parseYuanAsCents(amount);
          const time = new Date(receivedAt);
          if (receivedAmountCents === null || !Number.isFinite(time.getTime())) return setError("请填写实收金额和时间。");
          void write("/receipts", "POST", { pricingRevision: quote.revision, receivedAmountCents, receivedAt: time.toISOString() }, undefined, true);
        }}>
          <Flex gap="small" wrap>
            <Form.Item name="amount" label="实收金额（元）" rules={[{ required: true }]}><Input inputMode="decimal" /></Form.Item>
            <Form.Item name="receivedAt" label="实收时间" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
          </Flex>
          <Button htmlType="submit" loading={busy}>登记实收</Button>
        </Form> : null}
        {onPublished && receipt ? <Flex gap="small" align="center" style={{ marginTop: 8 }}>
          <Button type="primary" loading={busy}
            disabled={dirty || preparation.paymentStatus !== "paid_in_full" || commissionVersion !== rule.version} onClick={() => { setError(""); setPublishOpen(true); }}>正式派发</Button>
          {preparation.paymentStatus !== "paid_in_full" ? <Typography.Text>实收与报价的差额待核对</Typography.Text>
            : commissionVersion !== rule.version ? <Typography.Text>规则已更新，请复核派抽</Typography.Text> : null}
        </Flex> : null}
      </>}
    <Modal open={publishOpen} destroyOnHidden title="正式派发与各段分工" footer={null} onCancel={() => !busy && setPublishOpen(false)}>
      {error && <Alert type="error" showIcon title={error} />}
      {executionSegments?.length ? <GiftDispatchForm quotes={executionSegments} indices={executionSegments.map((_, index) => index)}
        clubRoute={route.split("/orders/")[0]} submitLabel="确认正式派发" busy={busy} onSubmit={publish} /> : null}
    </Modal>
    {!publishOpen && error ? <Alert type="error" showIcon title={error} style={{ marginTop: 8 }}
      action={<Button onClick={() => { setError(""); setAttempt(value => value + 1); }}>重新加载</Button>} /> : null}
  </Card>;
}
