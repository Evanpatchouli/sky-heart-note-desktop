import { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Form, Input, InputNumber, Modal, Radio, Select, Spin, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { formatCentsAsYuan, type GiftClaimOrder, type GiftDailyReport, type GiftDeliveryProgress, type GiftReportPeriod } from "@webapp-template/common";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { GiftPeriodFacts, giftHearts as actual, giftPeriodLabels as periodLabels } from "#/components/GiftPeriodFacts";
import { employeeRequest } from "#/service/request";

type EntryLine = { shareId: string; period?: GiftReportPeriod; giftTimes: number; receivedHearts?: number | null };
type Fields = { accountId: string; businessDate: string; reason?: string; lines: EntryLine[] };
type Draft = { kind: "daily" | "supplement" } | { kind: "correction"; report: GiftDailyReport };
type Pending = Pick<Fields, "lines" | "reason"> & { requestId: string } & (
  | { kind: "daily" | "supplement"; shareId: string; accountId: string; businessDate: string }
  | { kind: "correction"; originalId: string; expectedVersion: number }
);
type History = { items: GiftDailyReport[]; nextCursor: string | null; giftProgress: GiftDeliveryProgress };

const kindLabels = { daily: "日报", supplement: "补报", correction: "更正" };
const periodOptions = [
  { value: "normal", label: periodLabels.normal },
  { value: "double", label: periodLabels.double },
  { value: "unconfirmed", label: "待核对" },
];
const countRule = { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER } as const;
const idPattern = /^[0-9a-f]{24}$/;
const requestPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBusinessDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function pendingLine(value: unknown): value is EntryLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<EntryLine>;
  return isId(line.shareId) && isCount(line.giftTimes) &&
    (line.receivedHearts == null || isCount(line.receivedHearts)) &&
    (line.period === undefined || typeof line.period === "string" && Object.hasOwn(periodLabels, line.period));
}

function readPending(key: string): Pending | undefined {
  try {
    const input: Partial<Pending> | null = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!input || typeof input.requestId !== "string" || !requestPattern.test(input.requestId) ||
      !Array.isArray(input.lines) || !input.lines.length || !input.lines.every(pendingLine)) return;
    if (input.reason !== undefined && (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 240)) return;
    const base = {
      requestId: input.requestId,
      reason: input.reason,
      lines: input.lines.map(({ shareId, period, giftTimes, receivedHearts }) =>
        ({ shareId, period, giftTimes, receivedHearts: receivedHearts ?? null })),
    };
    if (input.kind === "correction" && isId(input.originalId) && input.reason &&
      isCount(input.expectedVersion) && input.expectedVersion > 0 && input.expectedVersion < Number.MAX_SAFE_INTEGER)
      return { ...base, kind: input.kind, originalId: input.originalId, expectedVersion: input.expectedVersion };
    if ((input.kind === "daily" || input.kind === "supplement" && input.reason) &&
      isId(input.shareId) && input.shareId === input.lines[0].shareId && isId(input.accountId) &&
      isBusinessDate(input.businessDate))
      return { ...base, kind: input.kind, shareId: input.shareId, accountId: input.accountId, businessDate: input.businessDate };
  } catch {
    return undefined;
  }
}

function writePending(key: string, value?: Pending) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    // The current page retains the original request for retry.
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败，请重试";
}

