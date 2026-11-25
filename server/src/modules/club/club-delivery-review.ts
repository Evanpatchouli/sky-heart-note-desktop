import {
  calculateQuoteAmounts,
  PRICING_PERIODS,
  quoteHeartCounts,
  type DeliveryPeriodBreakdown,
  type DeliveryPeriodShift,
  type DeliveryPriceComparison,
  type DeliveryPriceIssue,
  type ObservedDeliveryPeriod,
  type OrderFulfillment,
} from '@sky-club/common';
import type { Types } from 'mongoose';
import { jsonCount, quotedDeliverySegments, type ShareDelivery } from './club-delivery';
import { deliveryTarget, publishedQuoteMatchesReceipt } from './club-order-pricing';
import type { ClubOrder } from './club-order.schema';
import { effectivePriceSegments, priceAdjustmentView } from './club-price-adjustment';

export type DeliveryPeriodRow = {
  _id: {
    shareId: Types.ObjectId;
    period: ObservedDeliveryPeriod;
    quoteSegment: number | null;
  } | null;
  hearts: Types.Decimal128;
  times: Types.Decimal128;
  mismatch: boolean;
};

type Tally = { hearts: bigint; times: bigint };
const empty = (): Tally => ({ hearts: 0n, times: 0n });

function add(total: Tally, entry: Tally) {
  total.hearts += entry.hearts;
  total.times += entry.times;
}

function observed(total: Tally) {
  return { receivedHearts: jsonCount(total.hearts), giftTimes: jsonCount(total.times) };
}

export function summarizeDeliveryPeriods(
  order: ClubOrder,
  rows: readonly DeliveryPeriodRow[],
  userId?: string,
) {
  const quote = quotedDeliverySegments(order);
  const shares = new Map(order.shares.map((share) => [share._id.toHexString(), share]));
  const shareTotals = new Map<string, Tally>();
  const periods = { normal: empty(), double: empty(), unconfirmed: empty() };
  const links = new Map<string, Tally & {
    period: ObservedDeliveryPeriod;
    quoteSegment: number | null;
    matchesQuote: boolean;
    adjusted?: true;
  }>();
  const segments = quote.map(empty);
  const orderSegments = quote.map(empty);
  const issues = new Set<DeliveryPriceIssue>();
  for (const row of rows) {
    if (!row._id) {
      issues.add('pending_reports');
      continue;
    }
    const { shareId, period, quoteSegment } = row._id;
    const id = shareId.toHexString();
    const share = shares.get(id);
    if (!share) continue;
    const tally = { hearts: BigInt(row.hearts.toString()), times: BigInt(row.times.toString()) };
    const shareTotal = shareTotals.get(id) ?? empty();
    add(shareTotal, tally);
    shareTotals.set(id, shareTotal);
    const index = (quoteSegment ?? 0) - 1;
    const matched = quote[index]?.period === period;
    if (matched) add(orderSegments[index], tally);
    if (userId && share.userId !== userId) continue;
    add(periods[period], tally);
    if (row.mismatch) issues.add('quantity_mismatch');
    if (matched) add(segments[index], tally);
    else issues.add('unmatched_period');
    const key = `${period}:${quoteSegment}`;
    const link = links.get(key) ?? {
      period, quoteSegment, matchesQuote: matched,
      ...(matched && quote[index].adjusted ? { adjusted: true as const } : {}),
      ...empty(),
    };
    add(link, tally);
    links.set(key, link);
  }
  const totals: ShareDelivery[] = [];
  for (const [id, { hearts, times }] of shareTotals) {
    const share = shares.get(id)!;
    if (hearts > BigInt(share.hearts)) issues.add('excess_delivery');
    totals.push({
      _id: { orderId: order._id, shareId: share._id },
      receivedHearts: hearts,
      giftTimes: times,
    });
  }
  const breakdown: DeliveryPeriodBreakdown = {
    periods: ([...PRICING_PERIODS, 'unconfirmed'] as const).map((period) => ({
      period,
      ...observed(periods[period]),
    })),
    links: [...links.values()]
      .sort((a, b) => a.period.localeCompare(b.period) || (a.quoteSegment ?? 0) - (b.quoteSegment ?? 0))
      .map(({ period, quoteSegment, matchesQuote, adjusted, ...total }) => ({
        period, quoteSegment, matchesQuote, ...(adjusted ? { adjusted } : {}), ...observed(total),
      })),
    segments: quote.map(({ number, period, hearts, paidHearts, giftHearts, adjusted }, index) => ({
      number, period, plannedHearts: hearts,
      ...(giftHearts ? { paidHearts, giftHearts } : {}),
      ...(adjusted ? { adjusted } : {}),
      ...observed(segments[index]),
      pendingHearts: userId ? null : Number(BigInt(hearts) > segments[index].hearts
        ? BigInt(hearts) - segments[index].hearts : 0n),
    })),
  };
  const segmentsOverPlan = quote
    .filter(({ number, hearts }) => orderSegments[number - 1].hearts > BigInt(hearts))
    .map(({ number }) => number);
  return { totals, breakdown, issues, segmentsOverPlan };
}

