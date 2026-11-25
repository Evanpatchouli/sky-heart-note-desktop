import type { DispatchPricing, OrderReceipt, PricingPeriod } from './club-pricing';
import type { DispatchTermination, PriceAdjustment, PriceAdjustmentReviewRecord } from './club-fulfillment';

export const settlementIssueLabel = {
  missing_publication: '缺少派发时的计价快照',
  receipt_mismatch: '实收与原报价待核对',
  incomplete: '仍有份额未承接或未足量履约',
  invalid_report: '日报归属或汇总与原记录不符',
  pending_report: '有补报或更正待核对',
  unmatched_line: '实绩未匹配适用计价段',
  quantity_mismatch: '赠送次数与到账颗数的差异待核对',
  share_excess: '份额内实绩超过承接量',
  segment_excess: '计价段实绩超过计划量',
  segment_shortfall: '各计价段的实绩与计划量存在差额',
  negative_reward: '部分实绩或预计报酬扣抽后为负数',
  amount_overflow: '金额超出可记录的整数分范围',
  unreconciled: '实收与各项分配未能核平',
  gift_cost_pending: '赠心归属或活动资格待核对',
  discount_cost_pending: '折扣差额承担方待确认',
  price_adjustment_pending: '改价待客户答复或登记实际补款',
  delivery_stopped: '客户拒绝补差，按停送后的实绩和收退款核对',
  refund_pending: '退款待核对或登记实际退回',
  termination_review_pending: '停送或退款仍有待核对事项',
  price_review_pending: '派单人已登记价差原因，金额处理待核对',
} as const;

export type SettlementIssue = keyof typeof settlementIssueLabel;
export type SettlementQuantity = number | string;

export interface SettlementSendAmounts {
  grossCents: number | null;
  dispatchFeeCents: number | null;
  clubFeeCents: number | null;
  rewardCents: number | null;
}

export interface SettlementMember {
  userId: string;
  claimedHearts: SettlementQuantity;
  segments: ({
    number: number;
    receivedHearts: SettlementQuantity;
    giftTimes: SettlementQuantity;
  } & SettlementSendAmounts)[];
  rewardCents: number | null;
  knownSubtotalCents: number | null;
  totalCents: number | null;
  plannedRewardCents: number | null;
  issues: SettlementIssue[];
}

export interface SettlementReportLine {
  period: PricingPeriod | 'unconfirmed';
  quoteSegment: number | null;
  receivedHearts: number;
  giftTimes: number;
  issues: SettlementIssue[];
}

export interface SettlementReport {
  id: string;
  originalId: string;
  version: number;
  userId: string;
  shareId: string;
  accountId: string;
  accountName: string;
  businessDate: string;
  submittedAt: string;
  kind: 'daily' | 'supplement' | 'correction';
  reason: string | null;
  lines: SettlementReportLine[];
}

export interface FinalCalculation {
  id: string;
  version: number;
  calculatedAt: string;
}

export interface SettlementOrderRow {
  orderId: string;
  source: 'direct_dispatch' | 'client_order';
  requestedHearts: number;
  fulfillmentHearts?: number;
  giftHearts?: number;
  publishedAt: string | null;
  finalCalculation: FinalCalculation | null;
}

export interface SettlementCalculation extends Omit<SettlementOrderRow, 'finalCalculation'> {
  clubId: string;
  dispatcherUserId: string;
  publicationId: string | null;
  pricing: DispatchPricing | null;
  receipt: OrderReceipt | null;
  priceAdjustment?: PriceAdjustment;
  priceAdjustmentHistory?: PriceAdjustment[];
  priceAdjustmentReviews?: PriceAdjustmentReviewRecord[];
  termination?: DispatchTermination;
  observedHearts: SettlementQuantity;
  unclaimedHearts: SettlementQuantity;
  originallyUnclaimedHearts?: SettlementQuantity;
  issues: SettlementIssue[];
  members: SettlementMember[];
  shares: { id: string; userId: string; hearts: number }[];
  reports: SettlementReport[];
  activity?:
    | { kind: 'buy_and_gift'; plannedGiftExpenseCents: number; observedGiftHearts: number | null; giftExpenseCents: number | null; clubNetCents: number | null }
    | { kind: 'discount'; discountCents: number };
  totals: SettlementSendAmounts & {
    allocatedCents: number | null;
    differenceCents: number | null;
  };
  planned: SettlementSendAmounts;
}

export interface AdminSettlement extends SettlementCalculation {
  finalCalculation: FinalCalculation | null;
  previousCalculation: FinalCalculation | null;
  memberNames: Record<string, string>;
}

export interface PersonalSettlement {
  stopped?: true;
  finalCalculation: FinalCalculation | null;
  member: (Pick<SettlementMember, 'claimedHearts' | 'rewardCents' | 'knownSubtotalCents' | 'totalCents' | 'plannedRewardCents' | 'issues'> & {
    segments: Pick<SettlementMember['segments'][number], 'number' | 'receivedHearts' | 'giftTimes' | 'rewardCents'>[];
  }) | null;
  dispatch: { feeCents: number | null; plannedFeeCents: number | null; discountCostPending?: true } | null;
}
