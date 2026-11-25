import type { GiftPriceAdjustment } from './club-gift-price-adjustment';
import type { CustomerGiftTermination, GiftTermination } from './club-gift-termination';
import type { GiftPerformance, GiftShareProgress } from './club-gift-delivery';
import type { ContinuationQuote, CustomerQuote, DispatchPricing, GiftPriceSegment } from './club-pricing';

export const giftSettlementStatusLabel = {
  in_progress: '履约中',
  review_required: '待核对',
  ready_to_close: '待结单',
  closed: '已结单',
} as const;

export const giftSettlementIssueLabel = {
  missing_publication: '缺少有效的派发计价依据',
  receipt_mismatch: '实收或计价段与确认报价待核对',
  invalid_fulfillment: '份额、计价段或日报归属待核对',
  promotion_pending: '有促销赠送实绩尚不符合付费次数先送的条件',
  price_adjustment_pending: '改价待答复、登记实补或重新报价',
  continuation_payment_pending: '老板已确认续段，实收待登记',
  refund_pending: '实际退款与停送应退金额不符',
  negative_reward: '部分计价段扣抽后的送心报酬为负',
  amount_overflow: '金额超出可记录的整分范围',
  unreconciled: '分配合计与客户侧款项不符',
  adjustment_invalid: '已生效的额外调整缺少可核对的记录',
} as const;

export type GiftSettlementStatus = keyof typeof giftSettlementStatusLabel;
export type GiftSettlementIssue = keyof typeof giftSettlementIssueLabel;

export interface GiftSettlementReference {
  id: string;
  version: number;
  calculatedAt: string;
}

export interface GiftSettlementCash {
  originalReceivedCents: number;
  continuationReceivedCents: number;
  supplementReceivedCents: number;
  refundDueCents: number | null;
  refundedCents: number | null;
  refundRemainingCents: number | null;
  excessRefundCents: number | null;
  netReceivedCents: number | null;
  compensationRefundDueCents?: number | null;
  compensationRefundedCents?: number | null;
  compensationRefundRemainingCents?: number | null;
}

export interface GiftSettlementAmounts {
  grossCents: number | null;
  dispatchFeeCents: number | null;
  clubFeeCents: number | null;
  rewardCents: number | null;
  personalDiscountCents: number | null;
  platformDiscountCents: number | null;
  promotionalGiftCostCents: number | null;
  dispatchNetCents: number | null;
  clubNetCents: number | null;
  allocatedCents: number | null;
  customerCompensationCents?: number | null;
  compensationCashCorrectionCents?: number;
  memberPenaltyCents?: number | null;
  memberNetCents?: number | null;
}

export interface GiftSettlementAdjustment {
  id: string;
  revision: number;
  kind: 'customer_compensation' | 'member_penalty';
  status: 'pending' | 'approved' | 'rejected';
  amountCents: number;
  reason: string;
  requestedByUserId: string;
  createdAt: string;
  decidedByUserId?: string;
  decidedAt?: string;
  decisionReason?: string;
  memberUserId?: string;
  penaltyPosting?: 'awaiting_close' | 'posted' | 'not_in_settlement';
  refunds: { requestId: string; amountCents: number; occurredAt: string; recordedAt: string; recordedByUserId: string; evidence?: string }[];
}

export type PersonalGiftPenalty = Pick<GiftSettlementAdjustment, 'id' | 'amountCents' | 'reason' | 'decidedAt'>;

export interface GiftSettlementProgress extends GiftPerformance,
  Pick<GiftShareProgress, 'actualReceivedHearts' | 'knownReceivedHearts' | 'knownReceivedLines' | 'unknownReceivedLines'> {
  deliveredGiftTimes: number;
  agreedGiftTimes: number;
}

export interface GiftSettlementMemberSegment extends GiftSettlementProgress {
  segmentIndex: number;
  unitPriceCents: number;
  plannedRewardCents: number | null;
  grossCents: number | null;
  dispatchFeeCents: number | null;
  clubFeeCents: number | null;
  rewardCents: number | null;
}

export interface GiftSettlementMember extends GiftSettlementProgress {
  userId: string;
  plannedRewardCents: number | null;
  rewardCents: number | null;
  penaltyCents?: number | null;
  netRewardCents?: number | null;
  penalties?: PersonalGiftPenalty[];
  segments: GiftSettlementMemberSegment[];
}

