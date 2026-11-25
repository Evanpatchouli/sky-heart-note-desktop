import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Flex, Form, InputNumber, Modal, Spin, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { getAppToken, RequestError, useAuthSession, useSessionActions } from "@sky-club/common/web-auth";
import Header from "#/components/Header";
import { dispatchNoticeReadEvent, dispatchNoticeRoute } from "#/service/dispatch-notices";
import { employeeRequest } from "#/service/request";
import useEmitter from "#/utils/useEmitter";
import { useWorkspaceScroll } from "../workspace-scroll";
import { rememberedMemberPath } from "../mobile-navigation";
import { clearPendingClaim, readPendingClaims, savePendingClaim, type ClaimSelection, type PendingEntry } from "./pending-claims";

const sources = { direct_dispatch: "直接派单", client_order: "客户端下单" };
type Club = { name: string };
type Claimable = {
  id: string;
  source: keyof typeof sources;
  dispatcherUserId: string;
  publishedAt: string;
  requestedHearts: number;
  fulfillmentHearts?: number;
  publicRemainingHearts: number;
  directedPendingHearts: number;
  myClaimedHearts: number;
  recipientGameAccount?: string;
  claimBlockReason?: string;
  stoppedAt?: string;
};
type Page = { items: Claimable[]; nextCursor: string | null };
type ClaimReceipt = ClaimSelection & { id: string; userId: string };
type Detail = { attempt: number; order: Claimable } | { attempt: number; error: string; unavailable: boolean };
const noticeMessages = {
  gift_located: "这笔订单在按次接单区查看",
  missing: "这条派单通知不存在或当前无法查看",
  unavailable: "当前无法查看这条通知对应的派单",
  awaiting_times_allocation: "这笔订单已正式派发，派单人还未配置可承接的计价段",
  withdrawn: "这笔派单已撤回",
  directed_elsewhere: "这笔派单没有指定给你的份额",
};
type LocatedNotice = { status: "located"; clubId: string; order: Claimable };
type NoticeTarget = LocatedNotice | { status: "gift_located"; clubId: string; orderId: string } |
  { status: Exclude<keyof typeof noticeMessages, "gift_located">; clubId?: string };
const boardFilters = { all: "全部", public: "公开可抢", directed: "指定给我" } as const;
type BoardFilter = keyof typeof boardFilters;

function readQueue(userId: string) {
  try { return new URLSearchParams(sessionStorage.getItem(queueKey(userId)) ?? ""); }
  catch { return new URLSearchParams(); }
}

const queueKey = (userId: string) => `sky-heart.employee.claim-queue.v1:${userId}`;

function assignmentHref(userId: string, orderId: string) {
  const path = "/club/assignments";
  const search = new URLSearchParams(rememberedMemberPath(userId, path).split("?")[1]);
  search.delete("clubId");
  search.set("orderId", orderId);
  return `${path}?${search}`;
}

function message(err: unknown) {
  return err instanceof RequestError ? err.message : "请求未确认，请检查网络后重试";
}

export default function ClaimBoard() {
  const [params] = useSearchParams();
  const { token } = useAuthSession();
  const noticeId = params.get("noticeId");
  return <>
    <Header />
    <BoardPage key={JSON.stringify([token, noticeId])} noticeId={noticeId} />
  </>;
}

