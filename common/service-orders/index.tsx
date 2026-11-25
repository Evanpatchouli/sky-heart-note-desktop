import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { authRequest, getAppToken, invalidateSession, RequestError } from "../web-auth/api";
import { dailyRunUnitPriceCents, companionshipUnitPriceCents, companionshipSlotMinutes, serviceBusinessLabels, type ServiceBusinessType, type ServiceOrderPage, type ServiceOrderScope, type ServiceOrderView } from "../src/club-service-order";
import { formatCentsAsYuan, parseYuanAsCents } from "../src/club-pricing";
import "./service-orders.css";

type App = "client" | "employee" | "admin";
type Props = { app: App; userId: string; token: string; business?: ServiceBusinessType; scope?: ServiceOrderScope; orderId?: string | null; onOpen: (id?: string) => void; create?: boolean };
type Payload = Record<string, string | number> & { requestId: string };
const labels: Record<string, string> = { pending_assignment: "待分配派单人", pending_dispatch: "待收款派发", published: "待承接", claimed: "履约中", completed: "已完成", stopped: "已终止" };
const money = (cents: number) => `${cents < 0 ? "−" : ""}¥${formatCentsAsYuan(Math.abs(cents))}`;

function readPending(key: string): Payload | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value && typeof value.requestId === "string" ? value as Payload : null;
  } catch { return null; }
}
function storePending(key: string, value: Payload | null) {
  try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* 当前页面仍可重试。 */ }
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "请求失败，请检查网络后重试"; }
function definiteFailure(error: unknown) { return error instanceof RequestError && error.status >= 400 && error.status < 500 && ![401, 403, 408, 429].includes(error.status); }
function beijingInput(value = Date.now()) { return new Date(value + 8 * 60 * 60 * 1000).toISOString().slice(0, 23); }
function beijingTime(value: string) { return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（北京时间）"; }
function beijingIso(value: string) { return new Date(`${value}+08:00`).toISOString(); }
function suffix(business: ServiceBusinessType) { return business === "daily_run" ? "" : `:${business}`; }

const submittedFieldLabels: Record<string, string> = {
  requestId: "提交编号", recipientGameAccount: "老板游戏号", serviceDescription: "服务约定",
  startDate: "首个服务日", units: "服务数量", customerUserId: "客户", dispatcherUserId: "派单人",
  unit: "服务序号", evidence: "交付凭据", reason: "原因", amountCents: "金额",
  occurredAt: "实际发生时间", scheduledStartAt: "预约开始时间", finishedAt: "实际完成时间", transferReference: "转账凭据",
};

function PendingSubmission({ data }: { data: Payload }) {
  return <section aria-label="上次提交的原始记录">
    <p role="status">上次提交结果待确认。重试将使用以下记录。</p>
    <dl>{Object.entries(data).map(([key, value]) => {
      if (!submittedFieldLabels[key]) return null;
      const formatted = key === "amountCents" ? money(Number(value))
        : ["occurredAt", "scheduledStartAt", "finishedAt"].includes(key) ? beijingTime(String(value)) : String(value);
      return <div key={key}><dt>{submittedFieldLabels[key]}</dt><dd>{formatted}</dd></div>;
    })}</dl>
  </section>;
}
async function serviceRequest<T>(app: App, token: string, path: string, init: RequestInit): Promise<T> {
  try { return await authRequest<T>(path, init); }
  catch (error) {
    if (error instanceof RequestError && error.status === 401 && getAppToken(app) === token) invalidateSession(app);
    throw error;
  }
}
function orderName(row: ServiceOrderView) { return row.recipientGameAccount || row.serviceDescription || row.id; }

export function ServiceOrders({ app, userId, token, business = "daily_run", scope, orderId, onOpen, create }: Props) {
  const [page, setPage] = useState<ServiceOrderPage>();
  const [detail, setDetail] = useState<ServiceOrderView>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const pageKey = `sky-service-page:${app}:${userId}:${scope ?? "all"}${suffix(business)}`;
  const [after, setAfter] = useState<string | undefined>(() => {
    try { return sessionStorage.getItem(pageKey) || undefined; } catch { return undefined; }
  });
  const path = `/${app}/club/service-orders`;
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    try { if (after) sessionStorage.setItem(pageKey, after); else sessionStorage.removeItem(pageKey); } catch { /* 页面仍可使用。 */ }
  }, [after, pageKey]);
  useEffect(() => {
    if (create) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ businessType: business, limit: "20" });
    if (scope) query.set("scope", scope);
    if (after) query.set("after", after);
    const detailQuery = new URLSearchParams({ businessType: business });
    if (scope === "finance") detailQuery.set("scope", "finance");
    const url = orderId ? `${path}/${encodeURIComponent(orderId)}?${detailQuery}` : `${path}?${query}`;
    serviceRequest<ServiceOrderView | ServiceOrderPage>(app, token, url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { if (orderId) setDetail(value as ServiceOrderView); else setPage(value as ServiceOrderPage); setError(""); } })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); });
    return () => controller.abort();
  }, [app, token, scope, orderId, after, revision, create, path, business]);
  const props = { app, userId, token, business, path, onSaved: (row: ServiceOrderView) => { refresh(); onOpen(row.id); } };
  const name = serviceBusinessLabels[business];
  return <section className="service-orders">
    {create ? <><h2>{name}下单</h2><CreateOrder {...props} /></> : orderId ? <>
      <button type="button" onClick={() => onOpen()}>返回{name}订单</button>
      <h2>{name}订单详情</h2>
      {error ? <p role="alert">{error} <button type="button" onClick={refresh}>重试</button></p> : !detail || detail.id !== orderId ? <p role="status">正在读取订单…</p> : <OrderDetail key={`${userId}:${detail.id}`} {...props} row={detail} refresh={refresh} onAssigned={() => { setNotice("分配已保存"); refresh(); onOpen(); }} />}
    </> : <>
      <div className="service-heading"><h2>{name}订单</h2><button type="button" onClick={refresh}>刷新</button></div>
      {notice ? <p role="status">{notice}</p> : null}
      {app === "employee" && scope === "dispatch" ? <CreateOrder {...props} /> : null}
      {error ? <p role="alert">{error} <button type="button" onClick={refresh}>重试</button></p> : !page ? <p role="status">正在读取订单…</p> : page.items.length ? <div className="service-list">{page.items.map(row => <button type="button" className="service-row" key={row.id} onClick={() => onOpen(row.id)}>
        <strong>{orderName(row)}</strong><span>{labels[row.status]} · {row.units} {business === "companionship" ? "时段" : "天"} · {row.scheduledStartAt ? beijingTime(row.scheduledStartAt) : `${row.startDate} 起`}</span><small>{row.id}</small>
      </button>)}</div> : <p>暂无{name}订单</p>}
      {after || page?.nextCursor ? <div className="service-actions"><button type="button" disabled={!after} onClick={() => setAfter(undefined)}>返回首页</button><button type="button" disabled={!page?.nextCursor} onClick={() => setAfter(page?.nextCursor ?? undefined)}>下一页</button></div> : null}
    </>}
  </section>;
}

