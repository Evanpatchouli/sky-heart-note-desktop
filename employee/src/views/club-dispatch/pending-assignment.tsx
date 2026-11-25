import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Card, Empty, Flex, Spin } from "antd";
import { deliveryPeriodPreferenceLabel, USER_ID_PATTERN, type DeliveryPeriodPreference } from "@webapp-template/common";
import { getAppToken, RequestError, useAuthSession } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";

type Candidate = { userId: string; nickname: string | null; dispatcher: boolean };
type PendingOrder = {
  id: string;
  recipientGameAccount: string;
  requestedGiftTimes: number;
  estimatedReceivedHearts?: number;
  deliveryPeriodPreference?: DeliveryPeriodPreference;
  doubleGiftTimes?: number;
};
type Page = { items: PendingOrder[]; nextCursor: string | null };
type Action = { requestId: string; dispatcherUserId: string };
type Actions = Record<string, Action>;

const unknownResult = "暂时无法确认分配结果，请重试本次分配。";

function savedActions(key: string): Actions {
  try {
    const entries = Object.entries(JSON.parse(sessionStorage.getItem(key) ?? "{}") as Actions);
    return Object.fromEntries(entries.filter(([orderId, action]) =>
      /^[a-f0-9]{24}$/i.test(orderId) && action &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(action.requestId) &&
      USER_ID_PATTERN.test(action.dispatcherUserId)));
  } catch { return {}; }
}

function rememberActions(key: string, actions: Actions) {
  try {
    if (Object.keys(actions).length) sessionStorage.setItem(key, JSON.stringify(actions));
    else sessionStorage.removeItem(key);
  } catch { /* The open page keeps the action in memory. */ }
}

export default function PendingAssignment({ clubId, onAssigned }: {
  clubId: string;
  onAssigned: (orderId: string) => void;
}) {
  const { id, token } = useAuthSession();
  const route = `clubs/${clubId}`;
  const storageKey = `sky-heart.employee.assignment.v1:${id}:${clubId}`;
  const [board, setBoard] = useState<{ page: Page; candidates: Candidate[] }>();
  const [after, setAfter] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actions, setActions] = useState(() => savedActions(storageKey));
  const [attemptErrors, setAttemptErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const active = useRef(new Set<string>());
  const stored = useRef(actions);

  function refresh() {
    setError("");
    setAttempt(value => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    const query = after ? `?after=${after}` : "";
    Promise.all([
      employeeRequest<Page>(`${route}/orders/pending-assignment${query}`, "GET", undefined, controller.signal),
      employeeRequest<Candidate[]>(`${route}/assignment-candidates`, "GET", undefined, controller.signal),
    ]).then(([page, candidates]) => {
      if (!controller.signal.aborted) setBoard({ page, candidates });
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof RequestError ? err.message : "读取待分配订单失败");
    });
    return () => controller.abort();
  }, [route, after, attempt]);

  function goTo(cursor?: string) {
    setError("");
    setBoard(undefined);
    setAfter(cursor);
  }

  function recordAction(orderId: string, action: Action | null) {
    const updated = { ...stored.current };
    if (action) updated[orderId] = action;
    else delete updated[orderId];
    stored.current = updated;
    rememberActions(storageKey, updated);
    setActions(updated);
  }

  async function assign(orderId: string, dispatcherUserId: string) {
    if (active.current.has(orderId) || completed[orderId] || getAppToken("employee") !== token) return;
    const input = stored.current[orderId] ?? { requestId: crypto.randomUUID(), dispatcherUserId };
    active.current.add(orderId);
    recordAction(orderId, input);
    setBusy(value => ({ ...value, [orderId]: true }));
    setAttemptErrors(value => ({ ...value, [orderId]: "" }));
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const result = await employeeRequest<{ id: string; dispatcherUserId: string }>(
        `${route}/orders/${orderId}/assign-dispatcher`, "POST", input, controller.signal,
      );
      if (getAppToken("employee") !== token) return;
      if (result?.id !== orderId || result.dispatcherUserId !== input.dispatcherUserId) throw new Error(unknownResult);
      recordAction(orderId, null);
      setCompleted(value => ({ ...value, [orderId]: true }));
      setNotice(`订单 ${orderId} 已分配，等待派单人主动派发。`);
      if (result.dispatcherUserId === id) onAssigned(orderId);
      refresh();
    } catch (err) {
      if (getAppToken("employee") !== token) return;
      if (err instanceof RequestError && [400, 403, 404, 409].includes(err.status)) {
        recordAction(orderId, null);
        setAttemptErrors(value => ({ ...value, [orderId]: err.message }));
        if (err.status !== 400) {
          setNotice(`订单 ${orderId} · ${err.message}`);
          refresh();
        }
      } else {
        setAttemptErrors(value => ({ ...value, [orderId]: unknownResult }));
      }
    } finally {
      window.clearTimeout(timeout);
      active.current.delete(orderId);
      setBusy(value => ({ ...value, [orderId]: false }));
    }
  }

  const listedOrderIds = new Set(board?.page.items.map(({ id }) => id));
  return <Card size="small" title="待分配订单" extra={<Button onClick={refresh}>刷新待分配订单</Button>}>
    {notice ? <p role="status">{notice}</p> : null}
    {board && Object.entries(actions).filter(([orderId]) => !listedOrderIds.has(orderId)).map(([orderId, action]) =>
      <Card key={orderId} size="small" title="分配结果待确认" style={{ marginBottom: 8 }}>
        <p>订单号 <code>{orderId}</code> · 拟分配给 {action.dispatcherUserId}</p>
        {attemptErrors[orderId] ? <p role="alert">{attemptErrors[orderId]}</p> : null}
        <Button loading={busy[orderId]} onClick={() => void assign(orderId, action.dispatcherUserId)}>
          重试本次分配
        </Button>
      </Card>)}
    {error ? <Alert type="error" showIcon title={error} />
      : !board ? <Spin aria-label="加载待分配订单" />
      : board.page.items.length ? <Flex vertical gap="small">
        {board.page.items.map(order => <AssignmentForm key={order.id} order={order}
          candidates={board.candidates} pending={actions[order.id]} busy={busy[order.id]}
          complete={completed[order.id]} error={attemptErrors[order.id]}
          onAssign={dispatcherUserId => void assign(order.id, dispatcherUserId)} />)}
      </Flex> : <Empty description="本页没有待分配订单" />}
    {board?.page.nextCursor || after ? <Flex gap="small" style={{ marginTop: 8 }}>
      <Button disabled={!after} onClick={() => goTo()}>返回待分配首页</Button>
      <Button disabled={!board?.page.nextCursor} onClick={() => goTo(board?.page.nextCursor ?? undefined)}>下一页待分配订单</Button>
    </Flex> : null}
  </Card>;
}

