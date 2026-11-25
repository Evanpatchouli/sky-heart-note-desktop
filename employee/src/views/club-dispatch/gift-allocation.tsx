import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Flex, Form, Input, InputNumber, Modal, Select, Spin, Typography } from "antd";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import type { GiftDayAllocation, GiftDispatchPreparation, GiftPriceSegment, GiftSegmentDispatchInput, GiftShare } from "@webapp-template/common";
import { employeeRequest } from "#/service/request";

type Candidate = GiftDispatchPreparation["candidates"][number];
type InitialFields = { segments: GiftSegmentDispatchInput[] };
type TransferInput = { requestId: string; shareId: string; userId: string; giftTimes?: number };

function readTransfer(key: string): TransferInput | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as TransferInput | null;
    if (saved && typeof saved.requestId === "string" && typeof saved.shareId === "string" && typeof saved.userId === "string") return saved;
  } catch { /* The page can still retain the request while open. */ }
}

function persistTransfer(key: string, input?: TransferInput) {
  try {
    if (input) sessionStorage.setItem(key, JSON.stringify(input));
    else sessionStorage.removeItem(key);
  } catch { /* The page can still retain the request while open. */ }
}

const integer = [{ required: true, type: "integer" as const, min: 1, max: Number.MAX_SAFE_INTEGER }];

function getError(error: unknown) {
  return error instanceof RequestError ? error.message : "未收到处理结果，请重试";
}

function dateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaults(quote: GiftPriceSegment, index: number): GiftSegmentDispatchInput {
  const date = new Date(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date()) + "T00:00:00Z");
  const startDate = dateString(date);
  date.setUTCDate(date.getUTCDate() + Math.min(3659, Math.ceil(quote.paidGiftTimes / quote.dailyGiftTimes) - 1));
  return { segmentIndex: index, startDate, endDate: dateString(date), openToClaim: true, directed: [] };
}

function candidateOptions(candidates: Candidate[], omit?: string) {
  return candidates.filter(({ userId }) => userId !== omit).map(({ userId, nickname }) => ({
    value: userId, label: nickname ? nickname + " · " + userId : userId,
  }));
}

export function GiftSchedule({ schedule }: { schedule: GiftDayAllocation[] }) {
  return schedule.length ? <ul style={{ marginBlock: 4, paddingInlineStart: 24 }}>{schedule.map(day =>
    <li key={day.startDate}>{day.startDate}{day.startDate === day.endDate ? "" : " 至 " + day.endDate} · {day.dailyGiftTimes} 次/日</li>,
  )}</ul> : null;
}

