import { useEffect, useState } from "react";
import { Alert, Button, Card, Flex, Input, Spin, Typography } from "antd";
import { formatCentsAsYuan, type GiftDispatchSupervision, type GiftSupervisionDay } from "@webapp-template/common";
import { RequestError } from "@webapp-template/common/web-auth";
import { GiftPeriodFacts, giftHearts as hearts, giftMoney, giftPeriodLabels as periodLabels } from "#/components/GiftPeriodFacts";
import { employeeRequest } from "#/service/request";

const dayLabels: Record<GiftSupervisionDay["status"], string> = {
  not_checked: "尚未核对",
  future: "尚未到核对日",
  missing: "漏报",
  reported_zero: "零送已报",
  short: "已报不足",
  on_track: "正常",
  unplanned: "计划外日报",
};
const fulfillment = { not_started: "尚未开始", in_progress: "履约中", completed: "约定次数已送完", stopped: "已停送" };

export type HistoricalSupervision = {
  priceUnit: "received_hearts";
  observedHearts: number | string;
  creditedHearts: number;
  remainingHearts: number;
  agreedDeadline: string | null;
  closedAt: string | null;
  shares: { id: string; userId: string; nickname: string | null; promisedHearts: number; observedHearts: number | string; remainingHearts: number }[];
};

export function GiftSupervisionCard({ route, through, revision, onRefresh, onShowCurrent }: {
  route: string;
  through?: string;
  revision: number;
  onRefresh: () => void;
  onShowCurrent: () => void;
}) {
  const [data, setData] = useState<GiftDispatchSupervision | HistoricalSupervision>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setData(undefined);
    const query = through ? `?${new URLSearchParams({ through })}` : "";
    employeeRequest<GiftDispatchSupervision | HistoricalSupervision>(route + "/fulfillment" + query, "GET", undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setData(value); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof RequestError ? err.message : "履约读取失败，请重试"); });
    return () => controller.abort();
  }, [route, through, revision]);

  return <Card size="small" title="履约监督" extra={<Button onClick={onRefresh}>刷新履约</Button>}>
    {through ? <Flex gap="small" align="center" wrap>
      <Typography.Text>截至已结束业务日 {through}</Typography.Text><Button type="link" onClick={onShowCurrent}>查看当前</Button>
    </Flex> : <p>在异常队列选择已结束业务日后，可核对漏报、少送和窗口到期情况。</p>}
    {error ? <Alert type="error" showIcon title={error} /> : !data ? <Spin aria-label="加载履约监督" />
      : data.priceUnit === "gift_times" ? <GiftSupervisionFacts progress={data} />
        : <><p>历史按颗 · 实际到账 {data.observedHearts} 颗 · 已履约 {data.creditedHearts} 颗 · 剩余 {data.remainingHearts} 颗
          {" · "}{data.closedAt ? "已确认结单" : "尚未结单"}</p>
          {data.agreedDeadline && <p>约定截止 {data.agreedDeadline}</p>}
          <ul>{data.shares.map(share => <li key={share.id}>{share.nickname ?? share.userId} · 约定 {share.promisedHearts} 颗 · 已到账 {share.observedHearts} 颗 · 剩余 {share.remainingHearts} 颗</li>)}</ul>
        </>}
  </Card>;
}

function GiftDays({ days }: { days: GiftSupervisionDay[] }) {
  return days.length ? <ul>{days.map(day => <li key={day.businessDate}>
    {day.businessDate} · 计划 {day.plannedGiftTimes} 次 · 已报 {day.reportedGiftTimes} 次 · 日报到账 {hearts(day.actualReceivedHearts)} · {dayLabels[day.status]}
  </li>)}</ul> : null;
}

