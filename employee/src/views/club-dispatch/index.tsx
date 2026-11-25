import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Select, Spin, Tag, Typography } from "antd";
import { RequestError } from "@webapp-template/common/web-auth";
import {
  commissionBasisLabel, commissionUnit, formatCentsAsYuan,
  type CommissionRule, type DispatchPricing, type OrderPricing,
} from "@webapp-template/common";
import { Link, useSearchParams } from "react-router";
import Header from "#/components/Header";
import { employeeRequest } from "#/service/request";

import NewDirectDraft from "./new-direct-draft";
import CustomerActivation from "./customer-activation";
import GiftDispatchPricing from "./gift-dispatch-pricing";
import { GiftExceptionQueue, GiftSupervisionCard } from "./gift-supervision";
import PendingAssignment from "./pending-assignment";
import MemberInvitation from "./member-invitation";
import type { DeliveryPeriodPreference } from "@webapp-template/common";

type Club = { id: string; name: string; orderUrl: string; canAssignPendingOrders?: boolean };
type Order = {
  id: string;
  source: keyof typeof sources;
  dispatchStatus: keyof typeof statuses;
  customerUserId?: string | null;
  customerLinkStatus?: "verified" | "pending_verification";
  customerActivationAvailable?: boolean;
  recipientGameAccount: string;
} & (
  | { requestedHearts: number; requestedGiftTimes?: never; estimatedReceivedHearts?: never }
  | { requestedHearts?: never; requestedGiftTimes: number; estimatedReceivedHearts?: number; deliveryPeriodPreference?: DeliveryPeriodPreference; doubleGiftTimes?: number }
);
type HistoricalOrder = Extract<Order, { requestedHearts: number }>;
type Preparation = {
  rule: CommissionRule | null;
  pricing: OrderPricing | null;
  dispatchPricing: DispatchPricing | null;
  dispatchStatus: Order["dispatchStatus"];
};
type Page = { items: Order[]; nextCursor: string | null };

const statuses = { draft: "直接派单草稿", pending: "待派发", published: "已派发" };
const sources = { direct_dispatch: "直接派单", client_order: "客户端下单" };
const periods = { normal: "普通期", double: "双倍期" };

function requestError(err: unknown) {
  return err instanceof RequestError ? err.message : "请求失败，请检查网络连接后重试";
}

export default function ClubDispatch() {
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [params, setParams] = useSearchParams();
  const clubId = params.get("clubId");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const selected = clubs?.find(club => club.id === clubId) ?? clubs?.[0];

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<Club[]>("clubs", "GET", undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setClubs(data);
    }).catch(err => {
      if (!controller.signal.aborted) setError(requestError(err));
    });
    return () => controller.abort();
  }, [attempt]);

  return <>
    <Header />
    <main style={{ flex: 1, overflow: "auto", padding: 16, width: "100%", boxSizing: "border-box" }}>
      <Flex vertical gap="middle" style={{ maxWidth: 820, marginInline: "auto" }}>
        <Link to="/">返回个人订单</Link>
        <Typography.Title level={3} style={{ margin: 0 }}>派单准备</Typography.Title>
        {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
          : clubs === null ? <Spin aria-label="加载俱乐部" />
          : selected ? <>
            <label>俱乐部 <Select aria-label="俱乐部" value={selected.id} onChange={clubId => setParams({ clubId })}
              options={clubs.map(club => ({ value: club.id, label: club.name }))} style={{ minWidth: 140 }} /></label>
            <Typography.Text copyable={{ text: selected.orderUrl, tooltips: ["复制客户端下单链接", "已复制"] }}>
              <Typography.Link href={selected.orderUrl} target="_blank" rel="noopener noreferrer">客户端下单链接</Typography.Link>
            </Typography.Text>
            <MemberInvitation key={selected.id} clubId={selected.id} />
            <ClubOrders key={selected.id + (params.get("orderId") ?? "")} clubId={selected.id}
              linkedId={params.get("orderId") ?? undefined} canAssign={selected.canAssignPendingOrders} />
          </> : <Empty description="暂无可访问的俱乐部" />}
      </Flex>
    </main>
  </>;
}

