import { useEffect, useRef, useState, type FormEvent } from "react";
import { DELIVERY_PERIOD_PREFERENCES, USER_ID_PATTERN, deliveryPeriodPreferenceLabel, estimateReceivedHearts, platformPromotionDescription, type DeliveryPeriodPreference, type PlatformPromotionSource } from "@webapp-template/common";
import { getAppToken, RequestError, useAuthSession, useSessionActions } from "@webapp-template/common/web-auth";
import {
  clientRequest, clientOrdersPath, detailHref, dispatcherName, dispatchLabel, orderDispatcher,
  sourceLabel, useClientRead, type OrderSummary,
} from "./order-api";
import { readClientContext, rememberClientContext } from "./navigation";

type OrderOptions = { clubName: string; dispatchers: { userId: string; nickname: string | null }[]; coupons?: PlatformPromotionSource[] };
type OrderInput = {
  requestId: string;
  recipientGameAccount: string;
  requestedGiftTimes?: number;
  requestedHearts?: number;
  estimatedReceivedHearts?: number;
  deliveryPeriodPreference?: DeliveryPeriodPreference;
  doubleGiftTimes?: number;
  dispatcherUserId?: string;
  platformCouponId?: string;
};
type Draft = { recipient: string; giftTimes: string; estimate: string; period: DeliveryPeriodPreference | ""; doubleTimes: string; dispatcher: string; coupon: string };

function readDraft(userId: string, draftKey: string): Draft {
  const empty: Draft = { recipient: "", giftTimes: "", estimate: "", period: "", doubleTimes: "", dispatcher: "", coupon: "" };
  try {
    const value = JSON.parse(readClientContext(userId, draftKey) ?? "null") as Partial<Draft> | null;
    if (!value) return empty;
    return {
      recipient: typeof value.recipient === "string" ? value.recipient.slice(0, 120) : "",
      giftTimes: typeof value.giftTimes === "string" ? value.giftTimes : "",
      estimate: typeof value.estimate === "string" ? value.estimate : "",
      period: value.period && DELIVERY_PERIOD_PREFERENCES.includes(value.period) ? value.period : "",
      doubleTimes: typeof value.doubleTimes === "string" ? value.doubleTimes : "",
      dispatcher: value.dispatcher && USER_ID_PATTERN.test(value.dispatcher) ? value.dispatcher : "",
      coupon: typeof value.coupon === "string" ? value.coupon : "",
    };
  } catch { return empty; }
}

const unknownResult = "暂时无法确认提交结果。恢复网络后请重试本次提交，已创建的订单会原样返回。";

function readPending(storageKey: string): OrderInput | null {
  try {
    const saved = sessionStorage.getItem(storageKey);
    if (!saved) return null;
    const input = JSON.parse(saved) as OrderInput;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) &&
        typeof input.recipientGameAccount === "string" && input.recipientGameAccount.trim().length > 0 &&
        input.recipientGameAccount.length <= 120 &&
        Number.isSafeInteger(input.requestedGiftTimes ?? input.requestedHearts) &&
        (input.requestedGiftTimes ?? input.requestedHearts ?? 0) > 0 &&
        (input.dispatcherUserId === undefined || USER_ID_PATTERN.test(input.dispatcherUserId)) &&
        (input.deliveryPeriodPreference === undefined || DELIVERY_PERIOD_PREFERENCES.includes(input.deliveryPeriodPreference))) {
      return input;
    }
  } catch {
    // A restricted browser can still retry within the open page.
  }
  return null;
}

function savePending(storageKey: string, input: OrderInput | null) {
  try {
    if (input) sessionStorage.setItem(storageKey, JSON.stringify(input));
    else sessionStorage.removeItem(storageKey);
  } catch {
    // The current page also keeps the request in memory.
  }
}

