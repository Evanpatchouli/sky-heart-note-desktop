import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Form, InputNumber, Modal, Spin, Tag, Typography } from "antd";
import { Link, useSearchParams } from "react-router";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import type { GiftClaimOrder, GiftClaimResult, GiftOffer } from "@webapp-template/common";
import Header from "#/components/Header";
import { employeeRequest } from "#/service/request";
import GiftDeliveryDiary from "./gift-delivery-diary";
import { GiftSchedule } from "./club-dispatch/gift-allocation";
import { GiftExecutionAccounts } from "./club-dispatch/gift-execution-accounts";

type Club = { name: string };
type Page = { items: GiftClaimOrder[]; nextCursor: string | null };
type Target = { orderId: string; segmentIndex: number; offer?: GiftOffer; previousDaily?: number; myGiftTimes?: number };
type ClaimFields = { dailyGiftTimes?: number; actualReceivedHearts?: number };
type ClaimInput = ClaimFields & { segmentIndex: number; kind: "public" | "directed"; offerId?: string; requestId: string };
type PendingClaim = { orderId: string; input: ClaimInput };
type ClaimReceipt = PendingClaim & { result: GiftClaimResult };

const sources = { direct_dispatch: "直接派单", client_order: "客户端下单" };
const orderIdPattern = /^[a-f0-9]{24}$/i;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pendingKey(prefix: string, { orderId, input }: PendingClaim) {
  return `${prefix}${orderId}:${input.segmentIndex}:${input.kind}:${input.offerId ?? ""}:${input.requestId}`;
}

function readPending(prefix: string, orderId?: string): PendingClaim[] {
  const entries: PendingClaim[] = [];
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (!key.startsWith(prefix)) continue;
      let entry: PendingClaim | null;
      try { entry = JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { continue; }
      if (!entry || typeof entry.orderId !== "string" || !orderIdPattern.test(entry.orderId) || (orderId && orderId !== entry.orderId)) continue;
      const input = entry.input;
      if (!input || typeof input.requestId !== "string" || !requestIdPattern.test(input.requestId) ||
        !Number.isSafeInteger(input.segmentIndex) || input.segmentIndex < 0) continue;
      if (input.kind === "public") {
        if (!Number.isSafeInteger(input.dailyGiftTimes) || input.dailyGiftTimes! < 1 || input.offerId !== undefined) continue;
      } else if (input.kind !== "directed" || typeof input.offerId !== "string" ||
        !orderIdPattern.test(input.offerId) || input.dailyGiftTimes !== undefined) continue;
      if (input.actualReceivedHearts !== undefined &&
        (!Number.isSafeInteger(input.actualReceivedHearts) || input.actualReceivedHearts < 0)) continue;
      if (pendingKey(prefix, entry) === key) entries.push(entry);
    }
  } catch { /* The current page retains pending submissions when storage is unavailable. */ }
  return entries;
}

function matchingAction({ input, orderId }: PendingClaim, target: Target) {
  return orderId === target.orderId && input.segmentIndex === target.segmentIndex && input.offerId === target.offer?.id;
}

function failure(error: unknown) {
  return error instanceof RequestError ? error.message : "请求失败，请检查网络连接后重试";
}

export default function GiftClaims() {
  const { id, token } = useAuthSession();
  const [params, setParams] = useSearchParams();
  const [club, setClub] = useState<Club | null>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<Club | null>("club", "GET", undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setClub(data);
    }).catch(err => {
      if (!controller.signal.aborted) setError(failure(err));
    });
    return () => controller.abort();
  }, [attempt, token]);

  return <>
    <Header />
    <main style={{ flex: 1, overflow: "auto", width: "100%", padding: 16, boxSizing: "border-box" }}>
      <Flex vertical gap="middle" style={{ maxWidth: 820, marginInline: "auto" }}>
        <Link to="/club/dispatch">派单准备</Link>
        <Typography.Title level={3} style={{ margin: 0 }}>按次接单</Typography.Title>
        {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => {
          setError("");
          setAttempt(value => value + 1);
        }}>重试</Button>} /> : club === undefined ? <Spin aria-label="加载俱乐部" /> : club ? <>
          <Typography.Text strong>{club.name}</Typography.Text>
          <Orders key={id + ":" + (params.get("orderId") ?? "")}
            orderId={params.get("orderId") ?? undefined} onClearOrder={() => setParams({})} />
        </> : <Empty description="当前账号尚无有效团员身份" />}
      </Flex>
    </main>
  </>;
}

