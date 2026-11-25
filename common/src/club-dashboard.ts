export type DashboardSource = "direct_dispatch" | "client_order";
export type DashboardMetric = "all" | "pending_dispatch" | "claimable" | "fulfilled" | "received" | "action_required" | "ready_to_close";

export interface DashboardOrderRow {
  orderId: string;
  source: DashboardSource;
  dispatcherUserId: string | null;
  recipientGameAccount: string;
  dispatchStatus: string;
  priceUnit: "gift_times" | "hearts";
  agreedGiftTimes: number | null;
  claimableGiftTimes: number;
  deliveredGiftTimes: number | null;
  knownReceivedHearts: number;
  knownReceivedLines: number;
  unknownReceivedLines: number;
  pendingDispatch: boolean;
  actionLabel: string | null;
}

export interface DashboardSourceTotals {
  source: DashboardSource;
  orders: number;
  deliveredGiftTimes: number;
  knownReceivedHearts: number;
  knownReceivedLines: number;
  unknownReceivedLines: number;
}

export interface ClubDashboard {
  operations?: {
    pendingOrders: number;
    claimableGiftTimes: number;
    deliveredGiftTimes: number;
    knownReceivedHearts: number;
    knownReceivedLines: number;
    unknownReceivedLines: number;
    actionOrders: number;
    sources: DashboardSourceTotals[];
    attention: DashboardOrderRow[];
  };
  finance?: {
    readyOrders: number;
    readyNetCents: number;
    clubBalanceCents: number;
    ready: { orderId: string; netReceivedCents: number }[];
  };
}

export interface DashboardOrderList {
  items: DashboardOrderRow[];
  nextCursor: string | null;
}
