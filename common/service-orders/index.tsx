import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { authRequest, getAppToken, invalidateSession, RequestError } from "../web-auth/api";
import { dailyRunUnitPriceCents, type ServiceOrderPage, type ServiceOrderScope, type ServiceOrderView } from "../src/club-service-order";
import { formatCentsAsYuan, parseYuanAsCents } from "../src/club-pricing";
import "./service-orders.css";

type App = "client" | "employee" | "admin";
type Props = { app: App; userId: string; token: string; scope?: ServiceOrderScope; orderId?: string | null; onOpen: (id?: string) => void; create?: boolean };
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
function localNow() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 23); }

const submittedFieldLabels: Record<string, string> = {
  requestId: "提交编号", recipientGameAccount: "老板游戏号", serviceDescription: "服务约定",
  startDate: "首个服务日", units: "服务数量", customerUserId: "客户", dispatcherUserId: "派单人",
  unit: "服务序号", evidence: "交付凭据", reason: "原因", amountCents: "金额",
  occurredAt: "实际发生时间", transferReference: "转账凭据",
};

function PendingSubmission({ data }: { data: Payload }) {
  return <section aria-label="上次提交的原始记录">
    <p role="status">上次提交结果待确认。重试将使用以下记录。</p>
    <dl>{Object.entries(data).map(([key, value]) => {
      if (!submittedFieldLabels[key]) return null;
      const formatted = key === "amountCents" ? money(Number(value))
        : key === "occurredAt" ? new Date(value).toLocaleString("zh-CN") : String(value);
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

export function ServiceOrders({ app, userId, token, scope, orderId, onOpen, create }: Props) {
  const [page, setPage] = useState<ServiceOrderPage>();
  const [detail, setDetail] = useState<ServiceOrderView>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const pageKey = `sky-service-page:${app}:${userId}:${scope ?? "all"}`;
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
    const query = new URLSearchParams({ businessType: "daily_run", limit: "20" });
    if (scope) query.set("scope", scope);
    if (after) query.set("after", after);
    const detailQuery = new URLSearchParams({ businessType: "daily_run" });
    if (scope === "finance") detailQuery.set("scope", "finance");
    const url = orderId ? `${path}/${encodeURIComponent(orderId)}?${detailQuery}` : `${path}?${query}`;
    serviceRequest<ServiceOrderView | ServiceOrderPage>(app, token, url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { if (orderId) setDetail(value as ServiceOrderView); else setPage(value as ServiceOrderPage); setError(""); } })
      .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); });
    return () => controller.abort();
  }, [app, token, scope, orderId, after, revision, create, path]);
  const props = { app, userId, token, path, onSaved: (row: ServiceOrderView) => { refresh(); onOpen(row.id); } };
  return <section className="service-orders">
    {create ? <><h2>代跑下单</h2><CreateOrder {...props} /></> : orderId ? <>
      <button type="button" onClick={() => onOpen()}>返回代跑订单</button>
      <h2>代跑订单详情</h2>
      {error ? <p role="alert">{error} <button type="button" onClick={refresh}>重试</button></p> : !detail || detail.id !== orderId ? <p role="status">正在读取订单…</p> : <OrderDetail key={`${userId}:${detail.id}`} {...props} row={detail} refresh={refresh} onAssigned={() => { setNotice("分配已保存"); refresh(); onOpen(); }} />}
    </> : <>
      <div className="service-heading"><h2>代跑订单</h2><button type="button" onClick={refresh}>刷新</button></div>
      {notice ? <p role="status">{notice}</p> : null}
      {app === "employee" && scope === "dispatch" ? <CreateOrder {...props} /> : null}
      {error ? <p role="alert">{error} <button type="button" onClick={refresh}>重试</button></p> : !page ? <p role="status">正在读取订单…</p> : page.items.length ? <div className="service-list">{page.items.map(row => <button type="button" className="service-row" key={row.id} onClick={() => onOpen(row.id)}>
        <strong>{orderName(row)}</strong><span>{labels[row.status]} · {row.units} 天 · {row.startDate} 起</span><small>{row.id}</small>
      </button>)}</div> : <p>暂无代跑订单</p>}
      {after || page?.nextCursor ? <div className="service-actions"><button type="button" disabled={!after} onClick={() => setAfter(undefined)}>返回首页</button><button type="button" disabled={!page?.nextCursor} onClick={() => setAfter(page?.nextCursor ?? undefined)}>下一页</button></div> : null}
    </>}
  </section>;
}

type WriterProps = { app: App; userId: string; token: string; path: string; onSaved: (row: ServiceOrderView) => void };
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
      else if (key === "occurredAt") body[key] = new Date(text).toISOString();
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
  const storageKey = `sky-service-create:${props.app}:${props.userId}`;
  const [units, setUnits] = useState(() => String(readPending(storageKey)?.units ?? ""));
  const days = Number(units);
  const total = Number.isSafeInteger(days) && days > 0 && Number.isSafeInteger(days * dailyRunUnitPriceCents)
    ? money(days * dailyRunUnitPriceCents) : null;
  return <details open={props.app === "client"} className="service-create"><summary>{props.app === "employee" ? "为客户代录代跑订单" : "填写服务约定"}</summary>
    <WriteForm app={props.app} storageKey={storageKey} path={props.path} token={props.token} initial={{ businessType: "daily_run" }} onSaved={props.onSaved} submitLabel="提交代跑订单" fields={<>
      {props.app === "employee" ? <label>客户四位 ID<input name="customerUserId" required pattern="[A-Za-z0-9]{4}" maxLength={4} /></label> : null}
      <label>老板游戏号<input name="recipientGameAccount" required maxLength={120} /></label>
      <label>服务约定<textarea name="serviceDescription" required maxLength={500} /></label>
      <label>首个服务日期<input name="startDate" type="date" required /></label>
      <label>连续服务天数<input name="units" type="number" min={1} max={3660} step={1} required value={units} onChange={event => setUnits(event.target.value)} /></label>
      <p>每验收日 {money(dailyRunUnitPriceCents)}{total ? ` · 服务费合计 ${total}` : ""}</p>
      {props.app === "client" ? <label>指定派单人四位 ID（选填）<input name="dispatcherUserId" pattern="[A-Za-z0-9]{4}" maxLength={4} /></label> : null}
    </>} />
  </details>;
}

