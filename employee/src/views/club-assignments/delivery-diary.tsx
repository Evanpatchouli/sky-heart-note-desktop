import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Flex, Progress, Spin, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";
import ClubDeliveryPeriods from "#/components/ClubDeliveryPeriods";
import DeliveryReportForm, { periodLabels, type ReportDraft } from "./delivery-report-form";
import { type AssignedOrder, type DeliveryProgress, type ReportLine, type ReportRecord, requestMessage, totalHearts } from "./types";

type HistoryPage = { items: ReportRecord[]; nextCursor: string | null };
type RequestBody = { requestId: string; lines: ReportLine[]; reason?: string };
type Pending = RequestBody & (
  | { kind: "daily" | "supplement"; shareId: string; accountId: string; businessDate: string }
  | { kind: "correction"; originalId: string; expectedVersion: number }
);

const emptySegments = [] as const;
const historyLabels = { daily: "日报", supplement: "补报", correction: "更正申请" };
const checkLabels = { unmatched_period: "适用计价段待核算", quantity_mismatch: "次数与到账差异待核对" };
const idPattern = /^[0-9a-f]{24}$/;

function readPending(key: string): Pending | undefined {
  try {
    const input: Pending | null = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!input || typeof input.requestId !== "string" || !Array.isArray(input.lines)) return;
    if (input.kind === "correction" && idPattern.test(input.originalId)) return input;
    if ((input.kind === "daily" || input.kind === "supplement") && idPattern.test(input.shareId) && idPattern.test(input.accountId)) return input;
  } catch {
    // A malformed or inaccessible entry should not prevent reading the diary.
  }
}

function persistPending(key: string, input?: Pending) {
  try {
    if (input) sessionStorage.setItem(key, JSON.stringify(input));
    else sessionStorage.removeItem(key);
  } catch {
    // The current page can still retry using its in-memory copy.
  }
}