function BoardPage({ noticeId }: { noticeId: string | null }) {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { id: userId, token } = useAuthSession();
  const { emit } = useEmitter();
  const [club, setClub] = useState<Club | null>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState<NoticeTarget>();
  const [noticeError, setNoticeError] = useState("");
  const [noticeAttempt, setNoticeAttempt] = useState(0);
  const locating = noticeId !== null && !target && !noticeError;
  const notice = target?.status === "located" ? target : undefined;
  const selectedId = noticeId === null ? params.get("orderId")?.toLowerCase() : notice?.order.id;
  const noticeProblem = noticeError || (target && target.status !== "located" && target.status !== "gift_located" ? noticeMessages[target.status] : "");
  const saved = club && readQueue(userId);
  const rawFilter = params.get("filter") ?? saved?.get("filter");
  const filter: BoardFilter = rawFilter === "public" || rawFilter === "directed" ? rawFilter : "all";
  const rawAfter = params.get("after") ?? (!params.has("filter") ? saved?.get("after") : null);
  const after = rawAfter && /^[0-9a-f]{24}$/i.test(rawAfter) ? rawAfter : undefined;

  useEffect(() => {
    if (!club || noticeId !== null) return;
    const queue = new URLSearchParams({ filter });
    if (after) queue.set("after", after);
    try { sessionStorage.setItem(queueKey(userId), queue.toString()); } catch { /* Optional UI context. */ }
    const canonical = new URLSearchParams(params);
    canonical.delete("clubId");
    canonical.set("filter", filter);
    if (after) canonical.set("after", after);
    else canonical.delete("after");
    if (canonical.toString() !== params.toString()) setParams(canonical, { replace: true, state });
  }, [club, noticeId, filter, after, userId, params, setParams, state]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    employeeRequest<Club | null>("club", "GET", undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setClub(data); })
      .catch(err => { if (!controller.signal.aborted) setError(message(err)); });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (noticeId === null) return;
    if (!/^[0-9a-f]{24}$/i.test(noticeId)) {
      setTarget({ status: "missing" });
      return;
    }
    const controller = new AbortController();
    const route = dispatchNoticeRoute(noticeId);
    employeeRequest<NoticeTarget>(`${route}/claim-board`, "GET", undefined, controller.signal)
      .then(result => {
        if (controller.signal.aborted || getAppToken("employee") !== token) return;
        setTarget(result);
        if (!result.clubId) return;
        void employeeRequest(`${route}/read`, "PATCH", undefined, controller.signal)
          .then(() => {
            if (!controller.signal.aborted && getAppToken("employee") === token) {
              emit({ type: dispatchNoticeReadEvent, payload: noticeId });
            }
          }).catch(() => {});
      })
      .catch(err => { if (!controller.signal.aborted) setNoticeError(message(err)); });
    return () => controller.abort();
  }, [noticeId, noticeAttempt, token, emit]);

  function queueParams(filters = filter, cursor = after) {
    const next = new URLSearchParams({ filter: filters });
    if (cursor) next.set("after", cursor);
    return next;
  }

  const heading = <>
      <Flex className="club-claim-header" align="center" justify="space-between" gap="small" wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>接单区</Typography.Title>
        {!locating && club ? <Flex align="center" wrap gap="small">
          <Typography.Text>{club.name}</Typography.Text>
          <Link className="club-claim-dispatch" to="/club/gift-claims">按次接单</Link>
          <Link className="club-claim-dispatch" to="/club/dispatch">直接派单</Link>
        </Flex> : null}
      </Flex>
      {target?.status === "gift_located" && <Alert type="info" showIcon title="已找到按次派单"
        action={<Link to={`/club/gift-claims?${new URLSearchParams({ orderId: target.orderId })}`}>查看该按次派单</Link>} />}
      {noticeProblem ? <Alert showIcon type="warning" title={noticeProblem}
        style={{ marginBottom: 12 }} action={noticeError ? <Button onClick={() => {
          setNoticeError("");
          setNoticeAttempt(value => value + 1);
        }}>重试定位</Button> : undefined} /> : null}
    </>;
  if (error || club === undefined || locating || !club) return <main className="club-claim-page">
    {heading}
    {error ? <Alert type="error" showIcon title={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试</Button>} />
      : club === undefined || locating ? <Spin aria-label={locating ? "定位派单" : "加载俱乐部"} />
        : <Empty description="当前账号尚无有效团员身份" />}
  </main>;

  return <ClubBoard key={userId} userId={userId} selectedId={selectedId}
    noticeId={notice ? noticeId ?? undefined : undefined} initialOrder={notice?.order} pickDefault={noticeId === null}
    heading={heading} filter={filter} after={after}
    onFilter={nextFilter => setParams(queueParams(nextFilter, ""))}
    onPage={cursor => setParams(queueParams(filter, cursor ?? ""))}
    onSelect={orderId => {
      const next = queueParams();
      next.set("orderId", orderId);
      setParams(next, { state: { fromClaimQueue: true } });
    }}
    onBack={() => {
      if (state?.fromClaimQueue) { void navigate(-1); return; }
      setParams(queueParams(), { replace: true });
    }} />;
}