function Orders({ orderId, onClearOrder }: { orderId?: string; onClearOrder: () => void }) {
  const { id, token } = useAuthSession();
  const root = "club/gift-claims";
  const prefix = `sky-heart.employee.gift-claim.v1:${id}:`;
  const [page, setPage] = useState<Page>();
  const [after, setAfter] = useState<string>();
  const [error, setError] = useState("");
  const [claimError, setClaimError] = useState("");
  const [target, setTarget] = useState<Target>();
  const [diaryOrder, setDiaryOrder] = useState<GiftClaimOrder>();
  const [restored] = useState(() => readPending(prefix, orderId));
  const [pending, setPending] = useState(restored);
  const [receipts, setReceipts] = useState<ClaimReceipt[]>([]);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const path = orderId ? `${root}/${orderId}` : after ? `${root}?after=${after}` : root;
    async function load() {
      return orderId ? { items: [await employeeRequest<GiftClaimOrder>(path, "GET", undefined, controller.signal)], nextCursor: null }
        : employeeRequest<Page>(path, "GET", undefined, controller.signal);
    }
    load().then(data => {
      if (!controller.signal.aborted) setPage(data);
    }).catch(err => {
      if (!controller.signal.aborted) setError(failure(err));
    });
    return () => controller.abort();
  }, [root, orderId, after, attempt, token]);

  const forget = useCallback((entry: PendingClaim) => {
    try { sessionStorage.removeItem(pendingKey(prefix, entry)); } catch { /* Keep the current page usable. */ }
    setPending(current => current.filter(item => item.input.requestId !== entry.input.requestId));
  }, [prefix]);

  const receive = useCallback((entry: PendingClaim, result: GiftClaimResult) => {
    forget(entry);
    setReceipts(current => [...current.filter(item => item.input.requestId !== entry.input.requestId), { ...entry, result }]);
    setError("");
    setAttempt(value => value + 1);
  }, [forget]);

  useEffect(() => {
    const controller = new AbortController();
    for (const entry of restored) {
      const path = `${root}/${entry.orderId}/receipts/${entry.input.requestId}`;
      employeeRequest<GiftClaimResult>(path, "GET", undefined, controller.signal).then(result => {
        if (!controller.signal.aborted && getAppToken("employee") === token) receive(entry, result);
      }).catch(() => { /* The original submission remains available for explicit retry. */ });
    }
    return () => controller.abort();
  }, [root, restored, token, receive]);

  async function send(entry: PendingClaim) {
    if (lock.current || getAppToken("employee") !== token) return;
    lock.current = true;
    setBusy(true);
    setClaimError("");
    try { sessionStorage.setItem(pendingKey(prefix, entry), JSON.stringify(entry)); } catch { /* Retain in page state. */ }
    setPending(current => current.some(item => item.input.requestId === entry.input.requestId) ? current : [...current, entry]);
    try {
      const result = await employeeRequest<GiftClaimResult>(
        `${root}/${entry.orderId}`, "POST", entry.input, AbortSignal.timeout(20_000),
      );
      if (getAppToken("employee") === token) receive(entry, result);
    } catch (err) {
      if (getAppToken("employee") !== token) return;
      if (err instanceof RequestError && [400, 403, 404, 409].includes(err.status)) forget(entry);
      setClaimError(failure(err));
      refresh();
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  function submit({ dailyGiftTimes, actualReceivedHearts }: ClaimFields) {
    if (!target || lock.current || pending.some(entry => matchingAction(entry, target))) return;
    const input: ClaimInput = {
      requestId: crypto.randomUUID(),
      segmentIndex: target.segmentIndex,
      ...(target.offer ? { kind: "directed", offerId: target.offer.id } : { kind: "public", dailyGiftTimes }),
      ...(actualReceivedHearts == null ? {} : { actualReceivedHearts }),
    };
    setTarget(undefined);
    void send({ orderId: target.orderId, input });
  }

  function refresh() {
    setError("");
    setAttempt(value => value + 1);
  }

  function select(next: Target) {
    setClaimError("");
    setReceipts([]);
    setTarget(next);
  }

  return <>
    <Flex gap="small" wrap>
      {orderId && <Button onClick={onClearOrder}>返回接单列表</Button>}
      <Button onClick={refresh}>刷新接单列表</Button>
    </Flex>
    {pending.length > 0 && <Card size="small" title="待确认的领取">
      <Flex vertical gap="small">{pending.map(entry => <Flex key={entry.input.requestId} justify="space-between" gap="small" wrap>
        <Typography.Text>订单 {entry.orderId} · 第 {entry.input.segmentIndex + 1} 段 · {
          entry.input.kind === "public" ? `申报 ${entry.input.dailyGiftTimes} 次/日` : "定向承接"
        }</Typography.Text>
        <Button disabled={busy} onClick={() => void send(entry)}>重试本次领取</Button>
      </Flex>)}</Flex>
    </Card>}
    {receipts.map(({ orderId: receiptOrder, input, result }) => <Alert key={input.requestId} showIcon
      type={result.giftTimes > 0 ? "success" : "info"}
      title={result.giftTimes > 0 ? `本次分得 ${result.giftTimes} 次，最高 ${result.dailyGiftTimes} 次/日` : "本段已无可领余量，本次分得 0 次"}
      description={<>
        <div>订单 {receiptOrder} · 第 {input.segmentIndex + 1} 段 · 申报 {result.requestedDailyGiftTimes} 次/日
          {result.additionalRequestedDailyGiftTimes !== undefined ? ` · 本次新增申报 ${result.additionalRequestedDailyGiftTimes} 次/日` : ""}</div>
        <GiftSchedule schedule={result.schedule} />
      </>} />)}
    {claimError && <Alert type="error" showIcon title={claimError} />}
    {error ? <Alert type="error" showIcon title={error} action={<Button onClick={refresh}>重试</Button>} />
      : !page ? <Spin aria-label="加载接单列表" />
      : !page.items.length ? <Empty description="暂无已派发的按次订单可接" />
      : page.items.map(order => <Card key={order.id} title={`${sources[order.source]} · ${order.requestedGiftTimes} 次${order.promotionalGiftTimes ? ` + 赠 ${order.promotionalGiftTimes} 次` : ""}`} size="small">
        <p>订单 <code>{order.id}</code> · 派单人 {order.dispatcherUserId}</p>
        <p>建单预计实收爱心 {order.estimatedReceivedHearts === undefined ? "未记录" : `${order.estimatedReceivedHearts} 颗`}
          {order.recipientGameAccount ? ` · 接收游戏号 ${order.recipientGameAccount}` : ""}</p>
        {order.segments.some(segment => segment.shares.length > 0) &&
          <Button onClick={() => setDiaryOrder(order)}>我的日报</Button>}
        {order.segments.map(segment => {
          const previousDaily = segment.myPublicRequestedDailyGiftTimes ?? 0;
          const myGiftTimes = segment.shares.reduce((sum, share) => sum + share.netGiftTimes, 0);
          const publicTarget = { orderId: order.id, segmentIndex: segment.segmentIndex, previousDaily, myGiftTimes };
          return <section key={segment.segmentIndex} style={{ borderTop: "1px solid #DBE2EB", paddingBlock: 10 }}>
            <Typography.Title level={5}>第 {segment.segmentIndex + 1} 段{segment.promotionalGiftTimes ? " · 促销赠送" : ""}</Typography.Title>
            {segment.promotionalGiftTimes ? <p>整单付费次数完成后执行。</p> : null}
            <p>{segment.startDate} 至 {segment.endDate}</p>
            {previousDaily > 0 && <p>我已申报 {previousDaily} 次/日 · 当前承接 {myGiftTimes} 次</p>}
            {segment.openToClaim && <p>公开待领 {segment.publicRemainingGiftTimes} 次
              {segment.publicRemainingGiftTimes > 0 ? ` · 最高 ${segment.publicDailyGiftTimes} 次/日` : ""}</p>}
            {segment.publicRemainingGiftTimes > 0 && <>
              <GiftSchedule schedule={segment.publicSchedule} />
              <Button disabled={busy || pending.some(entry => matchingAction(entry, publicTarget)) || previousDaily >= Number.MAX_SAFE_INTEGER}
                onClick={() => select(publicTarget)}>{previousDaily ? "提高申报日量" : "抢单"}</Button>
            </>}
            {order.acceptingClaims !== false && segment.offers.filter(offer => !offer.accepted).map(offer => {
              const directedTarget = { orderId: order.id, segmentIndex: segment.segmentIndex, offer };
              return <div key={offer.id} style={{ marginBlock: 8 }}>
                <Tag color="gold">{offer.transferredFromShareId ? "改派待确认" : "指定待确认"}</Tag>{offer.giftTimes} 次
                <GiftSchedule schedule={offer.schedule} />
                <Button disabled={busy || pending.some(entry => matchingAction(entry, directedTarget))}
                  onClick={() => select(directedTarget)}>确认承接指定份额</Button>
              </div>;
            })}
            {segment.shares.map(share => <div key={share.id} style={{ marginBlock: 8 }}>
              <Tag color="green">我的承接</Tag>{share.netGiftTimes} 次
              {share.transferredGiftTimes ? ` · 原领 ${share.giftTimes} 次 · 已转出 ${share.transferredGiftTimes} 次` : ""}
              <div>接单实收爱心 {share.actualReceivedHearts === undefined ? "未记录" : `${share.actualReceivedHearts} 颗`}</div>
              <GiftSchedule schedule={share.schedule} />
              {share.originalSchedule && <details><summary>原领取日程</summary><GiftSchedule schedule={share.originalSchedule} /></details>}
              {order.recipientGameAccount && <GiftExecutionAccounts
                orderRoute={`club/orders/${order.id}`} share={share}
                readOnly={order.acceptingClaims === false || !share.netGiftTimes}
                onSaved={refresh} />}
            </div>)}
          </section>;
        })}
      </Card>)}
    {(after || page?.nextCursor) && <Flex gap="small">
      <Button disabled={!after} onClick={() => { setPage(undefined); setAfter(undefined); }}>返回首页</Button>
      <Button disabled={!page?.nextCursor} onClick={() => { setAfter(page?.nextCursor ?? undefined); setPage(undefined); }}>下一页</Button>
    </Flex>}
    <Modal open={!!target} destroyOnHidden title={target?.offer ? "确认承接指定份额" : target?.previousDaily ? "提高申报日量" : "申报每日赠送次数"} footer={null}
      onCancel={() => !busy && setTarget(undefined)}>
      {target && <Form layout="vertical" onFinish={submit} key={target.offer?.id ?? target.segmentIndex}>
        {target.offer ? <>
          <p>指定承接 {target.offer.giftTimes} 次</p>
          <GiftSchedule schedule={target.offer.schedule} />
        </> : <>
          {target.previousDaily ? <p>此前申报 {target.previousDaily} 次/日，当前承接 {target.myGiftTimes} 次。提高后只按新增的日量分配。</p> : null}
          <Form.Item name="dailyGiftTimes" label={target.previousDaily ? "提高后的每日总量（次/日）" : "每日可赠送（次/日）"}
            rules={[{ required: true, type: "integer", min: (target.previousDaily ?? 0) + 1, max: Number.MAX_SAFE_INTEGER }]}>
            <InputNumber min={(target.previousDaily ?? 0) + 1} precision={0} />
          </Form.Item>
        </>}
        <Form.Item name="actualReceivedHearts" label="接单实际实收爱心（颗，可留空）"
          rules={[{ type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER }]}>
          <InputNumber min={0} precision={0} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          {target.offer ? "确认承接" : target.previousDaily ? "确认提高日量" : "提交抢单"}
        </Button>
      </Form>}
    </Modal>
    {diaryOrder && <GiftDeliveryDiary key={diaryOrder.id} order={diaryOrder}
      orderRoute={`club/orders/${diaryOrder.id}`} onClose={() => setDiaryOrder(undefined)} />}
  </>;
}