function ClubOrders({ clubId, canAssign, linkedId }: { clubId: string; canAssign?: boolean; linkedId?: string }) {
  const route = `clubs/${clubId}/orders`;
  const [page, setPage] = useState<Page>();
  const [after, setAfter] = useState<string>();
  const [selectedId, setSelectedId] = useState(linkedId);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [through, setThrough] = useState<string>();
  const [fulfillmentRevision, setFulfillmentRevision] = useState(0);
  const [exceptionOrder, setExceptionOrder] = useState<Order>();
  const fulfillmentPanel = useRef<HTMLDivElement>(null);
  const [linkedOrder, setLinkedOrder] = useState<Order>();
  const [linkError, setLinkError] = useState("");
  const order = page?.items.find(value => value.id === selectedId) ?? exceptionOrder
    ?? (linkedId && selectedId === linkedId ? linkedOrder : page?.items[0]);

  useEffect(() => {
    if (!linkedId) return;
    const controller = new AbortController();
    employeeRequest<Order>(`${route}/${encodeURIComponent(linkedId)}`, "GET", undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) setLinkedOrder(value);
    }).catch(err => {
      if (!controller.signal.aborted) setLinkError(requestError(err));
    });
    return () => controller.abort();
  }, [linkedId, route, attempt]);

  function refreshFulfillment() {
    setFulfillmentRevision(value => value + 1);
  }

  function openException(selected: Order) {
    setSelectedId(selected.id);
    setExceptionOrder(selected);
    requestAnimationFrame(() => {
      fulfillmentPanel.current?.focus({ preventScroll: true });
      fulfillmentPanel.current?.scrollIntoView({ block: "start" });
    });
  }

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    const query = new URLSearchParams({ responsibility: "dispatcher" });
    if (after) query.set("after", after);
    employeeRequest<Page>(`${route}?${query}`, "GET", undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setPage(data);
    }).catch(err => {
      if (!controller.signal.aborted) setError(requestError(err));
    });
    return () => controller.abort();
  }, [route, after, attempt]);

  function goTo(cursor?: string) {
    setPage(undefined);
    setExceptionOrder(undefined);
    setAfter(cursor);
  }

  return <>
    {canAssign ? <PendingAssignment clubId={clubId} onAssigned={id => {
      setSelectedId(id);
      setAfter(undefined);
      setAttempt(value => value + 1);
    }} /> : null}
    <GiftExceptionQueue<Order> route={route} through={through} revision={fulfillmentRevision} onOpen={openException}
      onCheck={date => { setThrough(date); refreshFulfillment(); }} />
    <Card size="small" title="我负责派发的订单" extra={<Button onClick={() => setCreating(true)}>新建直接派单草稿</Button>}>
      {linkError && selectedId === linkedId && <Alert type="error" showIcon title={linkError}
        action={<Button onClick={() => { setLinkError(""); setAttempt(value => value + 1); }}>重试</Button>} />}
      {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
        : page ? page.items.length ? <Select aria-label="我负责派发的订单" style={{ width: "100%" }} value={page.items.some(item => item.id === order?.id) ? order?.id : undefined}
          onChange={id => { setExceptionOrder(undefined); setSelectedId(id); }}
          options={page.items.map(value => ({
            value: value.id,
            label: `${sources[value.source]} · ${value.recipientGameAccount} · ${value.requestedGiftTimes === undefined ? `${value.requestedHearts} 颗` : `${value.requestedGiftTimes} 次`} · ${statuses[value.dispatchStatus]} · ${value.id}`,
          }))} />
          : <Empty description="本页没有你负责派发的订单" />
        : <Spin aria-label="加载订单" />}
      {page?.nextCursor || after ? <Flex gap="small" style={{ marginTop: 8 }}>
        <Button disabled={!page || !after} onClick={() => goTo()}>返回首页</Button>
        <Button disabled={!page?.nextCursor} onClick={() => goTo(page?.nextCursor ?? undefined)}>下一页</Button>
      </Flex> : null}
    </Card>
    {order && !error ? <>
      {order.customerLinkStatus ? <Typography.Text>
        {order.customerLinkStatus === "verified" ? `老板 · ${order.customerUserId}` : "老板归属待核"}
      </Typography.Text> : null}
      {order.customerActivationAvailable && <CustomerActivation key={order.id} route={`${route}/${order.id}`} />}
      {order.dispatchStatus === "published" && <div ref={fulfillmentPanel} tabIndex={-1}>
        <GiftSupervisionCard key={order.id} route={`${route}/${order.id}`} through={through}
          revision={fulfillmentRevision} onRefresh={refreshFulfillment} onShowCurrent={() => setThrough(undefined)} />
      </div>}
      {order.requestedGiftTimes !== undefined ? <GiftDispatchPricing onFulfillmentChanged={refreshFulfillment} key={order.id} route={`${route}/${order.id}`} order={order}
        onPublished={() => { setLinkedOrder(previous => previous?.id === order.id ? { ...previous, dispatchStatus: "published" } : previous); setPage(previous => previous && {
          ...previous, items: previous.items.map(item => item.id === order.id ? { ...item, dispatchStatus: "published" } : item),
        }); }} />
        : <OrderPricingForm key={order.id} route={`${route}/${order.id}/pricing`} order={order} />}
    </> : null}
    {creating ? <NewDirectDraft clubId={clubId} onClose={() => setCreating(false)} onCreated={id => {
      setCreating(false);
      setExceptionOrder(undefined);
      setSelectedId(id);
      setAfter(undefined);
      setAttempt(value => value + 1);
    }} /> : null}
  </>;
}