export default function DeliveryDiary({ order, delivery, route, refresh, disabled, onSaved }: {
  order: AssignedOrder;
  delivery: DeliveryProgress;
  route: string;
  refresh: number;
  disabled: boolean;
  onSaved: () => void;
}) {
  const { id: userId, token } = useAuthSession();
  const storageKey = `sky-heart.delivery-report.v1:${userId}:${route}`;
  const historyRoute = `${route}/daily-reports`;
  const [page, setPage] = useState<HistoryPage>();
  const [after, setAfter] = useState<string>();
  const [historyError, setHistoryError] = useState("");
  const [draft, setDraft] = useState<ReportDraft>();
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "warning"; title: string }>();
  const inFlight = useRef<AbortController>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const path = after ? `${historyRoute}?after=${encodeURIComponent(after)}` : historyRoute;
    employeeRequest<HistoryPage>(path, "GET", undefined, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setPage(value);
      setHistoryError("");
    }).catch(error => {
      if (!controller.signal.aborted) setHistoryError(requestMessage(error));
    });
    return () => controller.abort();
  }, [after, historyRoute, refresh]);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function submit(input: Pending, retry = false) {
    if (inFlight.current || disabled || getAppToken("employee") !== token) return;
    const { kind, requestId, lines, reason } = input;
    const correction = kind === "correction";
    const path = correction ? `${historyRoute}/${input.originalId}/corrections`
      : `${route}/shares/${input.shareId}/execution-accounts/${input.accountId}/daily-reports`;
    const body = correction ? { requestId, lines, reason, expectedVersion: input.expectedVersion }
      : { requestId, lines, reason, kind, businessDate: input.businessDate };
    const controller = new AbortController();
    inFlight.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setSaving(true);
    setDraft(undefined);
    setFeedback(undefined);
    setPending(input);
    persistPending(storageKey, input);
    try {
      const result = await employeeRequest<ReportRecord>(path, "POST", body, controller.signal);
      if (controller.signal.aborted || getAppToken("employee") !== token) return;
      if (!result?.id || result.userId !== userId || result.kind !== kind) throw new Error("未收到有效日报回执");
      setPending(undefined);
      persistPending(storageKey);
      setAfter(undefined);
      setFeedback({ type: "success", title: kind === "daily" ? `日报已登记，实测到账 ${result.receivedHearts} 颗` : `${historyLabels[kind]}已提交，待核对` });
      onSaved();
    } catch (error) {
      if (getAppToken("employee") !== token) return;
      if (error instanceof RequestError && ([400, 409].includes(error.status) || (!retry && [403, 404].includes(error.status)))) {
        setPending(undefined);
        persistPending(storageKey);
        onSaved();
      }
      setFeedback({ type: "warning", title: requestMessage(error) });
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = undefined;
      setSaving(false);
    }
  }

  const segments = delivery.quoteSegments ?? emptySegments;
  const accountOptions = order.shares.flatMap(share => share.executionGameAccounts.filter(account => account.personalAccountId).map(account => ({
    value: `${share.id}:${account.id}`,
    label: `${account.name} · #${account.localAccountId ?? account.id} · 份额 ${share.id.slice(-6)}`,
  })));
  const formDisabled = disabled || saving || !!pending;
  const promised = totalHearts(order);
  const fulfillmentHearts = order.fulfillmentHearts ?? order.requestedHearts;

  return <Card size="small" title="我的日报（历史按颗）">
    <Flex vertical gap="middle">
      <div>
        <Typography.Text strong>全单已抵扣 {delivery.orderCreditedHearts} / {fulfillmentHearts} 颗</Typography.Text>
        <Progress percent={100 * delivery.orderCreditedHearts / fulfillmentHearts} showInfo={false} aria-label="全单履约进度" />
        <Typography.Text type="secondary">{delivery.orderStoppedHearts !== undefined ? `全单已停送 ${delivery.orderStoppedHearts}` : `全单剩余 ${delivery.orderRemainingHearts}`} 颗</Typography.Text>
      </div>
      <dl className="club-order-facts">
        <div><dt>本人承接</dt><dd>{promised} 颗</dd></div>
        <div><dt>本人已报实绩</dt><dd>{delivery.myGiftTimes} 次 · 到账 {delivery.myObservedHearts} 颗</dd></div>
        <div><dt>本人份额内抵扣</dt><dd>{delivery.myCreditedHearts} 颗 · {delivery.myStoppedHearts !== undefined ? `已停送 ${delivery.myStoppedHearts}` : `剩余 ${delivery.myRemainingHearts}`} 颗</dd></div>
      </dl>
      {delivery.periodBreakdown ? <ClubDeliveryPeriods breakdown={delivery.periodBreakdown}
        segmentsOverPlan={delivery.segmentsOverPlan} personal /> : null}
      {delivery.holdReason ? <Alert type="info" showIcon title={delivery.holdReason} /> : null}
      {delivery.myExcessHearts !== 0 ? <Alert type="warning" showIcon title={`额外到账 ${delivery.myExcessHearts} 颗，待核算`}
        description={delivery.shares.filter(share => share.excessHearts !== 0).map(share => `份额 ${share.id.slice(-6)} 实到 ${share.observedHearts} 颗，份额内抵扣 ${share.creditedHearts} 颗`).join("；")} /> : null}
      <Flex gap="small" wrap>
        <Button type="primary" disabled={formDisabled || !!delivery.holdReason || !accountOptions.length} onClick={() => setDraft({ kind: "daily" })}>填报日报</Button>
        <Button disabled={formDisabled || !accountOptions.length} onClick={() => setDraft({ kind: "supplement" })}>补报漏填日期</Button>
      </Flex>
      {!accountOptions.length ? <Typography.Text type="secondary">请先在本人份额中关联送心号。</Typography.Text> : null}
      {feedback ? <Alert type={feedback.type} showIcon title={feedback.title} /> : null}
      {pending ? <Alert type="warning" showIcon title="提交结果待确认" description="重试会沿用本次提交的内容和标识。"
        action={<Button loading={saving} disabled={disabled} onClick={() => { void submit(pending, true); }}>重试本次提交</Button>} /> : null}
      {historyError ? <Alert type="error" showIcon title={historyError} action={<Button onClick={onSaved}>重试</Button>} /> : null}
      {page ? <>
        <Typography.Text strong>日报历史</Typography.Text>
        {page.items.length ? <ul className="club-share-list club-report-history">
          {page.items.map(record => <li key={record.id}>
            <div>
              <strong>{record.businessDate} · {historyLabels[record.kind]} · 第 {record.version} 版</strong>{" "}
              <Tag color={record.status === "recorded" ? "success" : "warning"}>{record.status === "recorded" ? "已登记" : "待核对"}</Tag>
              <div>{record.accountName}{record.accountLocalId ? ` · #${record.accountLocalId}` : ""} → {record.recipientGameAccount}</div>
              <div>实测 {record.giftTimes} 次 · 到账 {record.receivedHearts} 颗</div>
              <Typography.Text type="secondary">提交于 {dayjs(record.submittedAt).format("YYYY-MM-DD HH:mm:ss Z")} · {record.userId}</Typography.Text>
              {record.checks.length ? <div>{record.checks.map(check => <Tag color="warning" key={check}>{checkLabels[check]}</Tag>)}</div> : null}
              {record.reason ? <div>原因 {record.reason}</div> : null}
              <details>
                <summary>{record.previous ? "查看更正前后" : "查看时段明细"}</summary>
                {record.previous ? <>
                  <div>第 {record.previous.version} 版{historyLabels[record.previous.kind]} · {record.previous.status === "recorded" ? "已登记" : "待核对"} · {record.previous.giftTimes} 次 · {record.previous.receivedHearts} 颗</div>
                  <Lines lines={record.previous.lines} />
                  <div>本次申请 · {record.giftTimes} 次 · {record.receivedHearts} 颗</div>
                </> : null}
                <Lines lines={record.lines} />
              </details>
            </div>
            {record.version === record.latestVersion ? <Button disabled={formDisabled} onClick={() => setDraft({ kind: "correction", record })}>申请更正</Button> : null}
          </li>)}
        </ul> : <Typography.Text type="secondary">暂无日报</Typography.Text>}
        {after || page.nextCursor ? <Flex gap="small" wrap>
          {after ? <Button onClick={() => { setPage(undefined); setAfter(undefined); }}>返回最新</Button> : null}
          {page.nextCursor ? <Button onClick={() => { setPage(undefined); setAfter(page.nextCursor ?? undefined); }}>查看更早日报</Button> : null}
        </Flex> : null}
      </> : historyError ? null : <Spin aria-label="加载日报历史" />}
    </Flex>
    {draft ? <DeliveryReportForm draft={draft} accounts={accountOptions} segments={segments} recipient={order.recipientGameAccount}
      onCancel={() => setDraft(undefined)} onSubmit={values => {
        const input = { requestId: crypto.randomUUID(), lines: values.lines, reason: values.reason?.trim() || undefined };
        if (draft.kind === "correction") {
          void submit({ ...input, kind: draft.kind, originalId: draft.record.originalId, expectedVersion: draft.record.version });
        } else {
          const [shareId, accountId] = values.target.split(":");
          void submit({ ...input, kind: draft.kind, shareId, accountId, businessDate: values.businessDate });
        }
      }} /> : null}
  </Card>;
}

function Lines({ lines }: { lines: ReportLine[] }) {
  return <ul className="club-report-terms">{lines.map((line, index) => <li key={index}>
    {periodLabels[line.period]}{line.quoteSegment ? ` · 选填报价第 ${line.quoteSegment} 段` : ""} · {line.giftTimes} 次 · {line.receivedHearts} 颗
  </li>)}</ul>;
}
