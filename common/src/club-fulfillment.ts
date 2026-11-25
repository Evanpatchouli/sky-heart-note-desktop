import type { PricingPeriod } from './club-pricing';

export const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type OrderFulfillment = {
  agreedDeadline: string | null;
  observedHearts: number | string;
  creditedHearts: number;
  remainingHearts: number;
  stoppedHearts?: number;
};

export type AgreedReportDay = {
  date: string;
  status: 'not_checked' | 'not_due' | 'missing' | 'pending_review' | 'recorded' | 'stopped';
  reportedAccounts: number;
  observedHearts: number | string;
  supplementPending: boolean;
  correctionPending: boolean;
};

export type ShareFulfillment = {
  id: string;
  userId: string;
  nickname: string | null;
  promisedHearts: number;
  observedHearts: number | string;
  remainingHearts: number;
  stoppedHearts?: number;
  overdue: boolean;
  days: AgreedReportDay[];
};

export type DispatchFulfillment = OrderFulfillment & {
  unclaimedHearts: number;
  originallyUnclaimedHearts?: number;
  overdue: boolean;
  shares: ShareFulfillment[];
  deliveryReview?: DeliveryPeriodBreakdown & { comparison: DeliveryPriceComparison };
  priceAdjustment?: PriceAdjustment;
  priceAdjustmentHistory?: PriceAdjustment[];
  priceAdjustmentReviews?: PriceAdjustmentReviewRecord[];
  termination?: DispatchTermination;
};

type Count = number | string;
export type ObservedDeliveryPeriod = PricingPeriod | 'unconfirmed';
export type PeriodActual = {
  period: ObservedDeliveryPeriod;
  receivedHearts: Count;
  giftTimes: Count;
};

export type DeliveryPeriodBreakdown = {
  periods: PeriodActual[];
  links: (PeriodActual & { quoteSegment: number | null; matchesQuote: boolean; adjusted?: true })[];
  segments: {
    number: number;
    period: PricingPeriod;
    plannedHearts: number;
    paidHearts?: number;
    giftHearts?: number;
    receivedHearts: Count;
    giftTimes: Count;
    pendingHearts: number | null;
    adjusted?: true;
  }[];
};

export type DeliveryPriceIssue =
  | 'quote_unavailable'
  | 'receipt_amount_mismatch'
  | 'incomplete'
  | 'segment_over_plan'
  | 'unmatched_period'
  | 'quantity_mismatch'
  | 'excess_delivery'
  | 'pending_reports'
  | 'promotion_allocation'
  | 'amount_overflow'
  | 'historical_view'
  | 'shift_exceeds_remaining'
  | 'shift_target_unchanged'
  | 'double_quantity_unresolved'
  | 'formal_adjustment_recorded';

export type DeliveryPeriodShift = {
  quoteSegment: number;
  hearts: number;
  targetPeriod: PricingPeriod;
  targetUnitPriceCents: number;
};

export type DeliveryPriceComparison = {
  original: {
    quoteRevision: number;
    ruleVersion: number;
    heartsCents: number;
    totalCents: number;
    receivedCents: number | null;
    segmentPrices: number[];
  } | null;
  issues: DeliveryPriceIssue[];
  canPreviewRemaining: boolean;
  adjustmentReview?: { version: string } | { unavailable: PriceAdjustmentIssue };
  manualReviewVersion?: string;
  proposal: {
    basis: 'recorded_delivery' | 'remaining_scenario';
    heartsCents: number;
    totalCents: number;
    differenceCents: number;
    lines: {
      quoteSegment: number;
      period: PricingPeriod;
      unitPriceCents: number;
      recordedHearts: number;
      assumedHearts: number;
      shiftedHearts: number;
    }[];
  } | null;
};

export type PriceAdjustmentIssue =
  | 'customer_not_linked'
  | 'allocation_unavailable'
  | 'dispatch_withdrawn'
  | 'unverified_quote_or_delivery'
  | 'no_supplement_due'
  | 'adjustment_exists';

export const PRICE_ADJUSTMENT_STATES = [
  'awaiting_customer', 'awaiting_supplement', 'continuing',
  'refund_due', 'refunded',
] as const;

