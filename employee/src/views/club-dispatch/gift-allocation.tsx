import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Checkbox, Flex, Form, Input, InputNumber, Modal, Select, Spin, Typography } from "antd";
import { getAppToken, RequestError, useAuthSession } from "@sky-club/common/web-auth";
import { giftSegmentTimes } from "@sky-club/common";
import type { GiftAllocationTotals, GiftDayAllocation, GiftDispatchPreparation, GiftPriceSegment, GiftSegmentDispatchInput, GiftShare, GiftWindow } from "@sky-club/common";
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

function addDays(value: string, days: number) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function requiredDays(quote: GiftPriceSegment) {
  return Math.ceil(giftSegmentTimes(quote) / quote.dailyGiftTimes);
}

function initialWindows(quotes: GiftPriceSegment[], indices: number[], windows?: ReadonlyMap<number, GiftWindow>): InitialFields {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
  const latestPaidEnd = quotes.reduce((latest, quote, index) => {
    if (quote.promotionalGiftTimes) return latest;
    const end = windows?.get(index)?.endDate
      ?? (indices.includes(index) ? addDays(today, Math.min(3659, requiredDays(quote) - 1)) : "");
    return end > latest ? end : latest;
  }, "");
  return { segments: indices.map(segmentIndex => {
    const quote = quotes[segmentIndex];
    const startDate = quote.promotionalGiftTimes && latestPaidEnd ? addDays(latestPaidEnd, 1) : today;
    const endDate = addDays(startDate, Math.min(3659, requiredDays(quote) - 1));
    return { segmentIndex, startDate, endDate, openToClaim: true, directed: [], ...windows?.get(segmentIndex) };
  }) };
}

function earliestPaidCompletion(quotes: GiftPriceSegment[], indices: number[], segments: GiftSegmentDispatchInput[]) {
  let latest = "";
  for (const [position, index] of indices.entries()) {
    const quote = quotes[index];
    if (quote.promotionalGiftTimes) continue;
    const { startDate, endDate, directed } = segments[position] ?? {};
    const days = requiredDays(quote);
    if (!startDate || days > 3660) return "";
    const finish = addDays(startDate, days - 1);
    if (!endDate || endDate < finish) return "";
    if (finish > latest) latest = finish;
    for (const offer of directed ?? []) {
      const reservedEnd = offer.endDate || endDate;
      if (reservedEnd <= endDate && reservedEnd > latest) latest = reservedEnd;
    }
  }
  return latest;
}

