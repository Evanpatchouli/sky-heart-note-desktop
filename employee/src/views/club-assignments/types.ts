import type { DeliveryPeriodBreakdown, GiftDispatchSegment, PricingPeriod } from "@webapp-template/common";
import { RequestError } from "@webapp-template/common/web-auth";

export type ExecutionAccount = {
  id: string;
  name: string;
  personalAccountId?: string;
  localAccountId?: string;
  linkedAt?: string;
};
export type LinkableAccount = { id: string; localId: string; name: string };
export type AssignmentShare = {
  id: string;
  userId: string;
  hearts: number;
  claimKind?: "directed" | "public";
  claimedAt?: string;
  executionGameAccounts: ExecutionAccount[];
};
export type AssignedOrder = {
  id: string;
  recipientGameAccount: string;
  requestedHearts: number;
  fulfillmentHearts?: number;
  delivery?: DeliveryProgress;
  personalSchedule: PersonalSchedule;
  shares: AssignmentShare[];
};

export type GiftAssignmentProgress = {
  acceptedGiftTimes: number;
  observedGiftTimes: Count;
  deliveredGiftTimes: number;
  remainingGiftTimes: number;
  excessGiftTimes: Count;
  pendingPromotionalGiftTimes?: Count;
  actualReceivedHearts: Count | null;
  knownReceivedHearts: Count;
  unknownReceivedLines: number;
  reportSyncPending: boolean;
  canSubmitDaily: boolean;
  stopped: boolean;
};

export type GiftAssignment = {
  id: string;
  priceUnit: "gift_times";
  recipientGameAccount: string;
  personalSchedule: PersonalSchedule;
  giftProgress: GiftAssignmentProgress;
};

export type GiftAssignmentDetail = GiftAssignment & {
  segments: Pick<GiftDispatchSegment, "segmentIndex" | "startDate" | "endDate" | "quotePeriod" | "shares">[];
};

export type AssignmentRow = AssignedOrder | GiftAssignment;

export function isGiftAssignment(order: AssignmentRow): order is GiftAssignment {
  return "giftProgress" in order;
}

export function ownGiftHearts(progress: GiftAssignmentProgress) {
  if (progress.actualReceivedHearts !== null) return progress.actualReceivedHearts + " 颗";
  return progress.knownReceivedHearts ? `未知（已知 ${progress.knownReceivedHearts} 颗）` : "未知";
}

export type ScheduleDates = { startDate: string | null; endDate: string | null };
export type PersonalSchedule = ScheduleDates & { revision: number };

type Count = number | string;
export type QuoteSegment = { number: number; period: PricingPeriod; hearts: number; paidHearts?: number; giftHearts?: number; adjusted?: true };
export type DeliveryProgress = {
  myGiftTimes: Count;
  myObservedHearts: Count;
  myCreditedHearts: number;
  myRemainingHearts: number;
  myExcessHearts: Count;
  orderCreditedHearts: number;
  orderRemainingHearts: number;
  orderStoppedHearts?: number;
  myStoppedHearts?: number;
  myPendingReports?: number;
  myReportSyncPending?: boolean;
  shares: { id: string; observedHearts: Count; creditedHearts: number; remainingHearts: number; stoppedHearts?: number; excessHearts: Count }[];
  quoteSegments?: QuoteSegment[];
  segmentsOverPlan?: number[];
  periodBreakdown?: DeliveryPeriodBreakdown;
  holdReason?: string;
};
export type ReportLine = {
  period: PricingPeriod | "unconfirmed";
  quoteSegment?: number;
  giftTimes: number;
  receivedHearts: number;
};
export type ReportRecord = {
  id: string;
  originalId: string;
  userId: string;
  shareId: string;
  accountId: string;
  accountName: string;
  accountLocalId: string | null;
  recipientGameAccount: string;
  businessDate: string;
  submittedAt: string;
  kind: "daily" | "supplement" | "correction";
  version: number;
  latestVersion?: number;
  status: "recorded" | "pending_review";
  reason: string | null;
  lines: ReportLine[];
  giftTimes: Count;
  receivedHearts: number;
  checks: ("unmatched_period" | "quantity_mismatch")[];
  previous: {
    version: number; kind: ReportRecord["kind"]; status: ReportRecord["status"];
    lines: ReportLine[]; giftTimes: Count; receivedHearts: number;
  } | null;
};

export function requestMessage(error: unknown) {
  return error instanceof RequestError && error.status < 500
    ? error.message : "请求未确认，请检查网络后重试";
}

export function totalHearts(order: AssignedOrder) {
  return order.shares.reduce((sum, share) => sum + share.hearts, 0);
}

export const assignmentStatuses = {
  ready: "未开始",
  active: "进行中",
  review: "待核对",
  waiting: "待协商",
  stopped: "已停送",
  done: "份额已完成",
} as const;

export function assignmentStatus(order: AssignmentRow): keyof typeof assignmentStatuses {
  if (isGiftAssignment(order)) {
    const p = order.giftProgress;
    if (p.stopped) return "stopped";
    if (p.reportSyncPending || Number(p.excessGiftTimes) > 0 || Number(p.pendingPromotionalGiftTimes) > 0) return "review";
    if (!p.remainingGiftTimes) return "done";
    if (!p.canSubmitDaily) return "waiting";
    return p.deliveredGiftTimes || Number(p.observedGiftTimes) ? "active" : "ready";
  }
  const delivery = order.delivery;
  if (delivery?.myStoppedHearts) return "stopped";
  if (delivery?.myPendingReports || delivery?.myReportSyncPending || Number(delivery?.myExcessHearts) > 0) return "review";
  if (delivery?.myRemainingHearts === 0) return "done";
  if (delivery?.holdReason) return "waiting";
  return delivery?.myObservedHearts || delivery?.myGiftTimes ? "active" : "ready";
}

export function scheduleLabel({ startDate, endDate }: ScheduleDates) {
  if (!startDate || !endDate) return "未排期";
  return startDate === endDate ? startDate : `${startDate} 至 ${endDate}`;
}
