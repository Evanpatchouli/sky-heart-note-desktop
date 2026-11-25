export type ServiceBusinessType = "daily_run";
export const dailyRunUnitPriceCents = 2000;
export type ServiceOrderScope = "dispatch" | "board" | "mine";
export type ServiceOrderStatus = "pending_assignment" | "pending_dispatch" | "published" | "claimed" | "completed" | "stopped";
export type ServiceOrderAction = "assign" | "publish" | "claim" | "deliveries" | "accept" | "stop";

export interface ServiceOrderDelivery {
  unit: number;
  businessDate: string;
  evidence: string;
  submittedAt: string;
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
  units: number;
  status: ServiceOrderStatus;
  actions: ServiceOrderAction[];
  deliveries: ServiceOrderDelivery[];
  quote?: { unitPriceCents: number; totalCents: number };
  receipt?: { amountCents: number; occurredAt: string };
  stop?: { reason: string; stoppedAt: string };
}

export interface ServiceOrderPage {
  items: ServiceOrderView[];
  nextCursor: string | null;
}
