import { quoteHeartCounts, type OrderPricing, type PendingQuoteActivity, type QuoteAmounts } from '@webapp-template/common';
import type { ClubOrder } from './club-order.schema';

type OrderQuote = Pick<ClubOrder, 'heartDelivery' | 'pricing' | 'dispatchPricing' | 'receipt'>;

export function pendingQuoteActivity(pricing?: OrderPricing): PendingQuoteActivity | null {
  const proposed = pricing?.discountedHeartsAmountCents;
  return proposed !== undefined && pricing?.segments.some(({ giftHearts }) => giftHearts)
    ? { reason: 'stacking_pending', proposedDiscountedHeartsAmountCents: proposed }
    : null;
}

export function deliveryTarget(order: OrderQuote) {
  const requested = order.heartDelivery.requestedHearts ?? 0;
  const quote = order.receipt?.quote ?? order.dispatchPricing ??
    (pendingQuoteActivity(order.pricing) ? undefined : order.pricing);
  const counts = quote && quoteHeartCounts(quote.segments);
  return counts && counts.paidHearts === requested ? counts.fulfillmentHearts : requested;
}

export function activityQuantities(order: OrderQuote) {
  if (order.heartDelivery.requestedHearts === undefined) return {};
  const fulfillmentHearts = deliveryTarget(order);
  const giftHearts = fulfillmentHearts - order.heartDelivery.requestedHearts;
  return giftHearts > 0 ? { fulfillmentHearts, giftHearts } : {};
}

export function publishedQuoteMatchesReceipt(
  receipt: ClubOrder['receipt'],
  pricing: OrderPricing,
  quote: QuoteAmounts,
) {
  return (
    receipt &&
    receipt.quote.revision === pricing.revision &&
    receipt.quote.totalAmountCents === quote.totalAmountCents &&
    receipt.quote.heartsAmountCents === quote.heartsAmountCents &&
    receipt.quote.originalHeartsAmountCents === quote.originalHeartsAmountCents &&
    receipt.quote.segments.length === pricing.segments.length &&
    receipt.quote.segments.every(
      (item, index) =>
        item.period === pricing.segments[index].period &&
        item.hearts === pricing.segments[index].hearts &&
        (item.giftHearts ?? 0) === (pricing.segments[index].giftHearts ?? 0) &&
        item.unitPriceCents === pricing.segments[index].unitPriceCents,
    )
  );
}