export default function GiftDeliveryDiary({ order, orderRoute, onClose }: {
  order: GiftClaimOrder;
  orderRoute: string;
  onClose: () => void;
}) {
  const { id: userId, token } = useAuthSession();
  const [history, setHistory] = useState<History>();
  const [draft, setDraft] = useState<Draft>();
  const [after, setAfter] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef<AbortController>(undefined);
  const historyRoute = `${orderRoute}/daily-reports`;
  const storageKey = `sky-heart.gift-daily-report.v1:${userId}:${orderRoute}`;
  const [pending, setPending] = useState(() => readPending(storageKey));
  const shares = order.segments.flatMap(segment => segment.shares.map(share => ({ ...share, segmentIndex: segment.segmentIndex })));
  const accounts = [...new Map(shares.flatMap(share => (share.executionGameAccounts ?? []).map(account => [account.id, account] as const))).values()];
  const canReport = !!history?.giftProgress && !loading && !loadError;

  useEffect(() => {
    const controller = new AbortController();
    const path = after ? `${historyRoute}?after=${encodeURIComponent(after)}` : historyRoute;
    setLoading(true);
    setLoadError("");
    employeeRequest<History>(path, "GET", undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) setHistory(result);
    }).catch(error => {
      if (!controller.signal.aborted) setLoadError(errorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [after, historyRoute, revision]);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function submit(entry: Pending) {
    if (inFlight.current || getAppToken("employee") !== token) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    inFlight.current = controller;
    setSaving(true);
    setPending(entry);
    setSaveError("");
    setFeedback("");
    writePending(storageKey, entry);
    try {
      const { kind, requestId, lines, reason } = entry;
      const path = kind === "correction" ? `${historyRoute}/${entry.originalId}/corrections`
        : `${orderRoute}/shares/${entry.shareId}/execution-accounts/${entry.accountId}/daily-reports`;
      const body = kind === "correction" ? { requestId, lines, reason, expectedVersion: entry.expectedVersion }
        : { requestId, lines, reason, kind, businessDate: entry.businessDate };
      const result = await employeeRequest<GiftDailyReport>(path, "POST", body, controller.signal);
      if (getAppToken("employee") !== token || controller.signal.aborted) return;
      if (result?.userId !== userId || result.orderId !== order.id || result.priceUnit !== "gift_times" || result.kind !== entry.kind || !result.id)
        throw new Error("未收到有效日报回执");
      setDraft(undefined);
      setPending(undefined);
      writePending(storageKey);
      setFeedback(`${kindLabels[result.kind]}已生效 · ${result.businessDate}`);
      setAfter(undefined);
      setRevision(value => value + 1);
    } catch (error) {
      if (getAppToken("employee") !== token) return;
      if (error instanceof RequestError && [400, 403, 404, 409].includes(error.status)) {
        setPending(undefined);
        writePending(storageKey);
        setRevision(value => value + 1);
        if (error.status === 409) setDraft(undefined);
      } else {
        setDraft(undefined);
      }
      setSaveError(errorMessage(error));
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = undefined;
      setSaving(false);
    }
  }

  function save(fields: Fields) {
    if (!draft || pending || !canReport) return;
    const lines: EntryLine[] = fields.lines.map(({ shareId, period, giftTimes, receivedHearts }) => ({
      shareId, period: period ?? "unconfirmed", giftTimes, receivedHearts: receivedHearts ?? null,
    }));
    const input = { requestId: crypto.randomUUID(), lines, reason: fields.reason?.trim() };
    if (draft.kind === "correction") {
      void submit({
        ...input, kind: draft.kind, originalId: draft.report.originalId, expectedVersion: draft.report.version,
      });
    } else {
      void submit({
        ...input, kind: draft.kind, shareId: lines[0].shareId, accountId: fields.accountId, businessDate: fields.businessDate,
      });
    }
  }

  return <Modal open title="我的日报" footer={null} onCancel={onClose} width={640}
    closable={!saving} keyboard={!saving} mask={{ closable: !saving }}>
    <Flex vertical gap="middle">
      <Typography.Text>接收游戏号 {order.recipientGameAccount}</Typography.Text>
      {history?.giftProgress && <ProgressSummary progress={history.giftProgress} />}
      {loadError ? <Alert type="error" showIcon title={loadError} action={<Button onClick={() => setRevision(value => value + 1)}>重试读取</Button>} /> : null}
      {saveError ? <Alert type="error" showIcon title={saveError} /> : null}
      {feedback ? <Alert type="success" showIcon role="status" title={feedback} /> : null}
      {pending ? <Alert type="warning" showIcon title="本次提交待确认" action={<Button loading={saving} onClick={() => void submit(pending)}>重试本次提交</Button>} /> : null}
      {!draft && !pending && canReport && history && history.giftProgress.canCorrectReports !== false ? accounts.length ? <Flex gap="small" wrap>
        {history?.giftProgress.canSubmitDaily && <Button type="primary" onClick={() => setDraft({ kind: "daily" })}>填日报</Button>}
        <Button onClick={() => setDraft({ kind: "supplement" })}>补报漏填日期</Button>
      </Flex> : <Alert type="info" showIcon title="请先在本人份额中关联送心号" /> : null}
      {history?.giftProgress.canCorrectReports === false && <Alert type="info" showIcon title="订单已结单，日报可供查阅" />}
      {draft && <ReportForm draft={draft} accounts={accounts} shares={shares} saving={saving} onSave={save} onCancel={() => setDraft(undefined)} />}
      {loading ? <Spin aria-label="加载日报" /> : history?.items.length ? history.items.map(report =>
        <Card key={report.id} size="small" title={`${report.businessDate} · ${kindLabels[report.kind]} · 版本 ${report.version}`}
          extra={report.version === report.latestVersion ? <Tag color="green">当前有效</Tag> : <Tag>历史版本</Tag>}>
          <Flex vertical gap="small">
            <Typography.Text>{report.memberNickname ?? report.userId} · {report.accountName}{report.accountLocalId ? ` · #${report.accountLocalId}` : ""}</Typography.Text>
            <Typography.Text>{dayjs(report.submittedAt).format("YYYY-MM-DD HH:mm:ss")} 提交{report.reason ? ` · ${report.reason}` : ""}</Typography.Text>
            {report.previous && <div>
              <Typography.Text>更正前 · 版本 {report.previous.version} · {report.previous.giftTimes} 次 · 实际到账 {actual(report.previous.receivedHearts)}</Typography.Text>
              <ReportLines lines={report.previous.lines} />
            </div>}
            <div>
              <Typography.Text>{report.previous ? "更正后 · " : ""}{report.giftTimes} 次 · 实际到账 {actual(report.receivedHearts)}</Typography.Text>
              <ReportLines lines={report.lines} />
            </div>
            {!draft && !pending && canReport && history.giftProgress.canCorrectReports !== false && report.version === report.latestVersion ?
              <Button onClick={() => setDraft({ kind: "correction", report })}>更正这份日报</Button> : null}
          </Flex>
        </Card>,
      ) : !loadError && <Empty description="暂无日报" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      {(after || history?.nextCursor) && <Flex gap="small" wrap>
        <Button disabled={!after || loading} onClick={() => setAfter(undefined)}>返回最新日报</Button>
        <Button disabled={!history?.nextCursor || loading} onClick={() => setAfter(history?.nextCursor ?? undefined)}>下一页日报</Button>
      </Flex>}
    </Flex>
  </Modal>;
}

function ProgressSummary({ progress }: { progress: GiftDeliveryProgress }) {
  const { pendingCompensation, shares, segments } = progress;
  return <Card size="small" title="本人履约">
    <Flex vertical gap="small">
      <Typography.Text>已送 {progress.deliveredGiftTimes} 次 · 剩余 {progress.remainingGiftTimes} 次</Typography.Text>
      <Typography.Text>按实报日期及时段预计到账 {actual(progress.estimatedDeliveredHearts)} · 日报实际到账 {actual(progress.actualReceivedHearts)}</Typography.Text>
      {progress.unknownReceivedLines > 0 && <Typography.Text type="secondary">
        {progress.knownReceivedLines > 0 ? `已知到账小计 ${progress.knownReceivedHearts} 颗 · ` : ""}
        {progress.unknownReceivedLines} 条明细到账未知
      </Typography.Text>}
      <GiftPeriodFacts performance={progress} />
      {pendingCompensation ? <>
        <Typography.Text strong>待结送心报酬 ¥{formatCentsAsYuan(pendingCompensation.memberCents)}</Typography.Text>
        <Typography.Text type="secondary">
          爱心款依据 ¥{formatCentsAsYuan(pendingCompensation.grossCents)} · 派抽 ¥{formatCentsAsYuan(pendingCompensation.dispatchFeeCents)} · 团抽 ¥{formatCentsAsYuan(pendingCompensation.clubFeeCents)}
        </Typography.Text>
      </> : <Typography.Text type="warning">
        待结送心报酬待核对 · {progress.compensationIssue === "out_of_range" ? "金额超出可核算范围" : "扣除抽成后为负金额"}
      </Typography.Text>}
      <Typography.Text type="secondary">
        全单已送 {progress.orderDeliveredGiftTimes} 次 · 剩余 {progress.orderRemainingGiftTimes} 次 · 建单预计到账 {actual(progress.estimatedReceivedHearts)}
      </Typography.Text>
      {segments.map(segment => <details key={segment.segmentIndex}>
        <summary>第 {segment.segmentIndex + 1} 段 · {segment.promotionalGiftTimes ? "促销赠送" : "报价"} {periodLabels[segment.quotePeriod]} · ¥{formatCentsAsYuan(segment.unitPriceCents)}/次</summary>
        {segment.pendingPromotionalGiftTimes ? <p>促销赠送有 {segment.pendingPromotionalGiftTimes} 次待核对付费履约记录。</p> : null}
        <p>已送 {segment.deliveredGiftTimes} 次 · 剩余 {segment.remainingGiftTimes} 次
          {segment.pendingCompensation && ` · 待结报酬 ¥${formatCentsAsYuan(segment.pendingCompensation.memberCents)}`}</p>
        <GiftPeriodFacts performance={segment} />
        <ul>{shares.filter(share => share.segmentIndex === segment.segmentIndex).map(share =>
          <li key={share.shareId}>份额 {share.shareId.slice(-6)} · 已送 {share.deliveredGiftTimes} 次 · 剩余 {share.remainingGiftTimes} 次
            {" · "}接单时观察 {actual(share.claimObservedReceivedHearts)}</li>,
        )}</ul>
      </details>)}
    </Flex>
  </Card>;
}

function ReportLines({ lines }: { lines: GiftDailyReport["lines"] }) {
  return <ul style={{ marginBlock: 4, paddingInlineStart: 20 }}>
    {lines.map((line, i) => <li key={i}>
      {line.quoteSegment ? `第 ${line.quoteSegment} 段` : `份额 ${line.shareId.slice(-6)}`} · {periodLabels[line.period]} · {line.giftTimes} 次 · 实际到账 {actual(line.receivedHearts)}
    </li>)}
  </ul>;
}

type OrderShares = GiftClaimOrder["segments"][number]["shares"];
type Accounts = NonNullable<OrderShares[number]["executionGameAccounts"]>;

function ReportForm({ draft, accounts, shares, saving, onSave, onCancel }: {
  draft: Draft;
  accounts: Accounts;
  shares: (OrderShares[number] & { segmentIndex: number })[];
  saving: boolean;
  onSave: (fields: Fields) => void;
  onCancel: () => void;
}) {
  const [form] = Form.useForm<Fields>();
  const report = draft.kind === "correction" ? draft.report : undefined;
  const firstAccount = report?.accountId ?? (accounts.length === 1 ? accounts[0].id : undefined);
  const accountId = Form.useWatch("accountId", form) ?? firstAccount;
  const shareOptions = shares.filter(share => share.executionGameAccounts?.some(account => account.id === accountId))
    .map(share => ({ value: share.id, label: `第 ${share.segmentIndex + 1} 段 · ${share.startDate} 起 · ${share.netGiftTimes} 次 · ${share.id.slice(-6)}` }));
  const firstShare = shareOptions[0]?.value;
  const initialValues = {
    accountId: firstAccount,
    businessDate: report?.businessDate,
    lines: report?.lines.map(line => ({ ...line, shareId: line.shareId ?? report.shareId }))
      ?? [{ shareId: firstShare, period: "unconfirmed" }],
  };
  return <Card title={draft.kind === "correction" ? `更正版本 ${report?.version}` : kindLabels[draft.kind]} size="small">
    <Form form={form} layout="vertical" initialValues={initialValues} onFinish={onSave} disabled={saving}
      onValuesChange={changes => {
        if (!changes.accountId) return;
        const first = shares.find(share => share.executionGameAccounts?.some(account => account.id === changes.accountId));
        form.setFieldValue("lines", [{ shareId: first?.id, period: "unconfirmed" }]);
      }}>
      <Form.Item name="accountId" label="送心号" rules={[{ required: true }]}>
        <Select disabled={!!report} style={{ width: "100%" }} placeholder="选择已关联的本人送心号" options={accounts.map(account => ({
          value: account.id, label: `${account.name} · #${account.localAccountId}`,
        }))} />
      </Form.Item>
      <Form.Item name="businessDate" label="业务日期" rules={[{ required: true }]}>
        <Input type="date" readOnly={!!report} />
      </Form.Item>
      <Form.List name="lines">
        {(fields, { add, remove }) => <Flex vertical gap="small">
          {fields.map((field, index) => <fieldset key={field.key} style={{ border: "1px solid #DBE2EB", borderRadius: 6, margin: 0, minWidth: 0, padding: "0 12px" }}>
            <legend>赠送明细 {index + 1}</legend>
            <Form.Item name={[field.name, "shareId"]} label="承接份额" rules={[{ required: true }]}>
              <Select options={shareOptions} disabled={!accountId} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name={[field.name, "period"]} label="实际时段">
              <Radio.Group options={periodOptions} style={{ display: "flex", flexWrap: "wrap" }} />
            </Form.Item>
            <Form.Item name={[field.name, "giftTimes"]} label="实际赠送次数" rules={[{ ...countRule, required: true }]}>
              <InputNumber min={0} max={Number.MAX_SAFE_INTEGER} precision={0} />
            </Form.Item>
            <Form.Item name={[field.name, "receivedHearts"]} label="实际到账颗数" rules={[countRule]}>
              <InputNumber min={0} max={Number.MAX_SAFE_INTEGER} precision={0} placeholder="留空表示未知" style={{ width: 150 }} />
            </Form.Item>
            {fields.length > 1 && <Button type="link" onClick={() => remove(field.name)}>移除此明细</Button>}
          </fieldset>)}
          <Button onClick={() => add({ shareId: firstShare, period: "unconfirmed" })} disabled={!accountId}>添加明细</Button>
        </Flex>}
      </Form.List>
      {draft.kind !== "daily" && <Form.Item name="reason" label="原因" rules={[{ required: true, whitespace: true }]}>
        <Input.TextArea maxLength={240} rows={2} />
      </Form.Item>}
      <Flex gap="small" wrap style={{ marginTop: 12 }}>
        <Button type="primary" htmlType="submit" loading={saving}>提交{kindLabels[draft.kind]}</Button>
        <Button onClick={onCancel} disabled={saving}>取消</Button>
      </Flex>
    </Form>
  </Card>;
}
