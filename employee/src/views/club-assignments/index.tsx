import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AppstoreOutlined, ArrowLeftOutlined, BarsOutlined, CalendarOutlined, FilterOutlined, OrderedListOutlined, SearchOutlined, TableOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Flex, Spin } from "antd";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import Header from "#/components/Header";
import { employeeRequest } from "#/service/request";
import { useWorkspaceScroll } from "../workspace-scroll";
import AssignmentDetail from "./assignment-detail";
import { AssignmentDates, businessToday } from "./date-views";
import PersonalScheduleDialog from "./personal-schedule";
import { AssignmentKanban, AssignmentList, AssignmentTable, type TableSort } from "./record-views";
import { type AssignmentRow, type PersonalSchedule, type ScheduleDates, assignmentStatus, assignmentStatuses, isGiftAssignment, requestMessage } from "./types";
import "./assignments.css";

type Club = { name: string };
type OrderPage = { items: AssignmentRow[]; nextCursor: string | null };

const views = [
  { id: "timeline", label: "时间轴", icon: OrderedListOutlined },
  { id: "list", label: "列表", icon: BarsOutlined },
  { id: "calendar", label: "日历", icon: CalendarOutlined },
  { id: "table", label: "表格", icon: TableOutlined },
  { id: "kanban", label: "看板", icon: AppstoreOutlined },
] as const;
type View = (typeof views)[number]["id"];
type Preferences = { search: string; status: string; date: string; sort: TableSort };

function defaultPreferences(key: string): Preferences {
  const fallback: Preferences = { search: "", status: "", date: businessToday(), sort: { key: "name", descending: false } };
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as Partial<Preferences> | null;
    if (!saved) return fallback;
    const date = saved.date && /^\d{4}-\d{2}-\d{2}$/.test(saved.date) && Number.isFinite(Date.parse(saved.date)) ? saved.date : fallback.date;
    const status = saved.status && Object.hasOwn(assignmentStatuses, saved.status) ? saved.status : "";
    const sort = saved.sort && ["name", "hearts", "observed", "endDate"].includes(saved.sort.key) && typeof saved.sort.descending === "boolean" ? saved.sort : fallback.sort;
    return { date, status, sort, search: typeof saved.search === "string" ? saved.search : "" };
  } catch { return fallback; }
}

function preferredView(key: string) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export default function ClubAssignments() {
  const { id: userId } = useAuthSession();
  return <><Header /><AssignmentsPage key={userId} userId={userId} /></>;
}

function AssignmentsPage({ userId }: { userId: string }) {
  const [club, setClub] = useState<Club | null>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    employeeRequest<Club | null>("club", "GET", undefined, controller.signal)
      .then(items => { if (!controller.signal.aborted) setClub(items); })
      .catch(err => { if (!controller.signal.aborted) setError(requestMessage(err)); });
    return () => controller.abort();
  }, [attempt]);

  if (!error && club) return <ClubOrders userId={userId} clubName={club.name} />;
  return <main className="club-claim-page assignment-page">
    <Flex className="assignment-heading" align="center" justify="space-between" gap="small" wrap><h1>我的承接</h1></Flex>
    {error ? <Alert type="error" showIcon title={error}
      action={<Button onClick={() => { setError(""); setAttempt(value => value + 1); }}>重试</Button>} />
      : club === undefined ? <Spin aria-label="加载俱乐部" />
        : <Empty description="当前账号尚无有效团员身份" />}
    <Link className="assignment-workspace-link" to="/workspace">个人工作台</Link>
  </main>;
}