export function NewOrder() {
  const { id, token } = useAuthSession();
  const { loggingOut } = useSessionActions();
  const options = useClientRead<OrderOptions>("/client/club/order-options", "暂时无法读取派单人，请检查网络连接后重试。");
  const storageKey = `sky-heart.client.order-submission.v1:${id}`;
  const draftKey = "order-draft";
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [draft] = useState(() => readDraft(id, draftKey));
  const [recipient, setRecipient] = useState(pending ? pending.recipientGameAccount : draft.recipient);
  const [giftTimes, setGiftTimes] = useState(pending?.requestedGiftTimes ? String(pending.requestedGiftTimes) : draft.giftTimes);
  const [estimate, setEstimate] = useState(pending?.estimatedReceivedHearts ? String(pending.estimatedReceivedHearts) : draft.estimate);
  const [period, setPeriod] = useState<DeliveryPeriodPreference | "">(pending ? pending.deliveryPeriodPreference ?? "" : draft.period);
  const [doubleTimes, setDoubleTimes] = useState(pending ? String(pending.doubleGiftTimes ?? "") : draft.doubleTimes);
  const [dispatcher, setDispatcher] = useState(pending ? pending.dispatcherUserId ?? "" : draft.dispatcher);
  const [coupon, setCoupon] = useState(pending ? pending.platformCouponId ?? "" : draft.coupon);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<OrderSummary>();
  const inFlight = useRef(false);
  const candidates = options.data?.dispatchers ?? [];
  const coupons = options.data?.coupons ?? [];
  const unavailableChoice = !!dispatcher && !candidates.some(person => person.userId === dispatcher);
  const unavailableCoupon = !!coupon && !coupons.some(item => item.couponId === coupon);
  const canSubmit = !busy && !loggingOut && (!!pending || (!options.loading && !options.error && !unavailableChoice && !unavailableCoupon));
  const doubleGiftTimes = period === "split" && doubleTimes ? Number(doubleTimes) : undefined;
  const suggestedEstimate = estimateReceivedHearts(Number(giftTimes), period || undefined, doubleGiftTimes);

  useEffect(() => {
    if (!created) rememberClientContext(id, draftKey, JSON.stringify({ recipient, giftTimes, estimate, period, doubleTimes, dispatcher, coupon }));
  }, [id, draftKey, recipient, giftTimes, estimate, period, doubleTimes, dispatcher, coupon, created]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !canSubmit || getAppToken("client") !== token) return;
    const recipientGameAccount = recipient.trim();
    const requestedGiftTimes = Number(giftTimes);
    const estimatedReceivedHearts = estimate ? Number(estimate) : undefined;
    if (!pending && (!recipientGameAccount || !Number.isSafeInteger(requestedGiftTimes) || requestedGiftTimes < 1 ||
        (estimatedReceivedHearts !== undefined && (!Number.isSafeInteger(estimatedReceivedHearts) || estimatedReceivedHearts < 1)))) {
      setError("请填写收心游戏账号，赠送次数和预计实收颗数须为正整数。");
      return;
    }
    if (!pending && doubleGiftTimes !== undefined &&
        (!Number.isSafeInteger(doubleGiftTimes) || doubleGiftTimes < 1 || doubleGiftTimes >= requestedGiftTimes)) {
      setError("双倍期赠送次数须为少于订购总次数的正整数。");
      return;
    }

    const input = pending ?? {
      requestId: crypto.randomUUID(),
      recipientGameAccount,
      requestedGiftTimes,
      ...(estimatedReceivedHearts === undefined ? {} : { estimatedReceivedHearts }),
      ...(period ? { deliveryPeriodPreference: period } : {}),
      ...(doubleGiftTimes === undefined ? {} : { doubleGiftTimes }),
      ...(dispatcher ? { dispatcherUserId: dispatcher } : {}),
      ...(coupon ? { platformCouponId: coupon } : {}),
    };
    inFlight.current = true;
    setBusy(true);
    setError("");
    setPending(input);
    savePending(storageKey, input);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const order = await clientRequest<OrderSummary>(token, clientOrdersPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (getAppToken("client") !== token) return;
      if (!order?.id || order.source !== "client_order" || !(order.dispatchStatus in dispatchLabel)) {
        throw new Error(unknownResult);
      }
      savePending(storageKey, null);
      rememberClientContext(id, draftKey, "");
      setPending(null);
      setCreated(order);
    } catch (error) {
      inFlight.current = false;
      if (getAppToken("client") !== token) return;
      if (error instanceof RequestError && [400, 404, 409].includes(error.status)) {
        savePending(storageKey, null);
        setPending(null);
        setError(error.message);
        options.reload();
      } else {
        setError(unknownResult);
      }
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  if (created) return <section className="client-orders__panel client-orders__confirmation">
    <h1>订单已提交</h1>
    <p role="status">{created.dispatchStatus === "pending_assignment"
      ? "请等待俱乐部分配派单人。分配前可以在订单详情取消。"
      : created.dispatchStatus === "pending" ? "请等待派单人核对需求并报价。" : `订单当前${dispatchLabel[created.dispatchStatus]}。`}</p>
    <dl>
      <dt>订单号</dt><dd className="client-orders__id">{created.id}</dd>
      <dt>来源</dt><dd>{sourceLabel[created.source]}</dd>
      <dt>派单人</dt><dd>{orderDispatcher(created)}</dd>
      <dt>当前状态</dt><dd><strong>{dispatchLabel[created.dispatchStatus]}</strong></dd>
    </dl>
    <a href={detailHref(created)} className="client-orders__action client-orders__primary">查看订单详情</a>
  </section>;

  return <>
    <h1>送心下单</h1>
    {options.data ? <p className="client-orders__club-name">{options.data.clubName}</p> : null}
    <form className="client-orders__form" onSubmit={submit}>
      <fieldset className="client-orders__panel" disabled={!!pending || loggingOut}>
        <legend>送心需求</legend>
        <div className="client-orders__field">
          <label htmlFor="recipient-game-account">接收爱心的游戏账号</label>
          <input id="recipient-game-account" name="recipientGameAccount" value={recipient} onChange={event => setRecipient(event.target.value)}
            required maxLength={120} autoComplete="off" />
        </div>
        {pending?.requestedHearts !== undefined ? <p>上次提交的订购数量 · {pending.requestedHearts} 颗</p> : <>
        <div className="client-orders__field">
          <label htmlFor="requested-gift-times">订购赠送次数</label>
          <input id="requested-gift-times" name="requestedGiftTimes" type="number" inputMode="numeric" value={giftTimes} onChange={event => setGiftTimes(event.target.value)}
            min={1} max={Number.MAX_SAFE_INTEGER} step={1} required />
        </div>
        <div className="client-orders__field">
          <label htmlFor="delivery-period">期望交付时段（选填）</label>
          <select id="delivery-period" name="deliveryPeriodPreference" value={period} onChange={event => setPeriod(event.target.value as typeof period)}>
            <option value="">与派单人协商</option>
            {DELIVERY_PERIOD_PREFERENCES.map(value => <option key={value} value={value}>{deliveryPeriodPreferenceLabel[value]}</option>)}
          </select>
        </div>
        {period === "split" ? <div className="client-orders__field">
          <label htmlFor="double-gift-times">双倍期赠送次数（选填）</label>
          <input id="double-gift-times" name="doubleGiftTimes" type="number" inputMode="numeric" value={doubleTimes}
            onChange={event => setDoubleTimes(event.target.value)} min={1} max={Number.MAX_SAFE_INTEGER} step={1} />
        </div> : null}
        <div className="client-orders__field">
          <label htmlFor="estimated-hearts">建单预计实收爱心颗数（选填）</label>
          <input id="estimated-hearts" name="estimatedReceivedHearts" type="number" inputMode="numeric" value={estimate} onChange={event => setEstimate(event.target.value)}
            min={1} max={Number.MAX_SAFE_INTEGER} step={1} aria-describedby="estimated-hearts-description" />
          <p id="estimated-hearts-description" className="client-orders__muted">
            {suggestedEstimate === undefined ? "按赠送次数计价。时段或分段次数待确认时，可以留空。" : `留空时按预计时段记录 ${suggestedEstimate} 颗。按赠送次数计价。`}
          </p>
        </div>
        </>}
        <div className="client-orders__field">
          <label htmlFor="dispatcher-user-id">派单人</label>
          <select id="dispatcher-user-id" name="dispatcherUserId" value={dispatcher} onChange={event => setDispatcher(event.target.value)}
            disabled={options.loading || !!options.error} aria-describedby="dispatcher-description">
            <option value="">{options.data && !candidates.length ? "交由俱乐部分配" : "系统随机分配"}</option>
            {unavailableChoice ? <option value={dispatcher}>团员（{dispatcher}）</option> : null}
            {candidates.map(candidate => <option key={candidate.userId} value={candidate.userId}>
              {dispatcherName(candidate.userId, candidate.nickname)}
            </option>)}
          </select>
          <p id="dispatcher-description" className="client-orders__muted">系统从本俱乐部当前可选的派单人中随机分配。没有候选时，由俱乐部手动分配。</p>
        </div>
        {(coupons.length > 0 || coupon) && <div className="client-orders__field">
          <label htmlFor="platform-coupon">优惠券</label>
          <select id="platform-coupon" value={coupon} onChange={event => setCoupon(event.target.value)} disabled={options.loading || !!options.error}>
            <option value="">不使用优惠券</option>
            {unavailableCoupon && <option value={coupon}>原选优惠券已不可用</option>}
            {coupons.map(item => <option key={item.couponId} value={item.couponId}>{platformPromotionDescription(item)}</option>)}
          </select>
          <p className="client-orders__muted">派单人会在报价时核对适用条件，有效用券将替代全场折扣。</p>
        </div>}
      </fieldset>
      <section className="client-orders__panel client-orders__submit">
        <h2>报价与派发</h2>
        <p>派单人会与你核对数量和交付时段，再提供报价并处理派发。</p>
        {error ? <p role="alert" className="client-orders__error">{error}</p> : null}
        {pending && !busy && !error ? <p role="status">{unknownResult}</p> : null}
        {options.loading ? <p role="status">正在读取派单人…</p> : null}
        {options.error ? <p role="alert" className="client-orders__error">{options.error}</p> : null}
        {!options.loading && !options.error && !candidates.length && !pending && !error ? <p role="status">本俱乐部当前没有可选派单人，提交后订单将进入待分配。</p> : null}
        {!options.loading && !options.error && unavailableChoice && !pending ? <p role="status">此前选择的派单人当前不可选，请重新选择。</p> : null}
        <div className="client-orders__actions">
          {options.error || (options.data && !candidates.length) ? <button type="button" disabled={options.loading || busy} onClick={options.reload}>刷新派单人</button> : null}
          <button type="submit" className="client-orders__primary" disabled={!canSubmit}>
            {busy ? "正在提交…" : pending ? "重试本次提交" : "提交订单"}
          </button>
        </div>
      </section>
    </form>
  </>;
}
