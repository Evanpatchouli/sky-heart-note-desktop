import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Input, Modal, Spin, Tag, Typography } from "antd";
import {
  type AgreedReportDay, type DispatchFulfillment, type GiftDispatchSupervision, type ShareFulfillment,
} from "@webapp-template/common";
import { RequestError } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";
import ClubDeliveryPeriods, { actualPeriodLabels } from "#/components/ClubDeliveryPeriods";
import type { ReportRecord } from "../club-assignments/types";
import type { Order } from "./index";
import DeliveryPrice from "./delivery-price";
import DispatchTerminationPanel from "./termination";
import { GiftSupervisionFacts } from "./gift-supervision";

type ExceptionPage = {
  items: { order: Order; fulfillment: (DispatchFulfillment & { priceUnit?: "received_hearts" }) | GiftDispatchSupervision }[];
  nextCursor: string | null;
};

function errorMessage(error: unknown) {
  return error instanceof RequestError ? error.message : "请求失败，请检查网络连接后重试";
}

function useFulfillmentRead<T>(path: string | undefined, revision: number) {
  const [result, setResult] = useState<{ path: string; revision: number; data?: T; error?: string }>();
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    employeeRequest<T>(path, "GET", undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ path, revision, data });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ path, revision, error: errorMessage(error) });
    });
    return () => controller.abort();
  }, [path, revision]);
  return result?.path === path && result?.revision === revision ? result : undefined;
}