function OrderPricingForm({ route, order }: { route: string; order: HistoricalOrder }) {
  const [preparation, setPreparation] = useState<Preparation>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<Preparation>(route, "GET", undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setPreparation(data);
    }).catch(err => {
      if (!controller.signal.aborted) setError(requestError(err));
    });
    return () => controller.abort();
  }, [route, attempt]);

  return <Card title="订单报价" extra={<Tag>{statuses[preparation?.dispatchStatus ?? order.dispatchStatus]}</Tag>}>
    <Typography.Paragraph>{sources[order.source]} · {order.recipientGameAccount} · 原订购 {order.requestedHearts} 颗</Typography.Paragraph>
    <Typography.Paragraph><code>{order.id}</code></Typography.Paragraph>
    {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
      : !preparation ? <Spin aria-label="加载订单报价" />
      : preparation.dispatchStatus === "published" ? <PublishedPricing pricing={preparation.dispatchPricing} />
      : preparation.pricing ? <>
        <Typography.Paragraph>
          原派抽 ¥{formatCentsAsYuan(preparation.pricing.dispatchFeeCents)}/{commissionUnit(preparation.pricing.basis)}
        </Typography.Paragraph>
        <ul>{preparation.pricing.segments.map((segment, index) => <li key={index}>
          {periods[segment.period]} · {segment.hearts} 颗 · ¥{formatCentsAsYuan(segment.unitPriceCents)}/颗
        </li>)}</ul>
      </> : <Alert type="info" showIcon title="历史订购尚无报价" />}
  </Card>;
}

function PublishedPricing({ pricing }: { pricing: DispatchPricing | null }) {
  if (!pricing) return <Empty description="该历史订单没有规则快照" />;
  const unit = commissionUnit(pricing.basis);
  return <>
    <Typography.Paragraph>规则 V{pricing.version} · {commissionBasisLabel[pricing.basis]}</Typography.Paragraph>
    <Typography.Paragraph>派抽 ¥{formatCentsAsYuan(pricing.dispatchFeeCents)}/{unit} · 团抽 ¥{formatCentsAsYuan(pricing.clubFeeCents)}/{unit}</Typography.Paragraph>
    <ul>{pricing.segments.map((segment, index) => <li key={index}>{periods[segment.period]} · {segment.hearts} 颗 · ¥{formatCentsAsYuan(segment.unitPriceCents)}/颗</li>)}</ul>
  </>;
}
