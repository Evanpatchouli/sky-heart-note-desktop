import type { PriceAdjustment, PriceAdjustmentReviewRecord, PriceSegment } from '@sky-club/common';
import type { ClubOrder } from './club-order.schema';
import { terminationView } from './club-termination';

export type StoredPriceAdjustment = Omit<
  PriceAdjustment,
  'refundDueCents' | 'cumulativeReceivedCents' | 'netReceivedCents' | 'calculation'
> & {
  customerUserId: string;
  previouslyReceivedCents: number;
  basis: {
    fulfillmentRevision: number;
    proposal: PriceAdjustment['calculation'];
  };
  requests: { id: string; hash: string }[];
};

export type StoredPriceAdjustmentReview = PriceAdjustmentReviewRecord & {
  requestId: string;
  requestHash: string;
  fulfillmentRevision: number;
};

export function priceAdjustmentReviewView({ requestId, requestHash, fulfillmentRevision, ...view }: StoredPriceAdjustmentReview) {
  return view;
}

export function priceAdjustmentReviewsView(order: ClubOrder) {
  return order.priceAdjustmentReviews?.map(priceAdjustmentReviewView);
}

export function priceAdjustmentView(order: ClubOrder, adjustment = order.priceAdjustment): PriceAdjustment | undefined {
  if (!adjustment) return;
  const { requests, basis, customerUserId, previouslyReceivedCents, ...view } = adjustment;
  const termination = view.decision?.value === 'decline' && order.priceAdjustment?.id === view.id ? terminationView(order) : undefined;
  const cumulativeReceivedCents = previouslyReceivedCents + (view.supplement?.amountCents ?? 0);
  const activeRefund = termination?.refunds.at(-1);
  const paid = termination?.refundedCents ?? view.refund?.amountCents ?? 0;
  return {
    ...view,
    refundDueCents: view.decision?.value === 'decline' ? view.refundIfDeclinedCents : 0,
    ...(termination ? { refundPaidCents: paid } : {}),
    ...(activeRefund ? { refund: {
      amountCents: activeRefund.amountCents,
      occurredAt: activeRefund.occurredAt,
      recordedAt: activeRefund.recordedAt,
      recordedByUserId: activeRefund.recordedByUserId,
    } } : {}),
    cumulativeReceivedCents,
    netReceivedCents: cumulativeReceivedCents - paid,
    calculation: basis.proposal,
  };
}

export function adjustmentDeliveryHold(order: ClubOrder) {
  if (order.termination && order.termination.origin !== 'declined_adjustment') return '客户已要求终止，本单已停送';
  switch (order.priceAdjustment?.state) {
    case 'awaiting_customer': return '跨期改价待客户答复，当前暂停领取和送心';
    case 'awaiting_supplement': return '客户已同意改价，登记实际补款后可继续领取和送心';
    case 'refund_due':
    case 'refunded': return '客户已拒绝补差，本单已暂停领取和送心';
  }
}

export function effectivePriceSegments(order: ClubOrder, segments: readonly PriceSegment[]) {
  const applied = [
    ...(order.priceAdjustmentHistory ?? []),
    ...(order.priceAdjustment?.state === 'continuing' ? [order.priceAdjustment] : []),
  ];
  if (!applied.length) return segments;
  const effective = [...segments];
  for (const { shift } of applied) {
    const source = effective[shift.quoteSegment - 1];
    effective[shift.quoteSegment - 1] = { ...source, hearts: source.hearts - shift.hearts };
    effective.push({ period: shift.targetPeriod, hearts: shift.hearts, unitPriceCents: shift.targetUnitPriceCents });
  }
  return effective;
}

export function priceAdjustmentHistoryView(order: ClubOrder) {
  return order.priceAdjustmentHistory?.map((adjustment) => priceAdjustmentView(order, adjustment)!);
}