function ClubBoard({ userId, selectedId, noticeId, initialOrder, pickDefault, heading, filter, after, onFilter, onPage, onSelect, onBack }: {
  userId: string;
  selectedId?: string;
  noticeId?: string;
  initialOrder?: Claimable;
  pickDefault: boolean;
  heading: React.ReactNode;
  filter: BoardFilter;
  after?: string;
  onFilter: (filter: BoardFilter) => void;
  onPage: (cursor?: string) => void;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const route = "club/claim-board";
  const prefix = `sky-heart.employee.pending-claim.v1:${userId}:`;
  const [pending, setPending] = useState(() => readPendingClaims(prefix));
  const [result, setResult] = useState<{ key: string; page: Page }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [detailReady, setDetailReady] = useState<string>();
  const openedFrom = useRef<string>(undefined);
  const back = useRef<HTMLButtonElement>(null);
  const resultKey = `${filter}:${after ?? ""}`;
  const page = result?.key === resultKey ? result.page : undefined;
  const scroll = useWorkspaceScroll(`${userId}:claim-board:${selectedId ? `${selectedId}:${noticeId ?? ""}` : `${filter}:${after ?? ""}`}`,
    selectedId ? detailReady === selectedId : !!page);
  const openOrder = page?.items.find(order => !order.claimBlockReason && (order.publicRemainingHearts > 0 || order.directedPendingHearts > 0));
  const orderId = selectedId ?? (pickDefault ? openOrder?.id ?? page?.items[0]?.id : undefined);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (!event.key || event.key.startsWith(prefix))) {
        setPending(readPendingClaims(prefix));
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [prefix]);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    const query = new URLSearchParams();
    if (after) query.set("after", after);
    if (filter !== "all") query.set("claimKind", filter);
    const path = query.size ? `${route}?${query}` : route;
    employeeRequest<Page>(path, "GET", undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setResult({ key: resultKey, page: data }); })
      .catch(err => {
        if (controller.signal.aborted) return;
        if (err instanceof RequestError && [403, 404].includes(err.status)) setResult(undefined);
        setError(message(err));
      });
    return () => controller.abort();
  }, [route, after, filter, resultKey, attempt]);

  function selectOrder(id: string) {
    openedFrom.current = id;
    setDetailReady(undefined);
    onSelect(id);
  }

  useLayoutEffect(() => {
    if (selectedId && back.current?.getClientRects().length) {
      back.current.focus({ preventScroll: true });
    } else if (!selectedId && page && openedFrom.current) {
      scroll.ref.current?.querySelector<HTMLElement>(`[data-claim-order="${openedFrom.current}"]`)?.focus({ preventScroll: true });
      openedFrom.current = undefined;
    }
  }, [selectedId, page, scroll.ref]);

  function goTo(cursor?: string) {
    onPage(cursor);
  }

  return <main className="club-claim-page" {...scroll}>
    {heading}
    <div className="club-claim-layout" data-order-open={!!selectedId}>
    <Card className="club-claim-queue" size="small" title="已发布派单"
      extra={<Button onClick={() => setAttempt(value => value + 1)}>刷新</Button>}>
      <div className="club-claim-filters" role="group" aria-label="筛选已发布派单">
        {Object.entries(boardFilters).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value}
          onClick={() => {
            if (value === filter) return;
            onFilter(value as BoardFilter);
          }}>{label}</button>)}
      </div>
      {pending.size ? <section aria-label="待确认的领取">
        <Typography.Title level={5}>待确认的领取</Typography.Title>
        <ul className="club-claim-list">
          {[...pending].map(([id, entries]) => <li key={id}>
            <button type="button" data-claim-order={id} onClick={() => selectOrder(id)}>
              <strong>核对领取 · {entries.length} 次待确认</strong>
              <code className="club-order-number">{id}</code>
            </button>
          </li>)}
        </ul>
      </section> : null}
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {page ? page.items.length ? <ul className="club-claim-list">
        {page.items.map(order => <li key={order.id}>
          <button type="button" data-claim-order={order.id} aria-current={order.id === orderId ? true : undefined}
            onClick={() => selectOrder(order.id)}>
            <span className="club-claim-list__title"><strong>{order.fulfillmentHearts ?? order.requestedHearts} 颗送心</strong>
              {order.directedPendingHearts > 0 ? <Tag color="blue">指定给我</Tag>
                : order.myClaimedHearts > 0 ? <Tag color="green">我已承接</Tag>
                : order.stoppedAt ? <Tag>已停送</Tag>
                  : order.publicRemainingHearts === 0 ? <Tag>已抢完</Tag> : null}</span>
            <code className="club-order-number">{order.id}</code>
            <span className="club-claim-list__meta">
              <span>{sources[order.source]} · {order.dispatcherUserId}</span>
              <span>公开余量 {order.publicRemainingHearts} 颗</span>
            </span>
          </button>
        </li>)}
      </ul> : <Empty description="暂无可查看的已发布派单" /> : !error ? <Spin aria-label="加载已发布派单" /> : null}
      {after || page?.nextCursor ? <Flex gap="small" wrap>
        {after ? <Button onClick={() => goTo()}>返回首页</Button> : null}
        {page?.nextCursor ? <Button onClick={() => goTo(page.nextCursor ?? undefined)}>下一页</Button> : null}
      </Flex> : null}
    </Card>
    {orderId ? <div className="club-claim-detail">
      <Button ref={back} className="club-claim-back" onClick={onBack}>返回接单列表</Button>
      <ClaimDetail key={orderId} route={`${route}/${encodeURIComponent(orderId)}`} attempt={attempt}
        noticeId={noticeId} initialOrder={initialOrder}
        storagePrefix={prefix} orderId={orderId} pending={pending.get(orderId)}
        onReady={() => setDetailReady(orderId)}
        onPendingChange={() => setPending(readPendingClaims(prefix))}
        onRefresh={() => setAttempt(value => value + 1)} />
    </div> : null}
    </div>
  </main>;
}

