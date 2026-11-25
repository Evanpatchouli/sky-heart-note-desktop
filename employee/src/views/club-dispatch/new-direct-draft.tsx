import { useEffect, useRef, useState } from "react";
import { Alert, Form, Input, InputNumber, Modal, Radio, Select } from "antd";
import { DELIVERY_PERIOD_PREFERENCES, USER_ID_PATTERN, deliveryPeriodPreferenceLabel, estimateReceivedHearts, type DeliveryPeriodPreference } from "@sky-club/common";
import { getAppToken, RequestError, useAuthSession } from "@sky-club/common/web-auth";
import { employeeRequest } from "#/service/request";

type CustomerCandidate = { userId: string; nickname: string | null };
type DraftFields = {
  recipientGameAccount: string;
  requestedGiftTimes: number;
  estimatedReceivedHearts?: number;
  deliveryPeriodPreference?: DeliveryPeriodPreference;
  doubleGiftTimes?: number;
  customerMode: "existing" | "new";
  customer?: { value: string; label: string };
  newCustomerNickname?: string;
};
type DraftRequest = {
  requestId: string;
  recipientGameAccount: string;
  requestedGiftTimes?: number;
  requestedHearts?: number;
  estimatedReceivedHearts?: number;
  deliveryPeriodPreference?: DeliveryPeriodPreference;
  doubleGiftTimes?: number;
} & ({ existingCustomerUserId: string; newCustomerNickname?: never } | { newCustomerNickname: string; existingCustomerUserId?: never });
type SavedOrder = { id: string; source: string; customerUserId: string; customerLinkStatus: string };
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const memoryPending = new Map<string, DraftRequest>();
const unknownResult = "暂时无法确认创建结果。请重试本次提交，已创建的草稿会原样返回。";

function readPending(key: string) {
  if (memoryPending.has(key)) return memoryPending.get(key);
  try {
    const input = JSON.parse(sessionStorage.getItem(key) ?? "null") as DraftRequest | null;
    if (input && requestIdPattern.test(input.requestId) &&
        typeof input.recipientGameAccount === "string" && input.recipientGameAccount.trim() && input.recipientGameAccount.length <= 120 &&
        Number.isSafeInteger(input.requestedGiftTimes ?? input.requestedHearts) &&
        (input.requestedGiftTimes ?? input.requestedHearts ?? 0) > 0 &&
        (input.existingCustomerUserId === undefined
          ? typeof input.newCustomerNickname === "string" && input.newCustomerNickname.trim() && input.newCustomerNickname.length <= 100
          : USER_ID_PATTERN.test(input.existingCustomerUserId) && input.newCustomerNickname === undefined)) return input;
  } catch {
    // This tab can also retain the submission in memory.
  }
}

function savePending(key: string, input?: DraftRequest) {
  if (input) memoryPending.set(key, input);
  else memoryPending.delete(key);
  try {
    if (input) sessionStorage.setItem(key, JSON.stringify(input));
    else sessionStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in a restricted browser.
  }
}

function requestError(err: unknown) {
  return err instanceof RequestError ? err.message : "请求失败，请检查网络连接后重试";
}