type WriterProps = { app: App; userId: string; token: string; business: ServiceBusinessType; path: string; onSaved: (row: ServiceOrderView) => void };
function WriteForm({ app, storageKey, path, token, initial, fields, submitLabel, onSaved }: { app: App; storageKey: string; path: string; token: string; initial: Record<string, string>; fields: ReactNode; submitLabel: string; onSaved: (row: ServiceOrderView) => void }) {
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = new FormData(event.currentTarget);
    const body: Payload = pending ?? { requestId: crypto.randomUUID() };
    if (!pending) for (const [key, value] of form.entries()) {
      const text = String(value).trim();
      if (!text) continue;
      if (key === "units" || key === "unit") body[key] = Number(text);
      else if (key === "amountCents") {
        const amount = parseYuanAsCents(text);
        if (amount === null || amount <= 0) { setError("请输入大于零的金额，最多两位小数。"); return; }
        body[key] = amount;
      }
      else if (key === "occurredAt" || key === "finishedAt" || key === "scheduledStartAt") {
        try { body[key] = beijingIso(text); }
        catch { setError("请输入有效的北京时间。"); return; }
      }
      else if (key === "customerUserId" || key === "dispatcherUserId") body[key] = text.toUpperCase();
      else body[key] = text;
    }
    for (const [key, value] of Object.entries(initial)) if (!(key in body)) body[key] = value;
    const originalRoute = window.location.href;
    const current = () => alive.current && getAppToken(app) === token && window.location.href === originalRoute;
    setPending(body); storePending(storageKey, body); lock.current = true; setBusy(true); setError("");
    try {
      const row = await serviceRequest<ServiceOrderView>(app, token, path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      storePending(storageKey, null);
      if (current()) { setPending(null); onSaved(row); }
    } catch (reason) {
      if (definiteFailure(reason)) storePending(storageKey, null);
      if (current()) {
        if (definiteFailure(reason)) setPending(null);
        setError(`${errorMessage(reason)}${definiteFailure(reason) ? "" : "。请重试本次提交。"}`);
      }
    } finally { lock.current = false; if (current()) setBusy(false); }
  }
  return <form className="service-form" onSubmit={submit}>
    {pending && !busy ? <PendingSubmission data={pending} /> : null}
    <fieldset disabled={busy || !!pending} hidden={!!pending && !busy}>{fields}</fieldset>
    {error ? <p role="alert">{error}</p> : null}
    <button type="submit" disabled={busy}>{busy ? "提交中…" : pending ? "重试本次提交" : submitLabel}</button>
  </form>;
}