function ClaimDetail({ route, attempt, noticeId, initialOrder, storagePrefix, orderId, pending, onPendingChange, onRefresh, onReady }: {
  route: string;
  attempt: number;
  noticeId?: string;
  initialOrder?: Claimable;
  storagePrefix: string;
  orderId: string;
  pending?: PendingEntry[];
  onPendingChange: () => void;
  onRefresh: () => void;
  onReady: () => void;
}) {
  const { id: userId, token } = useAuthSession();
  const { loggingOut } = useSessionActions();
  const [detail, setDetail] = useState<Detail>();
  const [feedback, setFeedback] = useState<{ type: "success" | "warning"; title: string }>();
  const [selection, setSelection] = useState<ClaimSelection>();
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef<AbortController>(undefined);
  const initial = attempt === 0 && initialOrder ? { attempt, order: initialOrder } : undefined;
  const current = detail?.attempt === attempt ? detail : initial;
  const order = current && "order" in current ? current.order : undefined;
  const failure = current && "error" in current ? current : undefined;
  const ready = !!current;
  useEffect(() => {
    if (ready) onReady();
  }, [ready, onReady]);

  useEffect(() => {
    if (initialOrder && attempt === 0) return;
    const controller = new AbortController();
    const load = noticeId
      ? employeeRequest<NoticeTarget>(`${dispatchNoticeRoute(noticeId)}/claim-board`, "GET", undefined, controller.signal)
        .then(target => target.status === "located"
          ? { attempt, order: target.order }
          : { attempt, error: noticeMessages[target.status], unavailable: target.status !== "withdrawn" })
      : employeeRequest<Claimable>(route, "GET", undefined, controller.signal).then(order => ({ attempt, order }));
    load.then(result => { if (!controller.signal.aborted) setDetail(result); })
      .catch(err => {
        if (!controller.signal.aborted) setDetail({
          attempt, error: message(err), unavailable: err instanceof RequestError && [403, 404].includes(err.status),
        });
      });
    return () => controller.abort();
  }, [route, attempt, noticeId, initialOrder]);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function submit(claim: ClaimSelection, requestId?: string) {
    if (inFlight.current || loggingOut || getAppToken("employee") !== token) return;
    const saved = readPendingClaims(storagePrefix).get(orderId);
    const retry = requestId ? saved?.find(entry => entry.input.requestId === requestId) : undefined;
    if ((requestId && !retry) || (!requestId && (saved || pending))) {
      setSelection(undefined);
      onPendingChange();
      onRefresh();
      return;
    }
    const input = retry?.input ?? { ...claim, requestId: crypto.randomUUID() };
    if (!retry) savePendingClaim(storagePrefix, orderId, input);

    const controller = new AbortController();
    inFlight.current = controller;
    setSubmitting(true);
    setFeedback(undefined);
    onPendingChange();
    // The request can have been committed even if waiting for its response times out.
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await employeeRequest<ClaimReceipt>(`${route}/claims`, "POST", input, controller.signal);
      if (controller.signal.aborted || getAppToken("employee") !== token) return;
      if (!result?.id || result.userId !== userId || result.kind !== input.kind || result.hearts !== input.hearts) {
        throw new Error("未收到有效的领取确认");
      }
      clearPendingClaim(storagePrefix, orderId, input.requestId);
      onPendingChange();
      setFeedback({ type: "success", title: `已承接 ${result.hearts} 颗` });
      onRefresh();
    } catch (err) {
      if (getAppToken("employee") !== token) return;
      if (err instanceof RequestError && ([400, 409].includes(err.status) ||
          (!retry && [403, 404].includes(err.status)))) {
        clearPendingClaim(storagePrefix, orderId, input.requestId);
        onPendingChange();
        setFeedback({ type: "warning", title: err.message });
        onRefresh();
      } else if (err instanceof RequestError && [403, 404].includes(err.status)) {
        setFeedback({ type: "warning", title: err.message });
        onRefresh();
      }
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = undefined;
      setSubmitting(false);
      setSelection(undefined);
    }
  }

  return <Card title="派单详情" extra={<Button onClick={onRefresh}>刷新详情</Button>}>
    {failure ? <Alert type="warning" showIcon title={failure.error} /> : null}
    {!current ? <Spin aria-label="加载派单详情" /> : null}
    {order ? <>
      <Flex align="center" justify="space-between" wrap gap="small">
        <Typography.Title level={4} style={{ margin: 0 }}>{order.fulfillmentHearts ?? order.requestedHearts} 颗送心</Typography.Title>
        <Tag>{sources[order.source]}</Tag>
      </Flex>
      <Typography.Paragraph className="club-order-number">订单号 {order.id}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">
        派单人 {order.dispatcherUserId} · {dayjs(order.publishedAt).format("YYYY-MM-DD HH:mm")}
      </Typography.Paragraph>
      <dl className="club-order-facts">
        <div><dt>公开余量</dt><dd>{order.publicRemainingHearts} 颗</dd></div>
        <div><dt>指定给我待确认</dt><dd>{order.directedPendingHearts} 颗</dd></div>
        <div><dt>我已承接</dt><dd>{order.myClaimedHearts} 颗</dd></div>
      </dl>
      {order.recipientGameAccount ? <Typography.Paragraph>接收游戏账号 {order.recipientGameAccount}</Typography.Paragraph> : null}
      {order.myClaimedHearts > 0 ? <Typography.Paragraph>
        <Link to={assignmentHref(userId, orderId)}>查看我的承接</Link>
      </Typography.Paragraph> : null}
      {order.claimBlockReason ? <Alert showIcon type="info" title={order.claimBlockReason} />
        : !pending ? <Flex gap="small" wrap>
          {order.directedPendingHearts > 0 ? <Button type="primary"
            onClick={() => setSelection({ kind: "directed", hearts: order.directedPendingHearts })}>接受指定份额</Button> : null}
          {order.publicRemainingHearts > 0 ? <Button type={order.directedPendingHearts ? "default" : "primary"}
            onClick={() => setSelection({ kind: "public", hearts: order.publicRemainingHearts })}>抢单</Button> : null}
          {!order.directedPendingHearts && !order.publicRemainingHearts ? <Typography.Text type="secondary">
            {order.myClaimedHearts ? "当前没有可追加领取的份额" : "这笔派单的份额已被领完"}
          </Typography.Text> : null}
        </Flex> : null}
    </> : null}
    {feedback ? <Alert style={{ marginTop: 12 }} type={feedback.type} showIcon title={feedback.title} /> : null}
    {pending?.map(({ input, persistent }) => <Alert key={input.requestId} style={{ marginTop: 12 }}
      type="warning" showIcon title="领取结果待确认" description={<Flex vertical align="start" gap="small">
        <span>本次提交了 {input.hearts} 颗{input.kind === "directed" ? "指定份额" : "公开份额"}。重试会沿用原请求，已承接的份额会原样返回。</span>
        {persistent ? null : <span>浏览器无法保存本次请求，请先在当前页面确认结果。</span>}
        <Button onClick={() => void submit(input, input.requestId)} loading={submitting}
          disabled={loggingOut || failure?.unavailable}>重试本次领取</Button>
      </Flex>} />)}
    {selection && (submitting || (!pending && order)) ? <ClaimDialog selection={selection} submitting={submitting}
      onClose={() => setSelection(undefined)} onSubmit={hearts => void submit({ kind: selection.kind, hearts })} /> : null}
  </Card>;
}