export function compareDeliveryPrice(
  order: ClubOrder,
  progress: OrderFulfillment,
  review: ReturnType<typeof summarizeDeliveryPeriods>,
  options: { through?: string; shift?: DeliveryPeriodShift } = {},
): DeliveryPriceComparison {
  const issues = new Set(review.issues);
  const { dispatchPricing: pricing, receipt } = order;
  const quote = pricing && calculateQuoteAmounts(
    pricing.segments, pricing.discountedHeartsAmountCents,
  );
  const counts = pricing && quoteHeartCounts(pricing.segments);
  const original = order.publishedAt && pricing && quote && counts?.paidHearts === order.heartDelivery.requestedHearts ? {
    quoteRevision: pricing.revision,
    ruleVersion: pricing.version,
    heartsCents: quote.heartsAmountCents,
    totalCents: quote.totalAmountCents,
    receivedCents: receipt?.receivedAmountCents ?? null,
    segmentPrices: pricing.segments.map(({ unitPriceCents }) => unitPriceCents),
  } : null;

  if (!original || !pricing || !quote || !publishedQuoteMatchesReceipt(receipt, pricing, quote))
    issues.add('quote_unavailable');
  if (original && receipt && receipt.receivedAmountCents !== original.totalCents)
    issues.add('receipt_amount_mismatch');
  if (pricing?.discountedHeartsAmountCents !== undefined ||
      pricing?.segments.some(({ giftHearts }) => !!giftHearts)) issues.add('promotion_allocation');
  if (options.through) issues.add('historical_view');
  if (order.termination || (order.priceAdjustment && order.priceAdjustment.state !== 'continuing')) issues.add('formal_adjustment_recorded');
  if (progress.remainingHearts && review.segmentsOverPlan.length) issues.add('segment_over_plan');

  const canPreviewRemaining = !issues.size && progress.remainingHearts > 0;
  const result = (proposal: DeliveryPriceComparison['proposal'] = null): DeliveryPriceComparison => ({
    original, issues: [...issues].sort(), canPreviewRemaining, proposal,
  });
  if (progress.remainingHearts && !options.shift) issues.add('incomplete');
  if (issues.size || !original || !pricing) return result();

  const effective = effectivePriceSegments(order, pricing.segments);
  const baselineCents = priceAdjustmentView(order)?.cumulativeReceivedCents ?? original.totalCents;
  const lines = review.breakdown.segments.map((segment) => ({
    quoteSegment: segment.number,
    period: segment.period,
    unitPriceCents: effective[segment.number - 1].unitPriceCents,
    recordedHearts: Number(segment.receivedHearts),
    assumedHearts: options.shift ? (segment.pendingHearts ?? 0) : 0,
    shiftedHearts: 0,
  }));
  if (options.shift) {
    const { quoteSegment, hearts, targetPeriod, targetUnitPriceCents } = options.shift;
    const from = lines[quoteSegment - 1];
    if (!from || from.assumedHearts < hearts) {
      issues.add('shift_exceeds_remaining');
      return result();
    }
    if (from.period === targetPeriod) {
      issues.add('shift_target_unchanged');
      return result();
    }
    from.assumedHearts -= hearts;
    lines.push({
      quoteSegment, period: targetPeriod, unitPriceCents: targetUnitPriceCents,
      recordedHearts: 0, assumedHearts: 0, shiftedHearts: hearts,
    });
    if (lines.some((line) => line.period === 'double' && (line.assumedHearts + line.shiftedHearts) % 2 !== 0)) {
      issues.add('double_quantity_unresolved');
      return result();
    }
  }
  const projected = lines.map(({ period, unitPriceCents, recordedHearts, assumedHearts, shiftedHearts }) => ({
    period, unitPriceCents, hearts: recordedHearts + assumedHearts + shiftedHearts,
  })).filter(({ hearts }) => hearts > 0);
  if (projected.reduce((sum, line) => sum + BigInt(line.hearts), 0n) !== BigInt(deliveryTarget(order))) {
    issues.add('unmatched_period');
    return result();
  }
  const proposed = calculateQuoteAmounts(projected);
  if (!proposed) {
    issues.add('amount_overflow');
    return result();
  }
  return result({
    basis: options.shift ? 'remaining_scenario' : 'recorded_delivery',
    heartsCents: proposed.heartsAmountCents,
    totalCents: proposed.totalAmountCents,
    differenceCents: proposed.totalAmountCents - baselineCents,
    lines,
  });
}