function CreateOrder(props: WriterProps) {
  const storageKey = `sky-service-create:${props.app}:${props.userId}${suffix(props.business)}`;
  const [units, setUnits] = useState(() => String(readPending(storageKey)?.units ?? ""));
  const [start, setStart] = useState("");
  const companion = props.business === "companionship";
  const price = companion ? companionshipUnitPriceCents : dailyRunUnitPriceCents;
  const days = Number(units);
  const validUnits = Number.isSafeInteger(days) && days >= 1 && days <= 3660;
  const total = validUnits ? money(days * price) : null;
  const startTime = start ? Date.parse(`${start}+08:00`) : NaN;
  const endDate = new Date(startTime + days * companionshipSlotMinutes * 60000);
  const end = companion && validUnits && Number.isFinite(startTime) && Number.isFinite(endDate.getTime())
    ? beijingTime(endDate.toISOString()) : null;
  const name = serviceBusinessLabels[props.business];
  return <details open={props.app === "client"} className="service-create"><summary>{props.app === "employee" ? `为客户代录${name}订单` : "填写服务约定"}</summary>
    <WriteForm app={props.app} storageKey={storageKey} path={props.path} token={props.token} initial={{ businessType: props.business }} onSaved={props.onSaved} submitLabel={`提交${name}订单`} fields={<>
      {props.app === "employee" ? <label>客户四位 ID<input name="customerUserId" required pattern="[A-Za-z0-9]{4}" maxLength={4} /></label> : null}
      <label>老板游戏号<input name="recipientGameAccount" required maxLength={120} /></label>
      <label>服务约定<textarea name="serviceDescription" required maxLength={500} /></label>
      {companion ? <label>预约开始时间（北京时间，整点或半点）<input name="scheduledStartAt" type="datetime-local" step={1800} required value={start} onChange={event => setStart(event.target.value)} /></label> : <label>首个服务日期<input name="startDate" type="date" required /></label>}
      <label>{companion ? "连续半小时时段数" : "连续服务天数"}<input name="units" type="number" min={1} max={3660} step={1} required value={units} onChange={event => setUnits(event.target.value)} /></label>
      <p>每验收{companion ? "时段" : "日"} {money(price)}{total ? ` · 服务费合计 ${total}` : ""}{end ? ` · 预约结束 ${end}` : ""}</p>
      {props.app === "client" ? <label>指定派单人四位 ID（选填）<input name="dispatcherUserId" pattern="[A-Za-z0-9]{4}" maxLength={4} /></label> : null}
    </>} />
  </details>;
}