export function GiftDispatchForm({ quotes, indices, clubRoute, submitLabel, busy, onSubmit }: {
  quotes: GiftPriceSegment[];
  indices: number[];
  clubRoute: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (segments: GiftSegmentDispatchInput[]) => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateError, setCandidateError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCandidateError("");
    employeeRequest<Candidate[]>(clubRoute + "/gift-candidates", "GET", undefined, controller.signal).then(items => {
      if (!controller.signal.aborted) setCandidates(items);
    }).catch(error => {
      if (!controller.signal.aborted) setCandidateError(getError(error));
    });
    return () => controller.abort();
  }, [clubRoute, attempt]);

  return <Form<InitialFields> layout="vertical" initialValues={{ segments: indices.map(index => defaults(quotes[index], index)) }}
    onFinish={({ segments }) => onSubmit(segments.map((part, position) => ({
      ...part, segmentIndex: indices[position], directed: (part.directed ?? []).map(item => ({
        userId: item.userId, dailyGiftTimes: item.dailyGiftTimes,
        startDate: item.startDate || part.startDate, endDate: item.endDate || part.endDate,
      })),
    })))}>
    {candidateError && <Alert type="error" showIcon title={candidateError}
      action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />}
    {indices.map((index, position) => <Card key={index} size="small" style={{ marginBlock: 8 }}
      title={`第 ${index + 1} 段 · ${quotes[index].paidGiftTimes} 次 · ${quotes[index].dailyGiftTimes} 次/日`}>
      <Flex wrap gap="small">
        <Form.Item name={["segments", position, "startDate"]} label="段起始日期" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name={["segments", position, "endDate"]} label="段截止日期" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
      </Flex>
      <Form.Item name={["segments", position, "openToClaim"]} valuePropName="checked">
        <Checkbox>开放剩余次数供团员抢单</Checkbox>
      </Form.Item>
      <Form.List name={["segments", position, "directed"]}>{(rows, { add, remove }) => <>
        {rows.map(row => <Card key={row.key} size="small" style={{ marginBottom: 8 }}>
          <Form.Item name={[row.name, "userId"]} label="指定接单团员" rules={[{ required: true }]}>
            <Select showSearch options={candidateOptions(candidates)} optionFilterProp="label" />
          </Form.Item>
          <Flex wrap gap="small">
            <Form.Item name={[row.name, "dailyGiftTimes"]} label="约定每日赠送次数" rules={integer}>
              <InputNumber min={1} precision={0} />
            </Form.Item>
            <Form.Item name={[row.name, "startDate"]} label="个人开始日期（可沿用本段）"><Input type="date" /></Form.Item>
            <Form.Item name={[row.name, "endDate"]} label="个人截止日期（可沿用本段）"><Input type="date" /></Form.Item>
          </Flex>
          <Button onClick={() => remove(row.name)}>移除此指定</Button>
        </Card>)}
        <Button disabled={!candidates.length} onClick={() => add()}>增加指定团员</Button>
      </>}</Form.List>
    </Card>)}
    <Button type="primary" htmlType="submit" loading={busy}>{submitLabel}</Button>
  </Form>;
}