function giftWindowTooEarly(quote: GiftPriceSegment, window: GiftWindow | undefined, paidFinish: string) {
  if (!quote.promotionalGiftTimes || !window?.startDate || !window.endDate || !paidFinish || requiredDays(quote) > 3660) return false;
  const startDate = window.startDate > paidFinish ? window.startDate : paidFinish;
  return addDays(startDate, requiredDays(quote) - 1) > window.endDate;
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

function AllocationTotals({ totals }: { totals: GiftAllocationTotals }) {
  return <p>已领 {totals.claimedGiftTimes} / {totals.paidGiftTimes + (totals.promotionalGiftTimes ?? 0)} 次
    {totals.promotionalGiftTimes ? ` · 促销赠送 ${totals.promotionalGiftTimes} 次` : ""} · 公开待领 {totals.publicRemainingGiftTimes} 次
    {" · 定向待确认 "}{totals.directedPendingGiftTimes} 次
    {totals.unconfiguredGiftTimes > 0 ? ` · 未配置 ${totals.unconfiguredGiftTimes} 次` : ""}
    {totals.unallocatedGiftTimes > 0 ? ` · 当前不可领 ${totals.unallocatedGiftTimes} 次` : ""}</p>;
}

export function GiftDispatchForm({ quotes, indices, clubRoute, submitLabel, busy, onSubmit, windows }: {
  quotes: GiftPriceSegment[];
  indices: number[];
  clubRoute: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (segments: GiftSegmentDispatchInput[]) => void;
  windows?: ReadonlyMap<number, GiftWindow>;
}) {
  const [form] = Form.useForm<InitialFields>();
  const [initial] = useState(() => initialWindows(quotes, indices, windows));
  const segments = Form.useWatch("segments", form) ?? initial.segments;
  const checkGiftOrder = windows === undefined && indices.some(index => quotes[index].promotionalGiftTimes);
  const paidFinish = checkGiftOrder ? earliestPaidCompletion(quotes, indices, segments) : "";
  const earlyGiftWindows = indices.map((index, position) => giftWindowTooEarly(quotes[index], segments[position], paidFinish));
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

  return <Form<InitialFields> form={form} layout="vertical" initialValues={initial}
    onFinish={({ segments }) => {
      const finish = checkGiftOrder ? earliestPaidCompletion(quotes, indices, segments) : "";
      if (indices.some((index, position) => giftWindowTooEarly(quotes[index], segments[position], finish))) return;
      onSubmit(segments.map((part, position) => ({
        ...part, segmentIndex: indices[position], directed: (part.directed ?? []).map(item => ({
          userId: item.userId, dailyGiftTimes: item.dailyGiftTimes,
          startDate: item.startDate || part.startDate, endDate: item.endDate || part.endDate,
        })),
      })));
    }}>
    {candidateError && <Alert type="error" showIcon title={candidateError}
      action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />}
    {indices.map((index, position) => <Card key={index} size="small" style={{ marginBlock: 8 }}
      title={`第 ${index + 1} 段 · ${quotes[index].promotionalGiftTimes
        ? `促销赠送 ${quotes[index].promotionalGiftTimes}` : `付费 ${quotes[index].paidGiftTimes}`} 次 · ${quotes[index].dailyGiftTimes} 次/日`}>
      {quotes[index].promotionalGiftTimes ? <p>全单付费次数完成后执行此段。当天先送完付费次数时，可以当天执行赠送。</p> : null}
      {earlyGiftWindows[position] && <Alert type="error" showIcon
        title={`全单付费最早于 ${paidFinish} 完成，赠送窗口余量不足。请延后截止日期，或重新安排付费与赠送窗口。`} />}
      <Flex wrap gap="small">
        <Form.Item name={["segments", position, "startDate"]} label="段起始日期" rules={[{ required: true }]}>
          <Input type="date" readOnly={windows?.has(index)} />
        </Form.Item>
        <Form.Item name={["segments", position, "endDate"]} label="段截止日期" rules={[{ required: true }]}>
          <Input type="date" readOnly={windows?.has(index)} />
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
    <Button type="primary" htmlType="submit" loading={busy} disabled={earlyGiftWindows.some(Boolean)}>{submitLabel}</Button>
  </Form>;
}

export function PublishedGiftAllocation({ route, revision, onChanged }: { route: string; revision: number; onChanged?: () => void }) {
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
  }, [path, attempt, revision]);

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
      onChanged?.();
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
      onChanged?.();
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

  const remaining = data?.segmentTotals.filter(segment => !segment.configured).map(segment => segment.segmentIndex);
  const labels = new Map(candidateOptions(data?.candidates ?? []).map(item => [item.value, item.label]));
  return <section aria-label="按次派发与分工">
    <Typography.Title level={5}>按次派发与分工</Typography.Title>
    {savedTransfer && !transfer && <Alert type="warning" showIcon title="上一次改派尚未收到确认"
      action={<Button loading={busy} onClick={() => void sendTransfer(savedTransfer)}>重试上次改派</Button>} />}
    {error && !transfer && <Alert type="error" showIcon title={error} action={<Button onClick={() => {
      setError("");
      setAttempt(value => value + 1);
    }}>刷新</Button>} />}
    {!data ? !error && <Spin aria-label="加载按次分工" /> : <>
      <Card size="small" title="整单领取汇总"><AllocationTotals totals={data.totals} />
      </Card>
      {!data.acceptingClaims && <p>本单已停止新领取。</p>}
      {data.segmentTotals.map(totals => {
        const segment = data.segments.find(item => item.segmentIndex === totals.segmentIndex);
        const shareCount = new Map<string, number>();
        for (const share of segment?.shares ?? []) shareCount.set(share.userId, (shareCount.get(share.userId) ?? 0) + 1);
        return <Card key={totals.segmentIndex} size="small" style={{ marginBlock: 8 }} title={`第 ${totals.segmentIndex + 1} 段`}>
          <AllocationTotals totals={totals} />
          {segment ? <>
            <p>{segment.startDate} 至 {segment.endDate} · {segment.openToClaim ? "公开抢单" : "仅定向承接"}</p>
            <GiftSchedule schedule={segment.publicSchedule} />
            {segment.offers.filter(offer => !offer.accepted).map(offer => <div key={offer.id}>
              <Typography.Text>{labels.get(offer.userId) ?? offer.userId}
                {" · 待确认 "}{offer.giftTimes} 次</Typography.Text>
              <GiftSchedule schedule={offer.schedule} />
            </div>)}
            {segment.memberAllocations.filter(member => (shareCount.get(member.userId) ?? 0) > 1).map(member => <div key={member.userId}>
              <Typography.Text strong>{labels.get(member.userId) ?? member.userId}{" · 日量合计 · 共 "}{member.giftTimes} 次</Typography.Text>
              <GiftSchedule schedule={member.schedule} />
            </div>)}
            {segment.shares.map(share => {
              const outstanding = share.netGiftTimes - (share.deliveredGiftTimes ?? 0);
              return <Card key={share.id} size="small" style={{ marginBlock: 8 }}>
                <p>{labels.get(share.userId) ?? share.userId} · 当前承接 {share.netGiftTimes} 次
                  {" · 已送 "}{share.deliveredGiftTimes ?? 0} 次 · 未送 {Math.max(0, outstanding)} 次
                  {share.transferredGiftTimes ? ` · 原领 ${share.giftTimes} 次 · 已转出 ${share.transferredGiftTimes} 次` : ""}</p>
                <p>接单实收爱心 {share.actualReceivedHearts === undefined ? "未记录" : `${share.actualReceivedHearts} 颗`}</p>
                <GiftSchedule schedule={share.schedule} />
                {share.originalSchedule && <details><summary>原领取日程</summary><GiftSchedule schedule={share.originalSchedule} /></details>}
                {data.acceptingClaims && outstanding > 0 &&
                  <Button disabled={!!savedTransfer} onClick={() => { setError(""); setTransfer(share); }}>改派未送次数</Button>}
              </Card>;
            })}
          </> : <p>本段尚未配置派发。</p>}
        </Card>;
      })}
    </>}
    {!!remaining?.length && data?.acceptingClaims && <GiftDispatchForm key={remaining.join(",")} quotes={data.quotes} indices={remaining}
      windows={new Map([
        ...data.segments.map(segment => [segment.segmentIndex, segment] as const),
        ...data.segmentTotals.flatMap(segment => segment.window ? [[segment.segmentIndex, segment.window] as const] : []),
      ])}
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
          <InputNumber min={1} max={transfer.netGiftTimes - (transfer.deliveredGiftTimes ?? 0)} precision={0} />
        </Form.Item>
        {error && <Alert type="error" showIcon title={error} />}
        {savedTransfer ? <Button type="primary" loading={busy} onClick={() => void sendTransfer(savedTransfer)}>重试上次改派</Button>
          : <Button type="primary" htmlType="submit" loading={busy}>确认改派</Button>}
      </Form>}
    </Modal>
  </section>;
}