function AppointmentTimeField({ row, opening }: { row: ServiceOrderView; opening?: boolean }) {
  if (!row.scheduledStartAt || !row.scheduledEndAt) return null;
  const start = Date.parse(row.scheduledStartAt);
  const end = Date.parse(row.scheduledEndAt);
  const earliest = opening ? start : start + companionshipSlotMinutes * 60_000;
  const latest = opening ? end - 1 : end;
  const now = Date.now();
  return <label>{opening ? "实际开场时间（北京时间）" : "实际完成时间（北京时间）"}
    <input name={opening ? "occurredAt" : "finishedAt"} type="datetime-local" step="0.001" required
      min={beijingInput(earliest)} max={beijingInput(latest)}
      defaultValue={now >= earliest && now <= latest ? beijingInput(now) : undefined} />
  </label>;
}

function OrderDetail(props: WriterProps & { row: ServiceOrderView; refresh: () => void; onAssigned: () => void }) {
  const { row } = props;
  const [action, setAction] = useState("");
  const companion = row.businessType === "companionship";
  const unit = companion ? "时段" : "日";
  const names: Record<string, string> = { assign: "分配派单人", publish: "登记首款并派发", claim: "承接整单", start: "登记实际开场", deliveries: companion ? "提交时段凭据" : "提交每日凭据", accept: companion ? "确认时段完成" : "确认当日完成", stop: "终止服务", refund: "登记实际退款", close: "确认结单入账" };
  const inputs: Record<string, ReactNode> = {
    assign: <label>派单人四位 ID<input name="dispatcherUserId" pattern="[A-Za-z0-9]{4}" maxLength={4} required /></label>,
    publish: <><label>实际收到首款（元）<input name="amountCents" type="number" min="0.01" step="0.01" defaultValue={row.quote ? formatCentsAsYuan(row.quote.totalCents) : undefined} required /></label><label>实际收款时间（北京时间）<input name="occurredAt" type="datetime-local" step="0.001" defaultValue={beijingInput()} required /></label></>,
    claim: <p>确认承接整个{serviceBusinessLabels[row.businessType]}订单。</p>,
    start: <AppointmentTimeField row={row} opening />,
    deliveries: <>
      <label>服务{unit}序号（1 至 {row.units}）<input name="unit" type="number" min={1} max={row.units} step={1} required /></label>
      <label>交付凭据<textarea name="evidence" required maxLength={500} placeholder="填写任务记录或截图引用" /></label>
      {companion ? <AppointmentTimeField row={row} /> : null}
    </>,
    accept: <label>确认服务{unit}序号<input name="unit" type="number" min={1} max={row.units} step={1} required /></label>,
    stop: <label>终止原因<textarea name="reason" required maxLength={240} /></label>,
    refund: <>
      <label>实际退款金额（元）<input name="amountCents" type="number" min="0.01" step="0.01" required /></label>
      <label>实际退款时间（北京时间）<input name="occurredAt" type="datetime-local" step="0.001" defaultValue={beijingInput()} required /></label>
      <label>线下退款凭据（选填）<input name="transferReference" maxLength={240} placeholder="例如退款渠道和流水号" /></label>
    </>,
    close: <p>确认本单现金已核对，结单后按已验收服务入账。</p>,
  };
  const pendingActions = Object.keys(names).filter(item => readPending(`sky-service-action:${props.app}:${props.userId}:${row.id}:${item}${suffix(props.business)}`));
  const availableActions = [...new Set([...row.actions, ...pendingActions])];
  const submitLabel = action === "accept" ? "保存验收结果" : action === "close" ? "确认入账" : `确认${names[action]}`;
  return <div className="service-detail"><div className="service-heading"><strong>{orderName(row)} · {labels[row.status]}</strong><button type="button" onClick={props.refresh}>刷新详情</button></div>
    <p>订单 {row.id}</p><p>{row.serviceDescription}</p>
    <p>{companion ? row.scheduledStartAt && row.scheduledEndAt ? `预约 ${beijingTime(row.scheduledStartAt)} 至 ${beijingTime(row.scheduledEndAt)} · ${row.units} 时段` : `预约时间待核对 · ${row.units} 时段` : `${row.startDate} 起 · ${row.units} 天`}</p>
    {row.startedAt ? <p>实际开场 {beijingTime(row.startedAt)}</p> : null}
    <p>{row.customerUserId ? `客户 ${row.customerUserId} · ` : ""}派单人 {row.dispatcherUserId ?? "待分配"} · 执行人 {row.executorUserId ?? "待承接"}</p>
    {row.quote ? <p>约定服务费 {money(row.quote.totalCents)} · {money(row.quote.unitPriceCents)}/{unit}</p> : null}
    {row.receipt ? <p>已收首款 {money(row.receipt.amountCents)} · {beijingTime(row.receipt.occurredAt)}</p> : null}
    {row.accounting ? <Accounting accounting={row.accounting} unit={unit} /> : null}
    <h3>{companion ? "时段交付" : "每日交付"}</h3>{row.deliveries.length ? <ul>{row.deliveries.map(delivery => <li key={delivery.unit}>第 {delivery.unit} {unit} · {delivery.businessDate} · {delivery.evidence}{delivery.finishedAt ? ` · 完成 ${beijingTime(delivery.finishedAt)}` : ""} · {delivery.acceptedAt ? "已确认" : "待客户确认"}</li>)}</ul> : <p>暂无交付</p>}
    {row.stop ? <p>终止原因：{row.stop.reason} · {beijingTime(row.stop.stoppedAt)}</p> : null}
    <div className="service-actions">{availableActions.map(item => <button type="button" key={item} onClick={() => setAction(item)}>{pendingActions.includes(item) ? `核对${names[item]}` : names[item]}</button>)}</div>
    {action && availableActions.includes(action) ? <div>
      <h3>{names[action]}</h3>
      <WriteForm app={props.app} key={action}
        storageKey={`sky-service-action:${props.app}:${props.userId}:${row.id}:${action}${suffix(props.business)}`}
        path={`${props.path}/${encodeURIComponent(row.id)}/${action}`}
        token={props.token} initial={{}} fields={inputs[action]} submitLabel={submitLabel}
        onSaved={updated => {
          setAction("");
          if (action === "assign") props.onAssigned();
          else props.onSaved(updated);
        }} />
    </div> : null}
  </div>;
}

