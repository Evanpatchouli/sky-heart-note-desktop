import {
  giftFulfillmentSegments, giftServiceAmounts,
  type CustomerGiftPriceAdjustment, type GiftPriceAdjustment, type GiftPriceSegment, type QuoteDiscountShare,
} from '@webapp-template/common';
import type { ClubOrder } from './club-order.schema';

export type StoredGiftPriceAdjustment = Omit<GiftPriceAdjustment,
  'originalReceivedCents' | 'cumulativeReceivedCents' | 'supplementReceivedCents' |
  'refundDueCents' | 'refundedCents' | 'netReceivedCents'> & {
  requests: { id: string; hash: string }[];
  earliestBusinessDate?: string;
  holdStartedAt?: string;
};

type PaidRange = { discount: QuoteDiscountShare; from: number };
type SegmentBasis = { segment: GiftPriceSegment; paid?: PaidRange };

function undiscounted(segment: GiftPriceSegment): QuoteDiscountShare {
  return { ...segment, platformDiscountCents: 0, personalDiscountCents: 0 };
}

export function giftPriceSegments(order: ClubOrder) {
  const quote = order.receipt?.quote ?? order.dispatchPricing;
  const initial = giftFulfillmentSegments(quote?.giftSegments ?? [], quote?.promotions);
  const segments: SegmentBasis[] = initial.map((segment, idx) => ({
    segment, ...(segment.paidGiftTimes && {
      paid: { discount: order.receipt?.quote.promotions?.segmentDiscounts[idx] ?? undiscounted(segment), from: 0 },
    }),
  }));
  for (const next of order.continuationQuotes ?? []) {
    if (next.receipt && next.segmentIndex !== undefined) {
      const segment = { ...next.segment };
      segments[next.segmentIndex] = { segment, paid: { discount: undiscounted(segment), from: 0 } };
    }
  }
  for (const amendment of order.giftPriceAdjustments ?? []) {
    if (!amendment.newQuoteSegment) continue;
    const change = amendment.preview;
    const source = segments[change.quoteSegment - 1];
    const paid = source.paid!;
    const left = source.segment.paidGiftTimes - change.giftTimes;
    const moved = {
      ...source.segment, paidGiftTimes: change.giftTimes, period: change.targetPeriod,
      unitPriceCents: change.targetUnitPriceCents, dailyGiftTimes: Math.min(source.segment.dailyGiftTimes, change.giftTimes),
    };
    source.segment = { ...source.segment, paidGiftTimes: left };
    segments[amendment.newQuoteSegment - 1] = {
      segment: moved, paid: { ...paid, from: paid.from + left },
    };
  }
  return segments;
}

export function giftPaidAmounts({ segment, paid }: SegmentBasis, from: number, through: number) {
  if (!paid) return { serviceCents: 0, platformDiscountCents: 0, personalDiscountCents: 0 };
  const original = giftServiceAmounts(paid.discount, paid.from + from, paid.from + through);
  return {
    ...original, serviceCents: original.serviceCents + (through - from) * (segment.unitPriceCents - paid.discount.unitPriceCents),
  };
}

export function giftUnfulfilledAmount(order: ClubOrder, delivered: ReadonlyMap<number, number>) {
  return giftPriceSegments(order).reduce((sum, entry, segmentIndex) => {
    const from = delivered.get(segmentIndex) ?? 0;
    return sum + giftPaidAmounts(entry, from, entry.segment.paidGiftTimes).serviceCents;
  }, 0);
}

export function giftPriceAmendmentView(order: ClubOrder, refundDue?: number) {
  const history = order.giftPriceAdjustments ?? [];
  if (!history.length) return {};
  const originalReceivedCents = order.receipt!.receivedAmountCents;
  const continuationReceivedCents = (order.continuationQuotes ?? []).reduce((sum, next) =>
    sum + (next.receipt?.receivedAmountCents ?? 0), 0);
  let supplementReceivedCents = 0;
  const amendments = history.map(({ requests: _requests, earliestBusinessDate: _earliestBusinessDate, holdStartedAt: _holdStartedAt, ...entry }, index): GiftPriceAdjustment => {
    const supplements = entry.payments.filter(payment => payment.kind === 'supplement');
    supplementReceivedCents += supplements.reduce((sum, item) => sum + item.amountCents, 0);
    const refundedCents = entry.payments.filter(payment => payment.kind === 'refund').reduce((sum, item) => sum + item.amountCents, 0);
    const cumulativeReceivedCents = index === history.length - 1
      ? originalReceivedCents + continuationReceivedCents + supplementReceivedCents
      : entry.preview.cumulativeReceivedCents + supplements.reduce((sum, item) => sum + item.amountCents, 0);
    return {
      ...entry, originalReceivedCents, cumulativeReceivedCents, supplementReceivedCents,
      refundDueCents: entry.state === 'stopped' ? refundDue ?? entry.preview.refundIfDeclinedCents! : 0,
      refundedCents, netReceivedCents: cumulativeReceivedCents - refundedCents,
    };
  });
  return { priceAdjustment: amendments.at(-1)!, priceAdjustmentHistory: amendments.slice(0, -1) };
}

export function customerGiftPriceAdjustment({
  submittedByUserId: _submittedBy, requestId: _request, decision, latestFactChange, resumed: _resumed, payments, ...summary
}: GiftPriceAdjustment): CustomerGiftPriceAdjustment {
  return {
    ...summary,
    ...(decision ? { decision: { source: decision.source, value: decision.value, decidedAt: decision.decidedAt } } : {}),
    ...(latestFactChange ? { latestFactChange: { recordedAt: latestFactChange.recordedAt } } : {}),
    payments: payments.map(({ kind, amountCents, occurredAt }) => ({ kind, amountCents, occurredAt })),
  };
}