export function GiftSupervisionFacts({ progress, compact = false }: { progress: GiftDispatchSupervision; compact?: boolean }) {
  return <>
    <p>约定 {progress.agreedGiftTimes} 次 · 已送 {progress.deliveredGiftTimes} 次 · 剩余 {progress.remainingGiftTimes} 次 · 日报到账 {hearts(progress.actualReceivedHearts)}</p>
    {!compact && <>
      <p>建单预计到账 {hearts(progress.estimatedReceivedHearts)} · 按实际时段预计到账 {hearts(progress.estimatedDeliveredHearts)}</p>
      <p>按已送次数核对爱心款 {giftMoney(progress.heartAmountCents)} · 仅改变到账倍率的价差 {giftMoney(progress.periodOnlyDifferenceCents)}。每次单价沿用原段约定。</p>
      <GiftPeriodFacts performance={progress} />
    </>}
    {!compact && <p>{fulfillment[progress.fulfillmentStatus]} · {progress.closedAt ? "派单人已确认结单" : "尚未结单"}</p>}
    {progress.segments.map(segment => <section key={segment.segmentIndex}>
      <Typography.Title level={5}>第 {segment.segmentIndex + 1} 段 · 报价 {periodLabels[segment.period]}</Typography.Title>
      <p>约定 {segment.agreedGiftTimes} 次 · {segment.dailyGiftTimes} 次/日 · ¥{formatCentsAsYuan(segment.unitPriceCents)}/次
        {" · "}已领 {segment.claimedGiftTimes} 次 · 未承接 {segment.unclaimedGiftTimes} 次</p>
      <p>{segment.window ? `执行 ${segment.window.startDate} 至 ${segment.window.endDate}` : "执行窗口待配置"}
        {" · "}已送 {segment.deliveredGiftTimes} 次 · 剩余 {segment.remainingGiftTimes} 次</p>
      {!compact && <>
        <p>原段预计到账 {hearts(segment.estimatedReceivedHearts)} · 日报到账 {hearts(segment.actualReceivedHearts)}
          {" · "}已送爱心款依据 {giftMoney(segment.heartAmountCents)}</p>
        <GiftPeriodFacts performance={segment} />
      </>}
      {segment.overdueUnclaimedGiftTimes > 0 && <p>已过期未承接 {segment.overdueUnclaimedGiftTimes} 次</p>}
      {segment.members.map(member => <details key={member.userId} open={compact || undefined}>
        <summary>{member.nickname ? `${member.nickname}（${member.userId}）` : member.userId}
          {" · "}原领 {member.originallyClaimedGiftTimes} 次 · 已改派 {member.transferredGiftTimes} 次 · 净份额 {member.agreedGiftTimes} 次
          {" · "}已送 {member.deliveredGiftTimes} 次 · 剩余 {member.remainingGiftTimes} 次
          {member.overdueGiftTimes ? ` · 已过期未补 ${member.overdueGiftTimes} 次` : ""}</summary>
        {!compact && <>
          <p>已送爱心款依据 {giftMoney(member.heartAmountCents)}</p>
          <GiftPeriodFacts performance={member} />
          <GiftDays days={member.days} />
        </>}
        {member.shares.map(share => <details key={share.shareId} open={compact || undefined}>
          <summary>份额 {share.shareId} · {share.window ? `${share.window.startDate} 至 ${share.window.endDate}` : "全部改派"}
            {" · "}净份额 {share.agreedGiftTimes} 次 · 已送 {share.deliveredGiftTimes} 次
            {share.overdueGiftTimes ? ` · 已过期未补 ${share.overdueGiftTimes} 次` : ""}</summary>
          {share.transferredGiftTimes > 0 && <p>原窗口 {share.originalWindow.startDate} 至 {share.originalWindow.endDate} · 已改派 {share.transferredGiftTimes} 次</p>}
          {!compact && <>
            <p>接单时观察 {hearts(share.claimObservedReceivedHearts)}</p>
            <GiftPeriodFacts performance={share} />
          </>}
          <GiftDays days={share.days} />
        </details>)}
      </details>)}
    </section>)}
  </>;
}

export type GiftQueueOrder = { id: string; recipientGameAccount: string; requestedGiftTimes?: number };

export function GiftExceptionQueue<Order extends GiftQueueOrder>({ route, through, revision, onCheck, onOpen }: {
  route: string;
  through?: string;
  revision: number;
  onCheck: (date: string) => void;
  onOpen: (order: Order) => void;
}) {
  const [date, setDate] = useState("");
  const [after, setAfter] = useState<string>();
  const [error, setError] = useState("");
  const [page, setPage] = useState<{ items: { order: Order; fulfillment: GiftDispatchSupervision }[]; nextCursor: string | null }>();
  useEffect(() => {
    if (!through) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ through, ...(after ? { after } : {}) });
    setError("");
    setPage(undefined);
    employeeRequest<NonNullable<typeof page>>(`${route}/fulfillment-exceptions?${query}`, "GET", undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setPage(value); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof RequestError ? err.message : "异常队列读取失败"); });
    return () => controller.abort();
  }, [after, route, through, revision]);
  return <Card size="small" title="履约异常队列">
    <form onSubmit={event => { event.preventDefault(); if (date) { setAfter(undefined); onCheck(date); } }}>
      <Flex align="end" gap="small" wrap>
        <label>已结束业务日 <Input type="date" value={date} onChange={event => setDate(event.target.value)} required /></label>
        <Button htmlType="submit" disabled={!date}>核对异常</Button>
      </Flex>
    </form>
    {!through ? null : error ? <Alert type="error" showIcon title={error} /> : !page ? <Spin aria-label="加载履约异常" /> : <>
      {page.items.length ? <ul>{page.items.map(({ order, fulfillment }) => <li key={order.id}>
        <Button type="link" onClick={() => onOpen(order)}>查看 {order.recipientGameAccount} 的履约监督</Button>
        <GiftSupervisionFacts progress={fulfillment} compact />
      </li>)}</ul> : <p>截至 {through} 未查到异常。</p>}
      {after || page.nextCursor ? <Flex gap="small">
        <Button disabled={!after} onClick={() => setAfter(undefined)}>返回首页</Button>
        <Button disabled={!page.nextCursor} onClick={() => setAfter(page.nextCursor ?? undefined)}>下一页</Button>
      </Flex> : null}
    </>}
  </Card>;
}
