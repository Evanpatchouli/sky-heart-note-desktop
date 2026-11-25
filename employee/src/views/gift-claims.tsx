import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Form, InputNumber, Modal, Select, Spin, Tag, Typography } from "antd";
import { Link, useSearchParams } from "react-router";
import { RequestError } from "@webapp-template/common/web-auth";
import type { GiftClaimOrder, GiftClaimResult, GiftOffer } from "@webapp-template/common";
import Header from "#/components/Header";
import { employeeRequest } from "#/service/request";
import { GiftSchedule } from "./club-dispatch/gift-allocation";

type Club = { id: string; name: string };
type Page = { items: GiftClaimOrder[]; nextCursor: string | null };
type Target = { orderId: string; segmentIndex: number; offer?: GiftOffer };
type ClaimFields = { dailyGiftTimes?: number; actualReceivedHearts?: number };

const sources = { direct_dispatch: "直接派单", client_order: "客户端下单" };

function failure(error: unknown) {
  return error instanceof RequestError ? error.message : "请求失败，请检查网络连接后重试";
}

export default function GiftClaims() {
  const [params, setParams] = useSearchParams();
  const [clubs, setClubs] = useState<Club[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const selected = clubs?.find(club => club.id === params.get("clubId")) ?? clubs?.[0];

  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<Club[]>("clubs", "GET", undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setClubs(data);
    }).catch(err => {
      if (!controller.signal.aborted) setError(failure(err));
    });
    return () => controller.abort();
  }, [attempt]);

  return <>
    <Header />
    <main style={{ flex: 1, overflow: "auto", width: "100%", padding: 16, boxSizing: "border-box" }}>
      <Flex vertical gap="middle" style={{ maxWidth: 820, marginInline: "auto" }}>
        <Link to={selected ? `/club/dispatch?clubId=${selected.id}` : "/club/dispatch"}>派单准备</Link>
        <Typography.Title level={3} style={{ margin: 0 }}>按次接单</Typography.Title>
        {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => {
          setError("");
          setAttempt(value => value + 1);
        }}>重试</Button>} /> : !clubs ? <Spin aria-label="加载俱乐部" /> : selected ? <>
          <Flex gap="small" align="center">
            <Typography.Text>俱乐部</Typography.Text>
            <Select aria-label="俱乐部" value={selected.id} onChange={clubId => setParams({ clubId })}
              options={clubs.map(club => ({ value: club.id, label: club.name }))} style={{ minWidth: 150 }} />
          </Flex>
          <Orders key={selected.id + ":" + (params.get("orderId") ?? "")} clubId={selected.id}
            orderId={params.get("orderId") ?? undefined} onClearOrder={() => setParams({ clubId: selected.id })} />
        </> : <Empty description="暂无可访问的俱乐部" />}
      </Flex>
    </main>
  </>;
}