function OrderDetail(props: WriterProps & { row: ServiceOrderView; refresh: () => void; onAssigned: () => void }) {
  const { row } = props;
  const [action, setAction] = useState("");
  const names: Record<string, string> = { assign: "分配派单人", publish: "登记首款并派发", claim: "承接整单", deliveries: "提交每日凭据", accept: "确认当日完成", stop: "终止服务", refund: "登记实际退款", close: "确认结单入账" };
  const inputs: Record<string, ReactNode> = {
    assign: <label>派单人四位 ID<input name="dispatcherUserId" pattern="[A-Za-z0-9]{4}" maxLength={4} required /></label>,
    publish: <><label>实际收到首款（元）<input name="amountCents" type="number" min="0.01" step="0.01" defaultValue={row.quote ? formatCentsAsYuan(row.quote.totalCents) : undefined} required /></label><label>实际收款时间<input name="occurredAt" type="datetime-local" step="0.001" defaultValue={localNow()} required /></label></>,
    claim: <p>确认承接整个代跑订单。</p>,
    deliveries: <><label>服务日序号（1 至 {row.units}）<input name="unit" type="number" min={1} max={row.units} step={1} required /></label><label>交付凭据<textarea name="evidence" required maxLength={500} placeholder="填写路线清单或截图引用" /></label></>,
    accept: <label>确认服务日序号<input name="unit" type="number" min={1} max={row.units} step={1} required /></label>,
    stop: <label>终止原因<textarea name="reason" required maxLength={240} /></label>,
    refund: <>
      <label>实际退款金额（元）<input name="amountCents" type="number" min="0.01" step="0.01" required /></label>
      <label>实际退款时间<input name="occurredAt" type="datetime-local" step="0.001" defaultValue={localNow()} required /></label>
      <label>线下退款凭据（选填）<input name="transferReference" maxLength={240} placeholder="例如退款渠道和流水号" /></label>
    </>,
    close: <p>确认本单现金已核对，结单后按已验收服务入账。</p>,
  };
  const pendingActions = Object.keys(names).filter(item => readPending(`sky-service-action:${props.app}:${props.userId}:${row.id}:${item}`));
  const availableActions = [...new Set([...row.actions, ...pendingActions])];
  const submitLabel = action === "accept" ? "保存验收结果" : action === "close" ? "确认入账" : `确认${names[action]}`;
  return <div className="service-detail"><div className="service-heading"><strong>{orderName(row)} · {labels[row.status]}</strong><button type="button" onClick={props.refresh}>刷新详情</button></div>
    <p>订单 {row.id}</p><p>{row.serviceDescription}</p><p>{row.startDate} 起 · {row.units} 天</p>
    <p>{row.customerUserId ? `客户 ${row.customerUserId} · ` : ""}派单人 {row.dispatcherUserId ?? "待分配"} · 执行人 {row.executorUserId ?? "待承接"}</p>
    {row.quote ? <p>约定服务费 {money(row.quote.totalCents)} · {money(row.quote.unitPriceCents)}/天</p> : null}
    {row.receipt ? <p>已收首款 {money(row.receipt.amountCents)} · {new Date(row.receipt.occurredAt).toLocaleString("zh-CN")}</p> : null}
    {row.accounting ? <Accounting accounting={row.accounting} /> : null}
    <h3>每日交付</h3>{row.deliveries.length ? <ul>{row.deliveries.map(delivery => <li key={delivery.unit}>第 {delivery.unit} 日 · {delivery.businessDate} · {delivery.evidence} · {delivery.acceptedAt ? "已确认" : "待客户确认"}</li>)}</ul> : <p>暂无交付</p>}
    {row.stop ? <p>终止原因：{row.stop.reason} · {new Date(row.stop.stoppedAt).toLocaleString("zh-CN")}</p> : null}
    <div className="service-actions">{availableActions.map(item => <button type="button" key={item} onClick={() => setAction(item)}>{pendingActions.includes(item) ? `核对${names[item]}` : names[item]}</button>)}</div>
    {action && availableActions.includes(action) ? <div>
      <h3>{names[action]}</h3>
      <WriteForm app={props.app} key={action}
        storageKey={`sky-service-action:${props.app}:${props.userId}:${row.id}:${action}`}
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

function Accounting({ accounting }: { accounting: NonNullable<ServiceOrderView["accounting"]> }) {
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
    <p>已验收 {accounting.acceptedUnits} 日 · {accounting.status === "closed" ? "已入账" : "尚未入账；报酬分配按当前已验收日核算"}</p>
    <dl>{items.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value!)}</dd></div>)}</dl>
    {accounting.refunds?.map((refund, index) => <p key={index}>实际退款 {money(refund.amountCents)} · {new Date(refund.occurredAt).toLocaleString("zh-CN")}{refund.transferReference ? ` · ${refund.transferReference}` : ""}</p>)}
    {accounting.closedAt ? <p>结单时间 {new Date(accounting.closedAt).toLocaleString("zh-CN")}</p> : null}
  </section>;
}