export interface GiftSettlementSegment extends GiftSettlementProgress {
  segmentIndex: number;
  quote: GiftPriceSegment;
  unclaimedGiftTimes: number;
  planned: GiftSettlementAmounts;
  totals: GiftSettlementAmounts;
}

export interface GiftSettlementReport {
  id: string;
  originalId: string;
  version: number;
  effective: boolean;
  userId: string;
  shareId: string;
  accountId: string;
  accountName: string;
  businessDate: string;
  submittedAt: string;
  kind: 'daily' | 'supplement' | 'correction';
  reason: string | null;
  lines: {
    shareId: string;
    period: 'normal' | 'double' | 'unconfirmed';
    giftTimes: number;
    receivedHearts: number | null;
    promotionPaidSegmentIndices?: number[];
  }[];
}

export interface GiftSettlementRow {
  priceUnit: 'gift_times';
  orderId: string;
  source: 'direct_dispatch' | 'client_order';
  publishedAt: string | null;
  agreedGiftTimes: number;
  status: GiftSettlementStatus;
  finalCalculation: GiftSettlementReference | null;
  close?: GiftSettlementClose;
}

export interface GiftSettlementClose {
  status: 'closed';
  closedAt: string;
  closedByUserId: string;
  requestId: string;
  calculationId: string;
  calculationVersion: number;
}

export interface GiftSettlementCalculation extends GiftSettlementProgress, Omit<GiftSettlementRow, 'finalCalculation'> {
  clubId: string;
  dispatcherUserId: string;
  publicationId: string | null;
  pricing: DispatchPricing | null;
  receipt: {
    requestId: string;
    receivedAt: string;
    recordedAt: string;
    receivedByUserId: string;
    recordedByUserId: string;
    receivedAmountCents: number;
    quote: CustomerQuote;
  } | null;
  continuations: (Omit<ContinuationQuote, 'receipt'> & {
    receipt?: NonNullable<ContinuationQuote['receipt']> & { requestId: string; recordedAt: string; recordedByUserId: string };
  })[];
  priceAdjustments: GiftPriceAdjustment[];
  adjustments?: GiftSettlementAdjustment[];
  termination: GiftTermination | null;
  stopped: boolean;
  unclaimedGiftTimes: number;
  cash: GiftSettlementCash | null;
  members: GiftSettlementMember[];
  segments: GiftSettlementSegment[];
  shares: { id: string; userId: string; segmentIndex: number; originalGiftTimes: number; transferredGiftTimes: number; netGiftTimes: number }[];
  reports: GiftSettlementReport[];
  issues: GiftSettlementIssue[];
  planned: GiftSettlementAmounts;
  totals: GiftSettlementAmounts & { differenceCents: number | null };
}

export interface AdminGiftSettlement extends GiftSettlementCalculation {
  corrections?: import('./club-settlement-corrections').SettlementCorrection[];
  finalCalculation: GiftSettlementReference | null;
  previousCalculation: GiftSettlementReference | null;
  memberNames: Record<string, string>;
}

export interface PersonalGiftSettlement {
  priceUnit: 'gift_times';
  status: GiftSettlementStatus;
  stopped: boolean;
  finalCalculation: GiftSettlementReference | null;
  close?: GiftSettlementClose;
  canClose?: boolean;
  member: (Omit<GiftSettlementMember, 'userId' | 'segments'> & {
    segments: Omit<GiftSettlementMemberSegment, 'grossCents' | 'dispatchFeeCents' | 'clubFeeCents'>[];
  }) | null;
  penalties?: PersonalGiftPenalty[];
  termination?: GiftTermination;
  dispatch: {
    feeCents: number | null;
    personalDiscountCents: number | null;
    netCents: number | null;
    plannedFeeCents: number | null;
    plannedPersonalDiscountCents: number | null;
    plannedNetCents: number | null;
  } | null;
}

export interface CustomerGiftSettlement {
  status: GiftSettlementStatus;
  closedAt?: string;
  cashCorrected?: boolean;
  cash: GiftSettlementCash | null;
  termination?: CustomerGiftTermination;
}