function ClaimDialog({ selection, submitting, onClose, onSubmit }: {
  selection: ClaimSelection;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (hearts: number) => void;
}) {
  const [form] = Form.useForm<{ hearts: number }>();
  const directed = selection.kind === "directed";

  return <Modal open title={directed ? "接受指定份额" : "确认抢单"} cancelText="取消"
    okText={directed ? "确认承接" : "确认领取"} onCancel={onClose}
    onOk={() => directed ? onSubmit(selection.hearts) : form.submit()}
    confirmLoading={submitting} cancelButtonProps={{ disabled: submitting }}
    closable={!submitting} keyboard={!submitting} mask={{ closable: !submitting }}>
    {directed ? <Typography.Paragraph>指定份额 <strong>{selection.hearts} 颗</strong></Typography.Paragraph>
      : <Form form={form} layout="vertical" disabled={submitting} initialValues={{ hearts: selection.hearts }}
        onFinish={({ hearts }) => onSubmit(hearts)}>
        <Form.Item label="领取颗数" name="hearts"
          rules={[{ required: true, type: "integer", min: 1, max: selection.hearts }]}>
          <InputNumber min={1} max={selection.hearts} changeOnBlur={false} style={{ width: "100%" }} />
        </Form.Item>
      </Form>}
  </Modal>;
}