export function FulfillmentQueue({ route, through, revision, onCheck, onRefresh, onOpen }: {
  route: string;
  through?: string;
  revision: number;
  onCheck: (value?: string) => void;
  onRefresh: () => void;
  onOpen: (order: Order) => void;
}) {
  const dateInput = useId();
  const [date, setDate] = useState(through ?? "");
  const [after, setAfter] = useState<string>();
  const path = through ? `${route}/fulfillment-exceptions?${new URLSearchParams({ through, ...(after ? { after } : {}) })}` : undefined;
  const result = useFulfillmentRead<ExceptionPage>(path, revision);

  return <Card size="small" title="履约异常队列">
    <Flex vertical gap="small">
      <Typography.Text type="secondary">选择已结束的业务日，查看本人负责的订单中逾期份额、未报日期和待核对申请。</Typography.Text>
      <form onSubmit={event => {
        event.preventDefault();
        setAfter(undefined);
        onCheck(date);
      }}>
        <Flex wrap align="end" gap="small">
          <Flex vertical gap={4}>
            <label htmlFor={dateInput}>核对至已结束的业务日</label>
            <Input id={dateInput} type="date" required value={date} onChange={event => setDate(event.target.value)} style={{ minHeight: 44 }} />
          </Flex>
          <Button type="primary" htmlType="submit" style={{ minHeight: 44 }}>核对履约</Button>
          {through ? <Button onClick={() => { setDate(""); setAfter(undefined); onCheck(); }} style={{ minHeight: 44 }}>查看当前累计</Button> : null}
        </Flex>
      </form>
      {through ? <Typography.Text>核对至 {through}（含当日）</Typography.Text> : null}
      {through && !result ? <Spin aria-label="核对履约异常" /> : null}
      {result?.error ? <Alert type="error" showIcon title={result.error} action={<Button onClick={onRefresh}>重试</Button>} /> : null}
      {result?.data ? <>
        {result.data.items.length ? <ul className="club-share-list dispatch-fulfillment-list">
          {result.data.items.map(({ order, fulfillment }) => <li key={order.id}>
            <Flex wrap justify="space-between" align="center" gap="small">
              <div>
                <Typography.Text strong>{order.recipientGameAccount}</Typography.Text>
                <div className="club-order-number">订单号 {order.id}</div>
              </div>
              <Button aria-label={`查看 ${order.recipientGameAccount} 的履约`} onClick={() => onOpen(order)} style={{ minHeight: 44 }}>查看履约</Button>
            </Flex>
            {fulfillment.priceUnit === "gift_times" ? <GiftSupervisionFacts progress={fulfillment} compact /> : <>
            {fulfillment.overdue ? <Typography.Text type="danger">约定截止 {fulfillment.agreedDeadline} · 剩余 {fulfillment.remainingHearts} 颗
              {fulfillment.unclaimedHearts ? `（其中 ${fulfillment.unclaimedHearts} 颗未承接）` : ""}</Typography.Text> : null}
            <ShareList shares={fulfillment.shares} />
            </>}
          </li>)}
        </ul> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本期未发现履约异常" />}
        {after || result.data.nextCursor ? <Flex wrap gap="small">
          <Button disabled={!after} onClick={() => setAfter(undefined)} style={{ minHeight: 44 }}>返回首批</Button>
          <Button disabled={!result.data.nextCursor} onClick={() => setAfter(result.data?.nextCursor ?? undefined)} style={{ minHeight: 44 }}>下一批异常</Button>
        </Flex> : null}
      </> : null}
    </Flex>
  </Card>;
}

export function OrderFulfillment({ route, order, through, revision, onRefresh, onShowCurrent }: {
  route: string;
  order: Order;
  through?: string;
  revision: number;
  onRefresh: () => void;
  onShowCurrent: () => void;
}) {
  const path = `${route}/fulfillment${through ? `?${new URLSearchParams({ through })}` : ""}`;
  const result = useFulfillmentRead<DispatchFulfillment>(path, revision);
  const [editing, setEditing] = useState<"deadline" | ShareFulfillment>();
  const progress = result?.data;
  return <Card size="small" title="履约监督" extra={<Button onClick={onRefresh} style={{ minHeight: 44 }}>刷新履约</Button>}>
    <Flex vertical gap="small">
      <div>
        <Typography.Text strong>{order.recipientGameAccount}</Typography.Text>
        <div className="club-order-number">订单号 {order.id}</div>
      </div>
      {result?.error ? <Alert type="error" showIcon title={result.error} /> : null}
      {!result ? <Spin aria-label="加载履约进度" /> : null}
      {progress ? <>
        <Flex wrap align="center" gap="small">
          <Typography.Text>客户约定截止业务日 · {progress.agreedDeadline ?? "未约定"}</Typography.Text>
          {!progress.agreedDeadline && !progress.termination ? <Button onClick={() => setEditing("deadline")} style={{ minHeight: 44 }}>登记客户约定</Button> : null}
          {progress.overdue ? <Tag color="red">逾期未完成</Tag> : null}
        </Flex>
        <Typography.Text type="secondary">{through ? `实绩截至 ${through}（含当日）` : "当前累计实绩"}</Typography.Text>
        {through ? <Button onClick={onShowCurrent} style={{ alignSelf: "start", minHeight: 44 }}>查看当前分期实绩</Button> : null}
        <Flex wrap gap="middle">
          <span>承诺 <strong>{progress.creditedHearts + progress.remainingHearts}</strong> 颗</span>
          <span>实际到账 <strong>{progress.observedHearts}</strong> 颗</span>
          {progress.stoppedHearts !== undefined ? <>
            <span>原未履约 <strong>{progress.remainingHearts}</strong> 颗</span>
            <span>已停送 <strong>{progress.stoppedHearts}</strong> 颗</span>
            {progress.originallyUnclaimedHearts ? <span>原未承接 <strong>{progress.originallyUnclaimedHearts}</strong> 颗</span> : null}
          </> : <span>剩余 <strong>{progress.remainingHearts}</strong> 颗</span>}
          {progress.unclaimedHearts ? <span>尚未承接 <strong>{progress.unclaimedHearts}</strong> 颗</span> : null}
        </Flex>
        {String(progress.observedHearts) !== String(progress.creditedHearts) ? <Typography.Text type="secondary">其中 {progress.creditedHearts} 颗已抵扣约定份额，份额外到账待核对。</Typography.Text> : null}
        {progress.deliveryReview ? <>
          <DispatchTerminationPanel route={route} termination={progress.termination} mayRecord={progress.remainingHearts > 0}
            historical={!!through} onRefresh={onRefresh} />
          <ClubDeliveryPeriods breakdown={progress.deliveryReview} stopped={!!progress.termination} segmentPrices={
            progress.deliveryReview.comparison.issues.includes("quote_unavailable")
              ? undefined : [
                ...(progress.deliveryReview.comparison.original?.segmentPrices ?? []),
                ...(progress.priceAdjustmentHistory ?? []).map(value => value.shift.targetUnitPriceCents),
                ...(progress.priceAdjustment?.state === "continuing" ? [progress.priceAdjustment.shift.targetUnitPriceCents] : []),
              ]
          } />
          <FulfillmentEvidence key={through ?? "current"} route={route} through={through} revision={revision} onRefresh={onRefresh} />
          <DeliveryPrice route={route} breakdown={progress.deliveryReview} comparison={progress.deliveryReview.comparison}
            adjustment={progress.priceAdjustment} history={progress.priceAdjustmentHistory}
            reviews={progress.priceAdjustmentReviews}
            historical={!!through} stopped={!!progress.termination} onRefresh={onRefresh} />
        </> : null}
        {progress.shares.length ? <ShareList shares={progress.shares} onSetDates={progress.termination ? undefined : setEditing} />
          : <Typography.Text type="secondary">暂无承接份额。</Typography.Text>}
      </> : null}
    </Flex>
    {editing ? <AgreementModal route={route} share={editing === "deadline" ? undefined : editing} onClose={() => setEditing(undefined)}
      onRecorded={() => { setEditing(undefined); onRefresh(); }} /> : null}
  </Card>;
}

function FulfillmentEvidence({ route, through, revision, onRefresh }: {
  route: string;
  through?: string;
  revision: number;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [after, setAfter] = useState<string>();
  const query = new URLSearchParams({ ...(through ? { through } : {}), ...(after ? { after } : {}) });
  const path = open ? `${route}/fulfillment/reports?${query}` : undefined;
  const result = useFulfillmentRead<{ items: ReportRecord[]; nextCursor: string | null }>(path, revision);
  const page = result?.data;
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>查看分期日报依据</summary>
    {open && !result ? <Spin aria-label="加载分期日报依据" /> : null}
    {result?.error ? <Alert type="error" showIcon title={result.error} action={<Button onClick={onRefresh}>重试</Button>} /> : null}
    {page?.items.length ? <ul className="club-share-list">
      {page.items.map(report => <li key={report.id}>
        <div>
          <strong>{report.businessDate} · {report.accountName}（{report.userId}）</strong>{" "}
          <Tag color={report.kind === "daily" ? "success" : "warning"}>
            {report.kind === "daily" ? "已登记日报" : report.kind === "supplement" ? "补报待核对" : "更正待核对"}
          </Tag>
          <ul className="club-report-terms">
            {report.lines.map((line, index) => <li key={index}>{actualPeriodLabels[line.period]}
              {line.quoteSegment ? ` · 报价第 ${line.quoteSegment} 段` : " · 未选报价段"}
              {" · "}{line.giftTimes} 次 · 到账 {line.receivedHearts} 颗
            </li>)}
          </ul>
          {report.reason ? <Typography.Text type="secondary">说明 {report.reason}</Typography.Text> : null}
          <Typography.Text type="secondary" className="club-order-number">份额 {report.shareId} · 日报 {report.id}</Typography.Text>
        </div>
      </li>)}
    </ul> : page ? <Typography.Text type="secondary">暂无日报记录。</Typography.Text> : null}
    {page && (after || page.nextCursor) ? <Flex wrap gap="small">
      <Button disabled={!after} onClick={() => setAfter(undefined)} style={{ minHeight: 44 }}>返回首批日报</Button>
      <Button disabled={!page.nextCursor} onClick={() => setAfter(page.nextCursor ?? undefined)} style={{ minHeight: 44 }}>下一批日报</Button>
    </Flex> : null}
  </details>;
}

function ShareList({ shares, onSetDates }: {
  shares: ShareFulfillment[];
  onSetDates?: (share: ShareFulfillment) => void;
}) {
  return <ul className="club-share-list dispatch-fulfillment-list">
    {shares.map(share => <li key={share.id}>
      <Flex wrap align="center" gap="small">
        <Typography.Text strong>{share.nickname || "团员"}（{share.userId}）</Typography.Text>
        {share.overdue ? <Tag color="red">份额逾期未完成</Tag> : null}
      </Flex>
      <div className="club-order-number">份额 {share.id}</div>
      <div>约定 {share.promisedHearts} 颗 · 实际到账 {share.observedHearts} 颗 · {share.stoppedHearts !== undefined ? `已停送 ${share.stoppedHearts}` : `剩余 ${share.remainingHearts}`} 颗</div>
      {share.days.length ? <ul className="dispatch-fulfillment-days">
        {share.days.map(day => <li key={day.date}><time dateTime={day.date}>{day.date}</time><ReportDay day={day} /></li>)}
      </ul> : onSetDates ? <Flex wrap align="center" gap="small">
        <Typography.Text type="secondary">份额日报未排期</Typography.Text>
        <Button aria-label={`登记份额 ${share.id} 的约定日报日期`} onClick={() => onSetDates(share)} style={{ minHeight: 44 }}>登记约定日报日期</Button>
      </Flex> : null}
    </li>)}
  </ul>;
}

function ReportDay({ day }: { day: AgreedReportDay }) {
  return <>
    {day.status === "recorded" ? <Tag color="green">{day.reportedAccounts} 个号已报 · 到账 {day.observedHearts} 颗</Tag> : null}
    {day.status === "missing" ? <Tag color="red">该份额当日无日报</Tag> : null}
    {day.status === "not_due" ? <Tag>晚于核对日</Tag> : null}
    {day.status === "not_checked" ? <Tag>待选择核对日</Tag> : null}
    {day.status === "stopped" ? <Tag>订单已停送</Tag> : null}
    {day.supplementPending ? <Tag color="gold">补报待核对</Tag> : null}
    {day.correctionPending ? <Tag color="gold">更正待核对</Tag> : null}
  </>;
}

function AgreementModal({ route, share, onClose, onRecorded }: {
  route: string;
  share?: ShareFulfillment;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const inputId = useId();
  const [dates, setDates] = useState([""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title = share ? "登记约定日报日期" : "登记客户约定截止业务日";

  async function save() {
    if (saving) return;
    if (new Set(dates).size !== dates.length) {
      setError("请移除重复的业务日");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (share) {
        await employeeRequest(`${route}/shares/${share.id}/agreed-report-dates`, "PATCH", { businessDates: dates });
      } else {
        await employeeRequest(`${route}/agreed-deadline`, "PATCH", { businessDate: dates[0] });
      }
      onRecorded();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return <Modal open title={title} okText="确认登记" cancelText="取消" onCancel={onClose}
    confirmLoading={saving} onOk={() => form.current?.requestSubmit()}
    cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }}>
    <Typography.Paragraph>{share
      ? `为 ${share.nickname || "团员"}（${share.userId}）记录该份额实际约定要填日报的日期。请核对日期完整后登记，原约定将保留。`
      : "填写已经和客户确认的截止业务日。请核对后登记，原约定将保留。"}</Typography.Paragraph>
    <form ref={form} onSubmit={event => { event.preventDefault(); void save(); }}>
      <Flex vertical gap="small" style={{ maxHeight: "46vh", overflow: "auto", padding: 4 }}>
        {dates.map((date, index) => <Flex key={index} wrap align="end" gap="small">
          <Flex vertical gap={4}>
            <label htmlFor={`${inputId}-${index}`}>{share ? `约定日报日期 ${index + 1}` : "截止业务日"}</label>
            <Input id={`${inputId}-${index}`} type="date" required value={date} disabled={saving}
              onChange={event => setDates(dates.map((value, i) => i === index ? event.target.value : value))} style={{ minHeight: 44 }} />
          </Flex>
          {dates.length > 1 ? <Button aria-label={`移除日期 ${index + 1}`} onClick={() => setDates(dates.filter((_, i) => i !== index))} disabled={saving} style={{ minHeight: 44 }}>移除</Button> : null}
        </Flex>)}
        {share ? <Button onClick={() => setDates([...dates, ""])} disabled={saving} style={{ alignSelf: "start", minHeight: 44 }}>添加日期</Button> : null}
      </Flex>
    </form>
    {error ? <Alert type="error" showIcon title={error} /> : null}
  </Modal>;
}
