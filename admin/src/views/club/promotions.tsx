import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Flex, Form, Input, InputNumber, Select, Spin } from "antd";
import { parseYuanAsCents, platformPromotionDescription, type ClubPromotionPolicy } from "@webapp-template/common";
import { getClubPromotions, issueClubCoupon, saveClubPromotions } from "@/api/club.api";

type ActivityFields = { name?: string; payablePercent?: number };
type CouponFields = {
  customerUserId: string; name: string; kind: "rate_coupon" | "threshold_coupon";
  payablePercent?: number; threshold?: string; discount?: string;
};

function errorText(error: unknown) {
  return error && typeof error === "object" && "message" in error ? String(error.message) : "平台优惠操作失败";
}

function basisPoints(percent: number | undefined) {
  return percent == null ? undefined : Math.round(percent * 100);
}

export default function ClubPromotions({ clubId }: { clubId: string }) {
  const [policy, setPolicy] = useState<ClubPromotionPolicy>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pendingCoupon = useRef<{ fields: string; requestId: string } | null>(null);
  const [activity] = Form.useForm<ActivityFields>();
  const [coupon] = Form.useForm<CouponFields>();
  const couponKind = Form.useWatch("kind", coupon);

  useEffect(() => {
    let active = true;
    getClubPromotions(clubId).then(value => {
      if (!active || !value) return;
      setPolicy(value);
      activity.setFieldsValue({ name: value.activity?.name,
        payablePercent: value.activity ? value.activity.payableBasisPoints / 100 : undefined });
    }).catch(error => { if (active) setError(errorText(error)); });
    return () => { active = false; };
  }, [activity, clubId, attempt]);

  async function write(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try { await action(); } catch (error) { setError(errorText(error)); }
    finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function saveActivity(values: ActivityFields) {
    if (!policy) return;
    void write(async () => {
      const result = await saveClubPromotions(clubId, { expectedVersion: policy.version,
        activityName: values.name?.trim() || undefined, activityPayableBasisPoints: basisPoints(values.payablePercent) });
      if (!result) return;
      setPolicy(result);
      setSuccess(result.activity ? `全场折扣 V${result.version} 已启用` : "全场折扣已停用");
    });
  }

  function issue(values: CouponFields) {
    const terms = values.kind === "rate_coupon" ? { payableBasisPoints: basisPoints(values.payablePercent) } : {
      thresholdCents: parseYuanAsCents(values.threshold) ?? undefined,
      discountCents: parseYuanAsCents(values.discount) ?? undefined,
    };
    const input = { customerUserId: values.customerUserId.trim().toUpperCase(), name: values.name.trim(), kind: values.kind, ...terms };
    void write(async () => {
      const fields = JSON.stringify(input);
      if (pendingCoupon.current?.fields !== fields) pendingCoupon.current = { fields, requestId: crypto.randomUUID() };
      const result = await issueClubCoupon(clubId, { ...input, requestId: pendingCoupon.current.requestId });
      if (!result) return;
      pendingCoupon.current = null;
      coupon.resetFields();
      setSuccess(`已向 ${input.customerUserId} 发放 ${platformPromotionDescription(result)}`);
    });
  }

  return <Card title="平台优惠">
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => { setError(""); setAttempt(value => value + 1); }}>重新读取</Button>} />}
    {success && <Alert type="success" showIcon title={success} />}
    {!policy ? !error && <Spin aria-label="加载平台优惠" /> : <>
      <Form name="club-wide-activity" form={activity} layout="vertical" onFinish={saveActivity} disabled={busy}>
        <Flex wrap gap="small">
          <Form.Item name="name" label="全场折扣活动名称"><Input maxLength={80} /></Form.Item>
          <Form.Item name="payablePercent" label="服务款实付比例（%）"><InputNumber min={0} max={99.99} precision={2} /></Form.Item>
        </Flex>
        <Flex gap="small" wrap>
          <Button type="primary" htmlType="submit" loading={busy}>保存全场折扣</Button>
          {policy.activity && <Button onClick={() => { activity.setFieldsValue({ name: undefined, payablePercent: undefined }); saveActivity({}); }}>停用活动</Button>}
        </Flex>
      </Form>
      <Form name="club-coupon-issuance" form={coupon} layout="vertical" onFinish={issue} initialValues={{ kind: "threshold_coupon" }} disabled={busy} style={{ marginTop: 20 }}>
        <Flex wrap gap="small">
          <Form.Item name="customerUserId" label="领券老板的四位 ID" rules={[{ required: true, pattern: /^[a-z0-9]{4}$/i }]}>
            <Input maxLength={4} />
          </Form.Item>
          <Form.Item name="name" label="优惠券名称" rules={[{ required: true }]}><Input maxLength={80} /></Form.Item>
          <Form.Item name="kind" label="券种"><Select options={[
            { value: "threshold_coupon", label: "满减优惠券" }, { value: "rate_coupon", label: "折扣券" },
          ]} /></Form.Item>
          {couponKind === "rate_coupon" ? <Form.Item name="payablePercent" label="服务款实付比例（%）" rules={[{ required: true }]}>
            <InputNumber min={0} max={99.99} precision={2} />
          </Form.Item> : <>
            <Form.Item name="threshold" label="折前服务款门槛（元）" rules={[{ required: true }]}><Input inputMode="decimal" /></Form.Item>
            <Form.Item name="discount" label="减免金额（元）" rules={[{ required: true }]}><Input inputMode="decimal" /></Form.Item>
          </>}
        </Flex>
        <Button type="primary" htmlType="submit" loading={busy}>发放优惠券</Button>
      </Form>
    </>}
  </Card>;
}