export function PublishedGiftAllocation({ route }: { route: string }) {
  const path = route + "/gift-dispatch";
  const { id, token } = useAuthSession();
  const transferKey = `sky-heart.employee.pending-gift-transfer:${id}:${route}`;
  const [savedTransfer, setSavedTransfer] = useState(() => readTransfer(transferKey));
  const [data, setData] = useState<GiftDispatchPreparation>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [transfer, setTransfer] = useState<GiftShare>();
  const inFlight = useRef(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<GiftDispatchPreparation>(path, "GET", undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(error => {
      if (!controller.signal.aborted) setError(getError(error));
    });
    return () => controller.abort();
  }, [path, attempt]);

  async function save(suffix: string, fields: object) {
    if (inFlight.current || getAppToken("employee") !== token) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const key = JSON.stringify([suffix, fields]);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    try {
      await employeeRequest(path + suffix, "POST", { ...fields, requestId: pending.current.id });
      pending.current = null;
      setTransfer(undefined);
      setAttempt(value => value + 1);
    } catch (err) {
      setError(getError(err));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  async function sendTransfer(input: TransferInput) {
    if (inFlight.current || getAppToken("employee") !== token) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    persistTransfer(transferKey, input);
    setSavedTransfer(input);
    try {
      await employeeRequest(path + "/reassign", "POST", input);
      persistTransfer(transferKey);
      setSavedTransfer(undefined);
      setTransfer(undefined);
      setAttempt(value => value + 1);
    } catch (err) {
      if (err instanceof RequestError && [400, 403, 404, 409].includes(err.status)) {
        persistTransfer(transferKey);
        setSavedTransfer(undefined);
      }
      setError(getError(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const remaining = data?.quotes.map((_, index) => index).filter(index => !data.segments.some(segment => segment.segmentIndex === index));
  return <section aria-label="按次派发与分工">
    <Typography.Title level={5}>按次派发与分工</Typography.Title>
    {savedTransfer && !transfer && <Alert type="warning" showIcon title="上一次改派尚未收到确认"
      action={<Button loading={busy} onClick={() => void sendTransfer(savedTransfer)}>重试上次改派</Button>} />}
    {error && !transfer && <Alert type="error" showIcon title={error} action={<Button onClick={() => {
      setError("");
      setAttempt(value => value + 1);
    }}>刷新</Button>} />}
    {!data ? !error && <Spin aria-label="加载按次分工" /> : data.segments.map(segment =>
      <Card key={segment.segmentIndex} size="small" style={{ marginBlock: 8 }} title={`第 ${segment.segmentIndex + 1} 段`}>
        <p>{segment.startDate} 至 {segment.endDate} · {segment.openToClaim ? `公开待领 ${segment.publicRemainingGiftTimes} 次` : "仅定向承接"}</p>
        <GiftSchedule schedule={segment.publicSchedule} />
        {segment.offers.filter(offer => !offer.accepted).map(offer => <div key={offer.id}>
          <Typography.Text>{candidateOptions(data.candidates).find(item => item.value === offer.userId)?.label ?? offer.userId}
            {" · 待确认 "}{offer.giftTimes} 次</Typography.Text>
          <GiftSchedule schedule={offer.schedule} />
        </div>)}
        {segment.shares.map(share => {
          const outstanding = share.giftTimes - (share.transferredGiftTimes ?? 0) - (share.deliveredGiftTimes ?? 0);
          return <Card key={share.id} size="small" style={{ marginBlock: 8 }}>
            <p>{candidateOptions(data.candidates).find(item => item.value === share.userId)?.label ?? share.userId} · 领取 {share.giftTimes} 次
              {" · 已送 "}{share.deliveredGiftTimes ?? 0} 次 · 可改派 {Math.max(0, outstanding)} 次
              {share.transferredGiftTimes ? ` · 已改派 ${share.transferredGiftTimes} 次` : ""}</p>
            <p>接单实收爱心 {share.actualReceivedHearts === undefined ? "未记录" : `${share.actualReceivedHearts} 颗`}</p>
            <GiftSchedule schedule={share.schedule} />
            {outstanding > 0 && <Button disabled={!!savedTransfer} onClick={() => { setError(""); setTransfer(share); }}>改派未送次数</Button>}
          </Card>;
        })}
      </Card>,
    )}
    {!!remaining?.length && data && <GiftDispatchForm key={remaining.join(",")} quotes={data.quotes} indices={remaining}
      clubRoute={route.split("/orders/")[0]} busy={busy} submitLabel="派发以上计价段"
      onSubmit={segments => void save("", { segments })} />}
    <Modal open={!!transfer} destroyOnHidden title="改派未送次数" footer={null} onCancel={() => !busy && setTransfer(undefined)}>
      {transfer && data && <Form layout="vertical" onFinish={({ userId, giftTimes }: { userId: string; giftTimes?: number }) =>
        void sendTransfer(savedTransfer ?? { requestId: crypto.randomUUID(), shareId: transfer.id, userId, giftTimes: giftTimes ?? undefined })}>
        <p>接手团员确认后开始承接。已送次数及原承接人的记录保留。</p>
        <Form.Item name="userId" label="接手团员" rules={[{ required: true }]}>
          <Select showSearch optionFilterProp="label" options={candidateOptions(data.candidates, transfer.userId)} />
        </Form.Item>
        <Form.Item name="giftTimes" label="改派次数（留空改派全部未送次数）">
          <InputNumber min={1} max={transfer.giftTimes - (transfer.transferredGiftTimes ?? 0) - (transfer.deliveredGiftTimes ?? 0)} precision={0} />
        </Form.Item>
        {error && <Alert type="error" showIcon title={error} />}
        {savedTransfer ? <Button type="primary" loading={busy} onClick={() => void sendTransfer(savedTransfer)}>重试上次改派</Button>
          : <Button type="primary" htmlType="submit" loading={busy}>确认改派</Button>}
      </Form>}
    </Modal>
  </section>;
}