function Orders({ clubId, orderId, onClearOrder }: { clubId: string; orderId?: string; onClearOrder: () => void }) {
  const root = `clubs/${clubId}/gift-claims`;
  const [page, setPage] = useState<Page>();
  const [after, setAfter] = useState<string>();
  const [error, setError] = useState("");
  const [claimError, setClaimError] = useState("");
  const [target, setTarget] = useState<Target>();
  const [result, setResult] = useState<GiftClaimResult>();
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lock = useRef(false);
  const pending = useRef<{ key: string; requestId: string } | null>(null);

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
  }, [root, orderId, after, attempt]);

  async function submit({ dailyGiftTimes, actualReceivedHearts }: ClaimFields) {
    if (!target || lock.current) return;
    lock.current = true;
    setBusy(true);
    setClaimError("");
    const payload = {
      segmentIndex: target.segmentIndex,
      ...(target.offer ? { kind: "directed", offerId: target.offer.id } : { kind: "public", dailyGiftTimes }),
      ...(actualReceivedHearts == null ? {} : { actualReceivedHearts }),
    };
    const key = JSON.stringify([target.orderId, payload]);
    if (pending.current?.key !== key) pending.current = { key, requestId: crypto.randomUUID() };
    try {
      setResult(await employeeRequest<GiftClaimResult>(`${root}/${target.orderId}`, "POST", {
        ...payload, requestId: pending.current.requestId,
      }));
      pending.current = null;
      setTarget(undefined);
      setAttempt(value => value + 1);
    } catch (err) {
      setClaimError(failure(err));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  function refresh() {
    setError("");
    setAttempt(value => value + 1);
  }

  function select(next: Target) {
    setClaimError("");
    setResult(undefined);
    setTarget(next);
  }

  return <>
    <Flex gap="small" wrap>
      {orderId && <Button onClick={onClearOrder}>返回接单列表</Button>}
      <Button onClick={refresh}>刷新接单列表</Button>
    </Flex>
    {result && <Alert showIcon type={result.giftTimes > 0 ? "success" : "info"}
      title={result.giftTimes > 0 ? `成功承接 ${result.giftTimes} 次，最高 ${result.dailyGiftTimes} 次/日` : "本段余量已领完，本次分得 0 次"} />}
    {error ? <Alert type="error" showIcon title={error} action={<Button onClick={refresh}>重试</Button>} />
      : !page ? <Spin aria-label="加载接单列表" />
      : !page.items.length ? <Empty description="暂无已派发的按次订单可接" />
      : page.items.map(order => <Card key={order.id} title={`${sources[order.source]} · ${order.requestedGiftTimes} 次`} size="small">
        <p>订单 <code>{order.id}</code> · 派单人 {order.dispatcherUserId}</p>
        <p>建单预计实收爱心 {order.estimatedReceivedHearts === undefined ? "未记录" : `${order.estimatedReceivedHearts} 颗`}
          {order.recipientGameAccount ? ` · 接收游戏号 ${order.recipientGameAccount}` : ""}</p>
        {order.segments.map(segment => <section key={segment.segmentIndex} style={{ borderTop: "1px solid #DBE2EB", paddingBlock: 10 }}>
          <Typography.Title level={5}>第 {segment.segmentIndex + 1} 段</Typography.Title>
          <p>{segment.startDate} 至 {segment.endDate}</p>
          {segment.publicRemainingGiftTimes > 0 && <>
            <p>公开待领 {segment.publicRemainingGiftTimes} 次 · 最高 {segment.publicDailyGiftTimes} 次/日</p>
            <GiftSchedule schedule={segment.publicSchedule} />
            <Button onClick={() => select({ orderId: order.id, segmentIndex: segment.segmentIndex })}>抢单</Button>
          </>}
          {segment.offers.filter(offer => !offer.accepted).map(offer => <div key={offer.id} style={{ marginBlock: 8 }}>
            <Tag color="gold">{offer.transferredFromShareId ? "改派待确认" : "指定待确认"}</Tag>{offer.giftTimes} 次
            <GiftSchedule schedule={offer.schedule} />
            <Button onClick={() => select({ orderId: order.id, segmentIndex: segment.segmentIndex, offer })}>确认承接指定份额</Button>
          </div>)}
          {segment.shares.map(share => <div key={share.id} style={{ marginBlock: 8 }}>
            <Tag color="green">我的承接</Tag>{share.giftTimes} 次
            {share.transferredGiftTimes ? ` · 已改派 ${share.transferredGiftTimes} 次` : ""}
            <div>接单实收爱心 {share.actualReceivedHearts === undefined ? "未记录" : `${share.actualReceivedHearts} 颗`}</div>
            <GiftSchedule schedule={share.schedule} />
          </div>)}
          {!segment.publicRemainingGiftTimes && !segment.offers.length && !segment.shares.length && <p>本段公开份额已领完</p>}
        </section>)}
      </Card>)}
    {(after || page?.nextCursor) && <Flex gap="small">
      <Button disabled={!after} onClick={() => { setPage(undefined); setAfter(undefined); }}>返回首页</Button>
      <Button disabled={!page?.nextCursor} onClick={() => { setAfter(page?.nextCursor ?? undefined); setPage(undefined); }}>下一页</Button>
    </Flex>}
    <Modal open={!!target} destroyOnHidden title={target?.offer ? "确认承接指定份额" : "申报每日赠送次数"} footer={null}
      onCancel={() => !busy && setTarget(undefined)}>
      {target && <Form layout="vertical" onFinish={submit} key={target.offer?.id ?? target.segmentIndex}>
        {target.offer ? <>
          <p>指定承接 {target.offer.giftTimes} 次</p>
          <GiftSchedule schedule={target.offer.schedule} />
        </> : <Form.Item name="dailyGiftTimes" label="每日可赠送（次/日）"
          rules={[{ required: true, type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER }]}>
          <InputNumber min={1} precision={0} />
        </Form.Item>}
        <Form.Item name="actualReceivedHearts" label="接单实际实收爱心（颗，可留空）"
          rules={[{ type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER }]}>
          <InputNumber min={0} precision={0} />
        </Form.Item>
        {claimError && <Alert type="error" showIcon title={claimError} />}
        <Button type="primary" htmlType="submit" loading={busy}>{target.offer ? "确认承接" : "提交抢单"}</Button>
      </Form>}
    </Modal>
  </>;
}