export type PriceAdjustmentState = (typeof PRICE_ADJUSTMENT_STATES)[number];
export const priceAdjustmentStateLabel: Record<PriceAdjustmentState, string> = {
  awaiting_customer: '暂停送心，待客户答复',
  awaiting_supplement: '客户已同意，待登记实补',
  continuing: '实际补款已登记，可以续送',
  refund_due: '已停送，待登记实际退款',
  refunded: '已停送，实际退款已登记',
};

export type PriceAdjustmentDecision = 'accept' | 'decline';

export type AdjustmentPayment = {
  amountCents: number;
  occurredAt: string;
  recordedAt: string;
  recordedByUserId: string;
};

export const terminationReviewLabel = {
  customer_not_linked: '客户平台归属待核对',
  heart_terms_pending: '未履约心款退法待双方核对',
  plan_pending: '派单人待登记变更及退款依据',
  customer_confirmation_pending: '客户待确认本单退款约定',
  delivery_basis_pending: '收款、原计价段或实绩依据待核对',
  late_reports_pending: '有补报或更正待核对',
  activity_pending: '买赠资格或折扣重算待核对',
  previous_posting_pending: '已有入账及冲正处理待核对',
} as const;

export type TerminationReview = keyof typeof terminationReviewLabel;
export type TerminationHeartRule = 'original_paid' | 'pending_review';

export type TerminationChange = {
  reason: string;
  heartRule: TerminationHeartRule;
  recordedAt: string;
  recordedByUserId: string;
  customerConfirmedAt?: string;
  customerConfirmedByUserId?: string;
};

export type OrderTermination = {
  id: string;
  revision: number;
  origin: 'customer_request' | 'reported_customer_request' | 'declined_adjustment';
  stoppedAt: string;
  reason: string;
  observedHearts: OrderFulfillment['observedHearts'];
  stoppedHearts: number;
  originalReceivedCents: number | null;
  supplementReceivedCents: number;
  originalUnfulfilledCents: number | null;
  supplementUnfulfilledCents: number | null;
  refundDueCents: number | null;
  refundedCents: number;
  refundRemainingCents: number | null;
  netReceivedCents: number | null;
  refunds: (AdjustmentPayment & { id: string })[];
  review: TerminationReview[];
  change?: TerminationChange;
  changeHistory?: TerminationChange[];
  receiptRevision: number | null;
  fulfillmentRevision: number | null;
  segments: {
    number: number;
    period: PricingPeriod;
    plannedHearts: number;
    observedHearts: Count;
    unfulfilledHearts: number;
    originalUnitPriceCents: number;
    effectiveUnitPriceCents: number;
  }[];
};

export type DispatchTermination = OrderTermination & {
  customerRequestReference?: string;
  priorPostingReference?: string;
  priorPostingReason?: string;
};

export type PriceAdjustment = {
  id: string;
  revision: number;
  state: PriceAdjustmentState;
  reason: string;
  shift: DeliveryPeriodShift;
  originalPeriod: PricingPeriod;
  originalUnitPriceCents: number;
  continuationSegment: number;
  quoteRevision: number;
  ruleVersion: number;
  originalReceivedCents: number;
  proposedTotalCents: number;
  differenceCents: number;
  observedHearts: number;
  refundIfDeclinedCents: number;
  refundDueCents: number;
  submittedByUserId: string;
  submittedAt: string;
  decision?: {
    value: PriceAdjustmentDecision;
    userId: string;
    recordedAt: string;
  };
  supplement?: AdjustmentPayment;
  refund?: AdjustmentPayment;
  refundPaidCents?: number;
  cumulativeReceivedCents: number;
  netReceivedCents: number;
  calculation: NonNullable<DeliveryPriceComparison['proposal']>;
};

export type PriceAdjustmentReviewRecord = {
  id: string;
  reason: string;
  shift?: DeliveryPeriodShift;
  original: NonNullable<DeliveryPriceComparison['original']>;
  proposal: DeliveryPriceComparison['proposal'];
  issues: DeliveryPriceIssue[];
  observedHearts: OrderFulfillment['observedHearts'];
  remainingHearts: number;
  submittedAt: string;
  submittedByUserId: string;
};