function Accounting({ accounting, unit }: { accounting: NonNullable<ServiceOrderView["accounting"]>; unit: string }) {
  const status: Record<typeof accounting.status, string> = {
    in_progress: "履约中", refund_pending: "退款待完成", ready_to_close: "待结单", closed: "已结单入账", void: "未收款终止",
  };
  const items: [string, number | undefined][] = [
    ["已收首款", accounting.receivedCents], ["应退", accounting.refundDueCents],
    ["实际已退", accounting.refundedCents], ["待退", accounting.refundRemainingCents],
    ["客户净实收", accounting.netReceivedCents], ["派抽", accounting.dispatchFeeCents],
    ["执行报酬", accounting.rewardCents], ["团费", accounting.clubFeeCents], ["分配合计", accounting.allocatedCents],
  ];
  return <section className="service-accounting" aria-label="服务财务核对">
    <h3>服务财务 · {status[accounting.status]}</h3>
    <p>已验收 {accounting.acceptedUnits} {unit} · {accounting.status === "closed" ? "已入账" : `尚未入账；报酬分配按当前已验收${unit}核算`}</p>
    <dl>{items.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value!)}</dd></div>)}</dl>
    {accounting.refunds?.map((refund, index) => <p key={index}>实际退款 {money(refund.amountCents)} · {beijingTime(refund.occurredAt)}{refund.transferReference ? ` · ${refund.transferReference}` : ""}</p>)}
    {accounting.closedAt ? <p>结单时间 {beijingTime(accounting.closedAt)}</p> : null}
  </section>;
}
