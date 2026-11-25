import { ConflictException } from '@nestjs/common';
import { giftFulfillmentSegments, giftSegmentTimes, type DashboardMetric, type DashboardOrderRow } from '@sky-club/common';
import type { DailyReport } from './club-delivery.schema';
import { activeGiftSegments, giftSegmentView } from './club-gift-allocation';
import { addCounts, deliveredGiftTimesBySegment, emptyCounts, factCounts, type GiftDayFact } from './club-gift-delivery';
import { acceptsGiftExecution } from './club-gift-execution.service';
import type { ClubOrder } from './club-order.schema';
import { terminationView } from './club-termination';

export function dashboardNumber(value: bigint | number) {
  const count = Number(value);
  if (!Number.isSafeInteger(count)) throw new ConflictException('仪表盘汇总超出安全整数范围');
  return count;
}

export function isDashboardGiftOrder(order: ClubOrder) {
  return order.dispatchPricing?.priceUnit === 'gift_times' || order.receipt?.quote.priceUnit === 'gift_times' ||
    order.pricing?.priceUnit === 'gift_times' || order.heartDelivery?.requestedGiftTimes != null;
}

export type DashboardProjection = { row: DashboardOrderRow; readyNetCents: number | null };

export function dashboardOrder(order: ClubOrder, facts: GiftDayFact[], legacyReports: DailyReport[], refundRemainingCents: number | null): DashboardOrderRow {
  const gift = isDashboardGiftOrder(order);
  const accepting = acceptsGiftExecution(order);
  const counts = gift ? giftReceived(facts) : legacyReceived(order, legacyReports);
  const active = gift ? activeGiftSegments(order) : [];
  const quotes = gift && !active.length ? giftFulfillmentSegments(order.pricing?.giftSegments ?? [], order.pricing?.promotions) : active;
  const claimableGiftTimes = gift && order.dispatchStatus === 'published' && accepting
    ? (order.giftDispatch?.segments ?? []).reduce((sum, segment) => {
      const quote = quotes[segment.segmentIndex];
      if (!quote) return sum;
      const directed = segment.offers.reduce((total, offer) => total + (offer.accepted ? 0 : offer.giftTimes), 0);
      return sum + giftSegmentView(segment, quote).publicRemainingGiftTimes + directed;
    }, 0) : 0;
  const deliveredGiftTimes = gift ? [...deliveredGiftTimesBySegment(order, facts).values()].reduce((sum, times) => sum + times, 0) : null;
  const agreedGiftTimes = quotes.length ? quotes.reduce((sum, segment) => sum + giftSegmentTimes(segment), 0)
    : gift ? order.heartDelivery?.requestedGiftTimes ?? null : null;

  return {
    orderId: order._id.toHexString(), source: order.source, dispatcherUserId: order.dispatcherUserId ?? null,
    recipientGameAccount: order.recipientGameAccount, dispatchStatus: order.dispatchStatus,
    priceUnit: gift ? 'gift_times' : 'hearts',
    agreedGiftTimes: agreedGiftTimes === null ? null : dashboardNumber(agreedGiftTimes),
    claimableGiftTimes: dashboardNumber(claimableGiftTimes),
    deliveredGiftTimes: deliveredGiftTimes === null ? null : dashboardNumber(deliveredGiftTimes),
    knownReceivedHearts: dashboardNumber(counts.hearts), knownReceivedLines: counts.known, unknownReceivedLines: counts.unknown,
    pendingDispatch: !!order.dispatcherUserId && (order.dispatchStatus === 'draft' || order.dispatchStatus === 'pending') && accepting,
    actionLabel: orderAction(order, gift, refundRemainingCents),
  };
}

function giftReceived(facts: readonly GiftDayFact[]) {
  const counts = emptyCounts();
  for (const fact of facts) addCounts(counts, factCounts(fact));
  return counts;
}

function legacyReceived(order: ClubOrder, reports: readonly DailyReport[]) {
  const shares = new Set((order.shares ?? []).map(share => share._id.toHexString()));
  const counts = emptyCounts();
  for (const report of reports) {
    if (report.kind !== 'daily' || report.priceUnit === 'gift_times' || !shares.has(report.shareId.toHexString())) continue;
    // On historical heart orders, supplements and corrections remain under review.
    const lines = report.lines?.length ? report.lines : [{ receivedHearts: report.receivedHearts }];
    for (const line of lines) {
      if (line.receivedHearts == null) counts.unknown++;
      else {
        counts.known++;
        counts.hearts += BigInt(line.receivedHearts);
      }
    }
  }
  return counts;
}

function orderAction(order: ClubOrder, gift: boolean, refundRemainingCents: number | null) {
  if (order.dispatchStatus === 'cancelled') return null;
  const priceState = gift ? order.giftPriceAdjustmentState : order.priceAdjustment?.state;
  const legacyTermination = gift ? undefined : terminationView(order);
  const actions: string[] = [];
  if (!order.closedAt && !order.giftTermination && !legacyTermination && priceState !== 'refund_due' && priceState !== 'refunded') {
    if (priceState === 'awaiting_decision' || priceState === 'awaiting_customer') actions.push('改价待确认');
    if (priceState === 'awaiting_supplement') actions.push('改价待补款');
    if (priceState === 'needs_requote') actions.push('改价待重新核对');
    if (!gift && !actions.length && hasPendingLegacyPriceReview(order)) actions.push('改价待人工核对');
  }
  const remaining = gift ? refundRemainingCents : legacyTermination?.refundRemainingCents;
  if ((remaining ?? 0) > 0 || !gift && remaining === undefined && priceState === 'refund_due') actions.push('待退款');
  else if (!gift && remaining === null) actions.push('退款待核对');
  return actions.length ? actions.join('、') : null;
}

function hasPendingLegacyPriceReview(order: ClubOrder) {
  const reviews = order.priceAdjustmentReviews;
  if (!reviews?.length || order.dispatchStatus !== 'published' || order.dispatchWithdrawnAt) return false;
  const amendments = [...(order.priceAdjustmentHistory ?? []), order.priceAdjustment];
  return reviews.some(({ shift, submittedAt }) => !shift || !amendments.some(amendment =>
    amendment?.state === 'continuing' && amendment.shift && amendment.submittedAt >= submittedAt &&
    amendment.shift.quoteSegment === shift.quoteSegment &&
    amendment.shift.hearts === shift.hearts && amendment.shift.targetPeriod === shift.targetPeriod &&
    amendment.shift.targetUnitPriceCents === shift.targetUnitPriceCents,
  ));
}

export function matchesDashboardMetric({ row, readyNetCents }: DashboardProjection, metric: DashboardMetric) {
  switch (metric) {
    case 'all': return true;
    case 'pending_dispatch': return row.pendingDispatch;
    case 'claimable': return row.claimableGiftTimes > 0;
    case 'fulfilled': return (row.deliveredGiftTimes ?? 0) > 0;
    case 'received': return row.knownReceivedLines > 0 || row.unknownReceivedLines > 0;
    case 'action_required': return row.actionLabel !== null;
    case 'ready_to_close': return readyNetCents !== null;
  }
}
