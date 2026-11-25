export type ServiceBusinessType = "daily_run" | "companionship";
export const dailyRunUnitPriceCents = 2000;
export const companionshipUnitPriceCents = 1500;
export const companionshipSlotMinutes = 30;
export const serviceBusinessLabels: Record<ServiceBusinessType, string> = {
  daily_run: "代跑",
  companionship: "陪玩",
};
export type ServiceOrderScope = "dispatch" | "board" | "mine" | "finance";
export type ServiceOrderStatus = "pending_assignment" | "pending_dispatch" | "published" | "claimed" | "completed" | "stopped";
export type ServiceOrderAction = "assign" | "publish" | "claim" | "start" | "deliveries" | "accept" | "stop" | "refund" | "close";

export interface ServiceOrderAccounting {
  status: "in_progress" | "refund_pending" | "ready_to_close" | "closed" | "void";
  acceptedUnits: number;
  receivedCents?: number;
  refundDueCents?: number;
  refundedCents?: number;
  refundRemainingCents?: number;
  netReceivedCents?: number;
  refunds?: { amountCents: number; occurredAt: string; transferReference?: string }[];
  dispatchFeeCents?: number;
  rewardCents?: number;
  clubFeeCents?: number;
  allocatedCents?: number;
  closedAt?: string;
}

export interface ServiceOrderDelivery {
  unit: number;
  businessDate: string;
  evidence: string;
  submittedAt: string;
  finishedAt?: string;
  acceptedAt?: string;
}

export interface ServiceOrderView {
  id: string;
  businessType: ServiceBusinessType;
  source: "client_order" | "direct_dispatch";
  customerUserId?: string;
  dispatcherUserId: string | null;
  executorUserId: string | null;
  recipientGameAccount?: string;
  serviceDescription: string;
  startDate: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  startedAt?: string;
  units: number;
  status: ServiceOrderStatus;
  actions: ServiceOrderAction[];
  deliveries: ServiceOrderDelivery[];
  quote?: { unitPriceCents: number; totalCents: number };
  receipt?: { amountCents: number; occurredAt: string };
  stop?: { reason: string; stoppedAt: string };
  accounting?: ServiceOrderAccounting;
}

export interface ServiceOrderPage {
  items: ServiceOrderView[];
  nextCursor: string | null;
}
