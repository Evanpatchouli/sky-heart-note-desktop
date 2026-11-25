import type { OrderTermination, TerminationReview } from '@sky-club/common';
import type { ClubOrder } from './club-order.schema';
import type { StoredPriceAdjustment } from './club-price-adjustment';
import { deliveryTarget } from './club-order-pricing';

export type TerminationRequest = { id: string; hash: string };
export type StoredTermination = Omit<OrderTermination, 'review' | 'refundDueCents' | 'refundedCents' | 'refundRemainingCents' | 'netReceivedCents'> & {
  customerUserId?: string;
  adjustmentId?: string;
  reviewAtStop: TerminationReview[];
  requests: TerminationRequest[];
  customerRequestReference?: string;
  priorPostingReference?: string;
  priorPostingReason?: string;
};

export function deliveryStoppedAt(order: ClubOrder) {
  return order.termination?.stoppedAt ?? (
    order.priceAdjustment?.decision?.value === 'decline' ? order.priceAdjustment.decision.recordedAt : undefined
  );
}

export function originalPricesBySegment(order: ClubOrder) {
  const prices = (order.receipt?.quote.segments ?? order.dispatchPricing?.segments ?? []).map(({ unitPriceCents }) => unitPriceCents);
  const applied = [
    ...(order.priceAdjustmentHistory ?? []),
    ...(order.priceAdjustment?.state === 'continuing' ? [order.priceAdjustment] : []),
  ];
  for (const { shift } of applied) prices.push(prices[shift.quoteSegment - 1]);
  return prices;
}

export function declineTermination(order: ClubOrder, adjustment: StoredPriceAdjustment): StoredTermination {
  const originalPrices = originalPricesBySegment(order);
  const segments = adjustment.basis.proposal.lines
    .filter((line) => line.shiftedHearts === 0)
    .map((line, index) => {
      const unfulfilledHearts = line.assumedHearts + (
        index === adjustment.shift.quoteSegment - 1 ? adjustment.shift.hearts : 0
      );
      return {
        number: index + 1,
        period: line.period,
        plannedHearts: line.recordedHearts + unfulfilledHearts,
        observedHearts: line.recordedHearts,
        unfulfilledHearts,
        originalUnitPriceCents: originalPrices[index] ?? line.unitPriceCents,
        effectiveUnitPriceCents: line.unitPriceCents,
      };
    });
  const originalUnfulfilledCents = segments.reduce(
    (sum, segment) => sum + segment.unfulfilledHearts * segment.originalUnitPriceCents, 0,
  );
  return {
    id: adjustment.id,
    adjustmentId: adjustment.id,
    revision: adjustment.revision,
    origin: 'declined_adjustment',
    stoppedAt: adjustment.decision!.recordedAt,
    reason: adjustment.reason,
    customerUserId: adjustment.customerUserId,
    observedHearts: adjustment.observedHearts,
    stoppedHearts: deliveryTarget(order) - adjustment.observedHearts,
    originalReceivedCents: adjustment.originalReceivedCents,
    supplementReceivedCents: adjustment.previouslyReceivedCents - adjustment.originalReceivedCents,
    originalUnfulfilledCents,
    supplementUnfulfilledCents: adjustment.refundIfDeclinedCents - originalUnfulfilledCents,
    receiptRevision: adjustment.quoteRevision,
    fulfillmentRevision: adjustment.basis.fulfillmentRevision,
    segments,
    reviewAtStop: [],
    // A historical single payment stays on its original adjustment document.
    refunds: adjustment.refund ? [{ ...adjustment.refund, id: adjustment.requests.at(-1)?.id ?? adjustment.id }] : [],
    requests: [],
  };
}

export function storedTermination(order: ClubOrder) {
  if (order.termination) return order.termination;
  const change = order.priceAdjustment;
  if (change?.decision?.value === 'decline') return declineTermination(order, change);
}

export function terminationView(order: ClubOrder, lateReports = false): OrderTermination | undefined {
  const record = storedTermination(order);
  if (!record) return;
  const { customerUserId, customerRequestReference, priorPostingReference, priorPostingReason, adjustmentId, reviewAtStop, requests, ...view } = record;
  const review = new Set(reviewAtStop);
  const change = view.change;
  const bound = order.customerLinkStatus === 'verified' && !!order.customerUserId;
  if (!bound) review.add('customer_not_linked');
  if (priorPostingReference) review.add('previous_posting_pending');
  if (lateReports) review.add('late_reports_pending');
  if (view.origin !== 'declined_adjustment') {
    if (!change) review.add('plan_pending');
    if (change?.heartRule === 'pending_review') review.add('heart_terms_pending');
  }
  if (change && !change.customerConfirmedAt) review.add('customer_confirmation_pending');
  const refundAgreed = view.origin === 'declined_adjustment' || (
    bound && change?.customerConfirmedAt && change.heartRule === 'original_paid'
  );
  const refundDueCents = refundAgreed && view.originalUnfulfilledCents !== null && view.supplementUnfulfilledCents !== null
    ? view.originalUnfulfilledCents + view.supplementUnfulfilledCents
    : null;
  const refundedCents = view.refunds.reduce((sum, { amountCents }) => sum + amountCents, 0);
  return {
    ...view,
    refundDueCents,
    refundedCents,
    refundRemainingCents: refundDueCents === null ? null : refundDueCents - refundedCents,
    netReceivedCents: view.originalReceivedCents === null ? null : view.originalReceivedCents + view.supplementReceivedCents - refundedCents,
    review: [...review],
  };
}

export function dispatchTerminationView(order: ClubOrder, lateReports = false) {
  const view = terminationView(order, lateReports);
  if (!view) return;
  return {
    ...view,
    customerRequestReference: order.termination?.customerRequestReference,
    priorPostingReference: order.termination?.priorPostingReference,
    priorPostingReason: order.termination?.priorPostingReason,
  };
}