function AssignmentForm({ order, candidates, pending, busy, complete, error, onAssign }: {
  order: PendingOrder;
  candidates: Candidate[];
  pending?: Action;
  busy?: boolean;
  complete?: boolean;
  error?: string;
  onAssign: (dispatcherUserId: string) => void;
}) {
  const [choice, setDispatcher] = useState(pending?.dispatcherUserId ?? "");
  const dispatcherUserId = pending?.dispatcherUserId ?? choice;
  const selectable = candidates.some(candidate => candidate.userId === dispatcherUserId);
  const inputId = `dispatcher-${order.id}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && !complete && (pending || selectable)) onAssign(dispatcherUserId);
  }

  return <Card size="small" title={order.recipientGameAccount}>
    <p>订单号 <code>{order.id}</code></p>
    <p>订购 {order.requestedGiftTimes} 次 · 建单预计实收 {order.estimatedReceivedHearts === undefined ? "待确认" : `${order.estimatedReceivedHearts} 颗`}
      {order.deliveryPeriodPreference ? ` · ${deliveryPeriodPreferenceLabel[order.deliveryPeriodPreference]}` : ""}
      {order.doubleGiftTimes === undefined ? "" : ` · 双倍期 ${order.doubleGiftTimes} 次`}</p>
    <form onSubmit={submit}>
      <Flex align="center" wrap gap="small">
        <label htmlFor={inputId}>派单人</label>
        <select id={inputId} value={dispatcherUserId} disabled={!!pending || complete} onChange={event => setDispatcher(event.target.value)}>
          <option value="">选择本单派单人</option>
          {dispatcherUserId && !selectable ? <option value={dispatcherUserId}>团员（{dispatcherUserId}）</option> : null}
          {candidates.map(candidate => <option value={candidate.userId} key={candidate.userId}>
            {candidate.nickname || "团员"}（{candidate.userId}）{candidate.dispatcher ? " · 派单" : ""}
          </option>)}
        </select>
        <Button htmlType="submit" type="primary" loading={busy} disabled={complete || (!pending && !selectable)}>
          {pending && !busy ? "重试本次分配" : "确认分配"}
        </Button>
      </Flex>
      {error || (pending && !busy) ? <p role="alert">{error || unknownResult}</p> : null}
    </form>
  </Card>;
}
