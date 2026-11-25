import { useEffect, useState } from "react";
import type { ContinuationQuote, ContinuationRequest, CustomerGiftProgress, CustomerQuote, CustomerReceipt, DeliveryPeriodPreference, OrderFulfillment, OrderTermination, PaymentStatus, PendingQuoteActivity, PriceAdjustment, PriceSegment } from "@webapp-template/common";
import type { CustomerGiftSettlement } from "@webapp-template/common";
import { authRequest, getAppToken, invalidateSession, RequestError, useAuthSession } from "@webapp-template/common/web-auth";

export const sourceLabel = { direct_dispatch: "直接派单", client_order: "客户端下单" };
export const dispatchLabel = { draft: "待派发", pending_assignment: "待分配", pending: "待派单", published: "已派发", cancelled: "已取消" };
const assignmentLabel = { creator: "团员发起", customer_selected: "客户指定", random: "系统随机分配", manual: "俱乐部手动分配" };

export type OrderSummary = {
  id: string;
  clubId: string;
  source: keyof typeof sourceLabel;
  dispatchStatus: keyof typeof dispatchLabel;
  dispatcherUserId: string | null;
  dispatcherNickname: string | null;
  dispatcherAssignment: keyof typeof assignmentLabel | null;
  recipientGameAccount: string;
  requestedHearts?: number;
  requestedGiftTimes?: number;
  estimatedReceivedHearts?: number;
  doubleGiftTimes?: number;
  fulfillmentHearts?: number;
  giftHearts?: number;
  deliveryPeriodPreference?: DeliveryPeriodPreference;
};

export type Order = OrderSummary & {
  deliveryProgress: OrderFulfillment | CustomerGiftProgress | null;
  closedAt?: string | null;
  quote: CustomerQuote | null;
  continuationQuotes?: ContinuationQuote[];
  continuationRequests?: ContinuationRequest[];
  pendingActivity?: PendingQuoteActivity;
  quoteSegments?: PriceSegment[];
  receipt: CustomerReceipt | null;
  paymentStatus: PaymentStatus;
  priceAdjustment?: PriceAdjustment;
  priceAdjustmentHistory?: PriceAdjustment[];
  termination?: OrderTermination;
  settlement?: CustomerGiftSettlement;
};

export const clientOrdersPath = "/client/orders";

export function detailHref(order: OrderSummary) {
  return `/order-detail?${new URLSearchParams({ order: order.id })}`;
}

export function dispatcherName(userId: string, nickname: string | null) {
  return `${nickname || "团员"}（${userId}）`;
}

export function orderDispatcher(order: OrderSummary) {
  if (!order.dispatcherUserId) return order.dispatchStatus === "cancelled" ? "未分配" : "待分配";
  const name = dispatcherName(order.dispatcherUserId, order.dispatcherNickname);
  return order.dispatcherAssignment ? `${name} · ${assignmentLabel[order.dispatcherAssignment]}` : name;
}

export async function clientRequest<T>(token: string, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  try {
    return await authRequest<T>(path, { ...init, headers });
  } catch (error) {
    if (error instanceof RequestError && error.status === 401 && token === getAppToken("client")) {
      invalidateSession("client");
    }
    throw error;
  }
}

export function useClientRead<T>(path: string, fallback: string) {
  const { token } = useAuthSession();
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    clientRequest<T>(token, path, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(error => {
        if (!controller.signal.aborted) setError(error instanceof RequestError ? error.message : fallback);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt, fallback, path, token]);

  function reload() {
    setError("");
    setLoading(true);
    setAttempt(value => value + 1);
  }

  return { data, error, loading, reload };
}