export default function NewDirectDraft({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { id: userId, token } = useAuthSession();
  const storageKey = `sky-heart.employee.direct-draft.v1:${userId}`;
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [form] = Form.useForm<DraftFields>();
  const newCustomer = Form.useWatch("customerMode", form) === "new";
  const giftTimes = Form.useWatch("requestedGiftTimes", form);
  const period = Form.useWatch("deliveryPeriodPreference", form);
  const doubleGiftTimes = Form.useWatch("doubleGiftTimes", form);
  const suggestedEstimate = estimateReceivedHearts(giftTimes, period, doubleGiftTimes ?? undefined);
  const [search, setSearch] = useState("");
  const [lookup, setLookup] = useState<{ query: string; candidates: CustomerCandidate[]; error?: string }>();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const query = search.trim();
  const activeLookup = lookup?.query === query ? lookup : undefined;
  const clubRoute = "club";

  useEffect(() => {
    if (pending || newCustomer || !query) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query });
    const timer = window.setTimeout(() => {
      employeeRequest<CustomerCandidate[]>(`${clubRoute}/order-customers?${params}`, "GET", undefined, controller.signal).then(candidates => {
        if (!controller.signal.aborted) setLookup({ query, candidates });
      }).catch(err => {
        if (!controller.signal.aborted) setLookup({ query, candidates: [], error: requestError(err) });
      });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [clubRoute, newCustomer, pending, query]);

  function save(values: DraftFields) {
    if (pending || inFlight.current) return;
    const doubleGiftTimes = values.deliveryPeriodPreference === "split" ? values.doubleGiftTimes ?? undefined : undefined;
    if (doubleGiftTimes !== undefined && doubleGiftTimes >= values.requestedGiftTimes) {
      setError("双倍期赠送次数须少于订购总次数。");
      return;
    }
    const fields = {
      requestId: crypto.randomUUID(),
      recipientGameAccount: values.recipientGameAccount.trim(),
      requestedGiftTimes: values.requestedGiftTimes,
      estimatedReceivedHearts: values.estimatedReceivedHearts ?? undefined,
      deliveryPeriodPreference: values.deliveryPeriodPreference,
      doubleGiftTimes,
    };
    if (values.customerMode === "new" && values.newCustomerNickname?.trim()) {
      void submit({ ...fields, newCustomerNickname: values.newCustomerNickname.trim() });
    } else if (values.customerMode === "existing" && values.customer?.value) {
      void submit({ ...fields, existingCustomerUserId: values.customer.value });
    }
  }

  async function submit(input: DraftRequest) {
    if (inFlight.current || getAppToken("employee") !== token) return;
    inFlight.current = true;
    savePending(storageKey, input);
    setPending(input);
    setSubmitting(true);
    setError("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const order = await employeeRequest<SavedOrder>(`${clubRoute}/orders`, "POST", input, controller.signal);
      if (!order?.id || order.source !== "direct_dispatch" ||
          order.customerLinkStatus !== "verified" || !USER_ID_PATTERN.test(order.customerUserId) ||
          (input.existingCustomerUserId && order.customerUserId !== input.existingCustomerUserId)) {
        throw new Error(unknownResult);
      }
      if (readPending(storageKey)?.requestId === input.requestId) savePending(storageKey);
      if (getAppToken("employee") !== token) return;
      onCreated(order.id);
    } catch (err) {
      if (getAppToken("employee") !== token) return;
      if (err instanceof RequestError && [400, 404, 409].includes(err.status)) {
        if (readPending(storageKey)?.requestId === input.requestId) savePending(storageKey);
        setPending(undefined);
        setError(err.message);
      } else {
        setError(unknownResult);
      }
    } finally {
      window.clearTimeout(timer);
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return <Modal title="新建直接派单草稿" open onCancel={onClose} onOk={() => pending ? void submit(pending) : form.submit()}
    okText={pending ? "重试本次提交" : "创建草稿"} cancelText={pending ? "关闭" : "取消"}
    confirmLoading={submitting} cancelButtonProps={{ disabled: submitting }} closable={!submitting} keyboard={!submitting} mask={{ closable: !submitting }}>
    <Form form={form} layout="vertical" initialValues={{
      customerMode: pending?.newCustomerNickname ? "new" : "existing",
      customer: pending?.existingCustomerUserId ? { value: pending.existingCustomerUserId, label: pending.existingCustomerUserId } : undefined,
      newCustomerNickname: pending?.newCustomerNickname,
      recipientGameAccount: pending?.recipientGameAccount,
      requestedGiftTimes: pending?.requestedGiftTimes,
      estimatedReceivedHearts: pending?.estimatedReceivedHearts,
      deliveryPeriodPreference: pending?.deliveryPeriodPreference,
      doubleGiftTimes: pending?.doubleGiftTimes,
    }} disabled={Boolean(pending) || submitting} onFinish={save}>
      <Form.Item label="老板" name="customerMode">
        <Radio.Group options={[{ label: "已有用户", value: "existing" }, { label: "新老板", value: "new" }]} />
      </Form.Item>
      {newCustomer ?
        <Form.Item label="新老板昵称" name="newCustomerNickname" preserve={false} rules={[{ required: true, whitespace: true }]}>
          <Input maxLength={100} />
        </Form.Item> :
        <Form.Item label="搜索用户名、昵称或四位 ID" name="customer" preserve={false} rules={[{ required: true, message: "请选择已有用户" }]}>
          <Select labelInValue allowClear placeholder="输入用户名、昵称或四位 ID"
            showSearch={{ filterOption: false, onSearch: value => setSearch(value.slice(0, 100)) }}
            loading={Boolean(query && !activeLookup)}
            notFoundContent={activeLookup?.error ?? (query ? activeLookup ? "没有匹配的用户" : "搜索中…" : "输入关键词搜索")}
            options={query ? activeLookup?.candidates.map(({ userId, nickname }) => ({ value: userId, label: `${nickname || "未设置昵称"} · ${userId}` })) : []} />
        </Form.Item>}
      <Form.Item label="接收爱心的游戏账号" name="recipientGameAccount" rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
      {pending?.requestedHearts !== undefined ? <p>上次提交的订购颗数 · {pending.requestedHearts} 颗</p> : <>
        <Form.Item label="订购赠送次数" name="requestedGiftTimes" rules={[{ required: true, type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER }]}><InputNumber min={1} /></Form.Item>
        <Form.Item label="预计交付时段（选填）" name="deliveryPeriodPreference">
          <Select allowClear placeholder="待确认" options={DELIVERY_PERIOD_PREFERENCES.map(value => ({
            value, label: deliveryPeriodPreferenceLabel[value],
          }))} />
        </Form.Item>
        {period === "split" ? <Form.Item label="双倍期赠送次数（选填）" name="doubleGiftTimes" preserve={false}
          rules={[{ type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER }]}>
          <InputNumber min={1} />
        </Form.Item> : null}
        <Form.Item label="建单预计实收爱心颗数（选填）" name="estimatedReceivedHearts"
          extra={suggestedEstimate === undefined ? "按赠送次数计价。时段或分段次数待确认时，可以留空。" : `留空时按预计时段记录 ${suggestedEstimate} 颗。按赠送次数计价。`}
          rules={[{ type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER }]}>
          <InputNumber min={1} />
        </Form.Item>
      </>}
    </Form>
    {error ? <Alert type="error" showIcon title={error} />
      : pending && !submitting ? <Alert type="warning" showIcon title={unknownResult} /> : null}
  </Modal>;
}