function ClubOrders({ userId, clubName }: { userId: string; clubName: string }) {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const requestedId = params.get("orderId");
  const selectedId = requestedId && /^[a-f0-9]{24}$/i.test(requestedId) ? requestedId : null;
  const route = "club/orders";
  const viewKey = `sky-heart.employee.assignment-view.v1:${userId}`;
  const preferencesKey = `sky-heart.employee.assignment-preferences.v1:${userId}`;
  const requestedView = params.get("view") ?? preferredView(viewKey);
  const view = views.find(item => item.id === requestedView)?.id ?? "timeline";
  const [preferences, setPreferences] = useState(() => defaultPreferences(preferencesKey));
  const [orders, setOrders] = useState<AssignmentRow[]>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [detailReady, setDetailReady] = useState<string>();
  const [edit, setEdit] = useState<{ order: AssignmentRow; proposed: ScheduleDates }>();
  const [feedback, setFeedback] = useState("");
  const openedFrom = useRef<string | null>(null);
  const back = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const viewContext = JSON.stringify([userId, "assignments", view, preferences.search, preferences.status]);
  const scroll = useWorkspaceScroll(selectedId ? `${userId}:assignments:detail:${selectedId}` : viewContext,
    selectedId ? detailReady === selectedId : !!orders);
  const horizontalContext = `horizontal:${viewContext}`;

  useEffect(() => {
    try { sessionStorage.setItem(viewKey, view); } catch { /* Optional UI preferences. */ }
  }, [view, viewKey]);

  useEffect(() => {
    try { sessionStorage.setItem(preferencesKey, JSON.stringify(preferences)); } catch { /* Optional UI preferences. */ }
  }, [preferences, preferencesKey]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      const rows: AssignmentRow[] = [];
      const query = new URLSearchParams({ responsibility: "executor", limit: "100" });
      while (!controller.signal.aborted) {
        const page = await employeeRequest<OrderPage>(`${route}?${query}`, "GET", undefined, controller.signal);
        rows.push(...page.items);
        if (!page.nextCursor) break;
        query.set("after", page.nextCursor);
      }
      if (!controller.signal.aborted) { setOrders(rows); setError(""); }
    }
    void load().catch(err => {
      if (controller.signal.aborted) return;
      if (err instanceof RequestError && [403, 404].includes(err.status)) setOrders(undefined);
      setError(requestMessage(err));
    });
    return () => controller.abort();
  }, [route, attempt]);

  useLayoutEffect(() => {
    if (selectedId) {
      back.current?.focus({ preventScroll: true });
      return;
    }
    if (orders && openedFrom.current) {
      scroll.ref.current?.querySelector<HTMLElement>(`[data-assignment="${openedFrom.current}"]`)?.focus({ preventScroll: true });
      openedFrom.current = null;
    }
  }, [selectedId, orders, scroll.ref]);

  function reload() { setError(""); setAttempt(value => value + 1); }

  function setView(nextView: View) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete("clubId");
      next.set("view", nextView);
      return next;
    }, { state });
  }

  function handleTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = views.findIndex(tab => tab.id === view);
    const positions: Record<string, number> = { ArrowLeft: (index + views.length - 1) % views.length,
      ArrowRight: (index + 1) % views.length, Home: 0, End: views.length - 1 };
    const next = views[positions[event.key]];
    if (!next) return;
    event.preventDefault();
    event.currentTarget.querySelector<HTMLElement>(`#assignment-tab-${next.id}`)?.focus({ preventScroll: true });
    setView(next.id);
  }

  function openOrder(orderId: string) {
    openedFrom.current = orderId;
    setDetailReady(undefined);
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete("clubId");
      next.set("view", view);
      next.set("orderId", orderId);
      return next;
    }, { state: { fromAssignmentList: true } });
  }

  function closeOrder() {
    openedFrom.current = selectedId;
    if (state?.fromAssignmentList) { void navigate(-1); return; }
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete("orderId");
      return next;
    }, { replace: true });
  }

  function saveSchedule(id: string, schedule: PersonalSchedule) {
    setOrders(previous => previous?.map(order => order.id === id ? { ...order, personalSchedule: schedule } : order));
    if (schedule.startDate) setPreferences(previous => ({ ...previous, date: schedule.startDate! }));
  }

  function onDate(date: string) { setPreferences(previous => ({ ...previous, date })); }

  const query = preferences.search.trim().toLocaleLowerCase();
  const { status } = preferences;
  const filtered = useMemo(() => orders?.filter(order => (!status || assignmentStatus(order) === status)
    && (!query || order.recipientGameAccount.toLocaleLowerCase().includes(query) || order.id.includes(query))) ?? [],
  [orders, status, query]);
  const counts = orders?.reduce((summary, order) => {
    if (!isGiftAssignment(order)) return summary;
    const progress = order.giftProgress;
    summary.accepted += BigInt(progress.acceptedGiftTimes);
    summary.delivered += BigInt(progress.deliveredGiftTimes);
    summary.hearts += BigInt(progress.knownReceivedHearts);
    summary.unknown += progress.unknownReceivedLines;
    summary.giftOrders++;
    return summary;
  }, { accepted: 0n, delivered: 0n, hearts: 0n, unknown: 0, giftOrders: 0 });

  return <main className="club-claim-page assignment-page" {...scroll}>
    {selectedId ? <div className="assignment-detail-page">
      <Button ref={back} className="assignment-back" icon={<ArrowLeftOutlined />} onClick={closeOrder}>返回我的承接</Button>
      <AssignmentDetail key={selectedId} route={`${route}/${encodeURIComponent(selectedId)}`} onSaved={reload}
        onScheduleSaved={schedule => saveSchedule(selectedId, schedule)} onReady={() => setDetailReady(selectedId)} />
    </div> : <>
      <Flex className="assignment-heading" align="center" justify="space-between" gap="small" wrap>
        <h1>我的承接</h1>
        <span>{clubName}</span>
      </Flex>
      <Flex className="assignment-summary" align="center" justify="space-between" gap="small" wrap>
        {counts && orders ? <p>{orders.length} 笔承接{counts.giftOrders > 0 && <>
          {" · "}本人已送 <strong>{String(counts.delivered)} / {String(counts.accepted)}</strong> 次
          {" · "}{counts.unknown ? "已知到账" : "实际到账"} {String(counts.hearts)} 颗
          {counts.unknown > 0 && ` · ${counts.unknown} 条到账未知`}
        </>}</p> : <span />}
        <Link className="assignment-workspace-link" to="/workspace">个人工作台</Link>
      </Flex>
      {error ? <Alert type="error" showIcon title={error} action={<Button onClick={reload}>重试</Button>} /> : null}
      {feedback ? <p className="assignment-feedback" role="status">{feedback}</p> : null}
      <section className="assignment-surface" aria-label="我的承接视图">
        <div role="tablist" aria-label="承接视图" className="assignment-tabs" onKeyDown={handleTabKey}>
          {views.map(({ id, label, icon: Icon }) => <button type="button" key={id} role="tab" id={`assignment-tab-${id}`}
            aria-controls="assignment-view" aria-selected={view === id} tabIndex={view === id ? 0 : -1} onClick={() => setView(id)}>
            <Icon aria-hidden="true" /><span>{label}</span>
          </button>)}
        </div>
        <div className="assignment-controls">
          <label><SearchOutlined /><input ref={search} type="search" maxLength={120} placeholder="搜索订单名称或单号" aria-label="搜索承接订单"
            value={preferences.search} onChange={event => setPreferences(previous => ({ ...previous, search: event.target.value }))} /></label>
          <label><FilterOutlined /><select aria-label="筛选承接状态" value={preferences.status}
            onChange={event => setPreferences(previous => ({ ...previous, status: event.target.value }))}>
            <option value="">全部状态</option>
            {Object.entries(assignmentStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select></label>
          {orders ? <span role="status">{filtered.length} 笔记录</span> : null}
          <button type="button" className="assignment-refresh" onClick={reload}>刷新</button>
        </div>
        <div id="assignment-view" role="tabpanel" aria-labelledby={`assignment-tab-${view}`}>
          {!orders ? !error ? <p className="assignment-date-empty" role="status">正在读取承接订单…</p> : null
            : !orders.length ? <Empty description="暂无承接订单" className="assignment-empty"><Link to="/claim-board">进入接单区</Link></Empty>
              : !filtered.length ? <Empty description="没有符合条件的承接记录" className="assignment-empty">
                <Button onClick={() => { setPreferences(previous => ({ ...previous, search: "", status: "" })); search.current?.focus(); }}>清除筛选</Button>
              </Empty>
                : view === "list" ? <AssignmentList orders={filtered} onOpen={openOrder} />
                  : view === "table" ? <AssignmentTable orders={filtered} onOpen={openOrder} sort={preferences.sort} scrollKey={horizontalContext}
                    onSort={sort => setPreferences(previous => ({ ...previous, sort }))} />
                    : view === "kanban" ? <AssignmentKanban orders={filtered} onOpen={openOrder} scrollKey={horizontalContext} />
                      : <AssignmentDates mode={view} orders={filtered} date={preferences.date} scrollKey={horizontalContext} onDate={onDate} onOpen={openOrder}
                        onEdit={(order, proposed) => { setFeedback(""); setEdit({ order, proposed }); }} />}
        </div>
      </section>
    </>}
    {edit ? <PersonalScheduleDialog route={`${route}/${edit.order.id}`} orderName={edit.order.recipientGameAccount}
      schedule={edit.order.personalSchedule} proposed={edit.proposed} onClose={() => setEdit(undefined)}
      onReload={() => { setEdit(undefined); reload(); }} onSaved={schedule => {
        saveSchedule(edit.order.id, schedule);
        setEdit(undefined);
        setFeedback("本人排期已保存");
      }} /> : null}
  </main>;
}
