import type { CustomerGiftTermination, GiftPricePayment, GiftTermination, GiftTerminationChange } from '@webapp-template/common';
import { giftPaidAmounts, giftPriceSegments } from './club-gift-price-basis';
import type { ClubOrder } from './club-order.schema';

export type GiftTerminationRequest = { id: string; hash: string };

export type StoredGiftTermination = Pick<GiftTermination, 'id' | 'stoppedAt' | 'reason' | 'customerRequestReference'> & {
  origin: 'customer_request' | 'reported_customer_request';
  change?: GiftTerminationChange;
  refunds: GiftPricePayment[];
  requests: GiftTerminationRequest[];
};

export function customerGiftTermination({ customerRequestReference: _evidence, change, refunds, ...summary }: GiftTermination): CustomerGiftTermination {
  return {
    ...summary, ...(change ? { change: { reason: change.reason } } : {}),
    refunds: refunds.map(({ amountCents, occurredAt }) => ({ amountCents, occurredAt })),
  };
}

export function giftTerminationView(order: ClubOrder, deliveredBySegment: ReadonlyMap<number, number>): GiftTermination | undefined {
  const stop = order.giftTermination;
  const refused = order.giftPriceAdjustmentState === 'stopped' ? order.giftPriceAdjustments?.at(-1) : undefined;
  const receipt = order.receipt;
  if ((!stop && !refused?.decision) || !receipt) return undefined;

  const sums = {
    deliveredGiftTimes: 0, stoppedPaidGiftTimes: 0, stoppedPromotionalGiftTimes: 0,
    fulfilledServiceCents: 0, fulfilledPersonalDiscountCents: 0, fulfilledPlatformDiscountCents: 0, refundDueCents: 0,
  };
  for (const [index, basis] of giftPriceSegments(order).entries()) {
    const sent = deliveredBySegment.get(index) ?? 0;
    sums.deliveredGiftTimes += sent;
    if (basis.segment.promotionalGiftTimes) {
      sums.stoppedPromotionalGiftTimes += basis.segment.promotionalGiftTimes - sent;
      continue;
    }
    const contracted = basis.segment.paidGiftTimes;
    const fulfilled = giftPaidAmounts(basis, 0, sent);
    sums.stoppedPaidGiftTimes += contracted - sent;
    sums.fulfilledServiceCents += fulfilled.serviceCents;
    sums.fulfilledPersonalDiscountCents += fulfilled.personalDiscountCents;
    sums.fulfilledPlatformDiscountCents += fulfilled.platformDiscountCents;
    sums.refundDueCents += giftPaidAmounts(basis, sent, contracted).serviceCents;
  }
  const refunds = stop?.refunds ?? refused!.payments.filter(payment => payment.kind === 'refund');
  const originalReceivedCents = receipt.receivedAmountCents;
  const continuationReceivedCents = (order.continuationQuotes ?? []).reduce((sum, next) =>
    sum + (next.receipt?.receivedAmountCents ?? 0), 0);
  const supplementReceivedCents = (order.giftPriceAdjustments ?? []).reduce((sum, amendment) =>
    sum + amendment.payments.reduce((total, payment) => total + (payment.kind === 'supplement' ? payment.amountCents : 0), 0), 0);
  const refundedCents = refunds.reduce((sum, payment) => sum + payment.amountCents, 0);
  const identity = stop ? {
    id: stop.id, revision: order.fulfillmentRevision ?? 0, origin: stop.origin, stoppedAt: stop.stoppedAt,
    reason: stop.reason, customerRequestReference: stop.customerRequestReference, change: stop.change,
  } : {
    id: refused!.id, revision: refused!.revision, origin: 'declined_adjustment' as const,
    stoppedAt: refused!.decision!.recordedAt, reason: refused!.reason,
  };
  return {
    ...identity, ...sums, stoppedGiftTimes: sums.stoppedPaidGiftTimes + sums.stoppedPromotionalGiftTimes,
    originalReceivedCents, continuationReceivedCents, supplementReceivedCents, refundedCents, refunds,
    refundRemainingCents: Math.max(0, sums.refundDueCents - refundedCents),
    excessRefundCents: Math.max(0, refundedCents - sums.refundDueCents),
    netReceivedCents: originalReceivedCents + continuationReceivedCents + supplementReceivedCents - refundedCents,
    ...(receipt.quote.promotions?.platform?.couponId ? {
      couponStatus: order.promotionCouponReturnedAt ? 'returned' : 'used',
      couponReturnedAt: order.promotionCouponReturnedAt,
    } : {}),
  };
}
