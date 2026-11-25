import type { GiftDeliveryProgress, GiftDeliverySegment, GiftPerformance, GiftPeriodProgress, GiftReportPeriod, GiftShareProgress } from '@webapp-template/common';
import { Types, type Collection, type PipelineStage } from 'mongoose';
import { jsonReportCount } from './club-daily-report-view';
import type { ClubOrder } from './club-order.schema';
import { acceptsGiftExecution } from './club-gift-execution.service';
import { activeGiftSegments } from './club-gift-allocation';

export type GiftDayFact = {
  _id: { shareId: Types.ObjectId; businessDate: string };
  giftTimes: Types.Decimal128;
  knownHearts: Types.Decimal128;
  unknownLines: number;
  knownLines: number;
  periods: GiftPeriodFact[];
};

type GiftPeriodFact = Omit<GiftDayFact, '_id' | 'periods'> & { period: GiftReportPeriod };

export function giftDayFacts(
  collection: Collection,
  order: ClubOrder,
  shareId?: Types.ObjectId,
  userId?: string,
  through?: string,
) {
  const decimal = (value: string) => ({ $toDecimal: { $toLong: value } });
  const shareIds = shareId ? [shareId] : (order.giftDispatch?.segments ?? [])
    .flatMap(segment => segment.shares.map(share => new Types.ObjectId(share.id)));
  if (!shareIds.length) return Promise.resolve([]);
  const pipeline: PipelineStage[] = [
    { $match: {
      orderId: order._id, ...(userId ? { userId } : {}), ...(through ? { businessDate: { $lte: through } } : {}),
      $or: [
        { priceUnit: 'gift_times' },
        { priceUnit: null, $or: [{ shareId: { $in: shareIds } }, { 'lines.shareId': { $in: shareIds } }] },
      ],
    } },
    { $sort: { version: -1 } },
    { $group: {
      _id: { $ifNull: ['$originalId', '$_id'] }, lines: { $first: '$lines' },
      shareId: { $first: '$shareId' }, businessDate: { $first: '$businessDate' },
    } },
    { $unwind: '$lines' },
    { $set: { shareId: { $ifNull: ['$lines.shareId', '$shareId'] } } },
    { $match: { shareId: { $in: shareIds } } },
    { $group: {
      _id: {
        shareId: '$shareId', businessDate: '$businessDate',
        period: { $cond: [{ $in: ['$lines.period', ['normal', 'double']] }, '$lines.period', 'unconfirmed'] },
      },
      giftTimes: { $sum: decimal('$lines.giftTimes') },
      knownHearts: { $sum: decimal('$lines.receivedHearts') },
      unknownLines: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$lines.receivedHearts', null] }, null] }, 1, 0] } },
      knownLines: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$lines.receivedHearts', null] }, null] }, 1, 0] } },
    } },
    { $group: {
      _id: { shareId: '$_id.shareId', businessDate: '$_id.businessDate' },
      giftTimes: { $sum: '$giftTimes' }, knownHearts: { $sum: '$knownHearts' },
      unknownLines: { $sum: '$unknownLines' }, knownLines: { $sum: '$knownLines' },
      periods: { $push: {
        period: '$_id.period', giftTimes: '$giftTimes', knownHearts: '$knownHearts',
        unknownLines: '$unknownLines', knownLines: '$knownLines',
      } },
    } },
  ];
  return collection.aggregate<GiftDayFact>(pipeline).toArray();
}

type Counts = { times: bigint; hearts: bigint; known: number; unknown: number };

export function emptyCounts(): Counts {
  return { times: 0n, hearts: 0n, known: 0, unknown: 0 };
}

export function addCounts(target: Counts, source: Counts) {
  target.times += source.times;
  target.hearts += source.hearts;
  target.known += source.known;
  target.unknown += source.unknown;
}

export function factCounts(fact: Omit<GiftPeriodFact, 'period'>): Counts {
  return {
    times: BigInt(fact.giftTimes.toString()), hearts: BigInt(fact.knownHearts.toString()),
    known: fact.knownLines, unknown: fact.unknownLines,
  };
}

export function receivedHearts(counts: Counts) {
  return {
    actualReceivedHearts: counts.known && !counts.unknown ? jsonReportCount(counts.hearts) : null,
    knownReceivedHearts: jsonReportCount(counts.hearts),
    knownReceivedLines: counts.known,
    unknownReceivedLines: counts.unknown,
  };
}

type PeriodCounts = Counts & { delivered: bigint | null; gross: bigint | null };

export function emptyGiftPerformance() {
  return { counts: emptyCounts(), delivered: 0, gross: 0n, periods: new Map<GiftReportPeriod, PeriodCounts>() };
}

type Performance = ReturnType<typeof emptyGiftPerformance>;

function addIfKnown(first: bigint | null, second: bigint | null) {
  return first === null || second === null ? null : first + second;
}

export function addGiftPerformance(total: Performance, next: Performance) {
  addCounts(total.counts, next.counts);
  total.delivered += next.delivered;
  total.gross += next.gross;
  for (const [period, value] of next.periods) {
    const current = total.periods.get(period) ?? { ...emptyCounts(), delivered: 0n, gross: 0n };
    addCounts(current, value);
    current.delivered = addIfKnown(current.delivered, value.delivered);
    current.gross = addIfKnown(current.gross, value.gross);
    total.periods.set(period, current);
  }
}

export function giftSharePerformance(facts: GiftDayFact[], capacity: number, unitPriceCents: number) {
  const performance = emptyGiftPerformance();
  const unitPrice = BigInt(unitPriceCents);
  for (const fact of facts) {
    addCounts(performance.counts, factCounts(fact));
    for (const row of fact.periods) {
      const period = performance.periods.get(row.period) ?? { ...emptyCounts(), delivered: 0n, gross: 0n };
      addCounts(period, factCounts(row));
      performance.periods.set(row.period, period);
    }
  }
  const { times } = performance.counts;
  const exceedsShare = times > BigInt(capacity);
  performance.delivered = exceedsShare ? capacity : Number(times);
  performance.gross = BigInt(performance.delivered) * unitPrice;
  const mixedExcess = exceedsShare && capacity > 0 && [...performance.periods.values()].filter(period => period.times > 0n).length > 1;
  for (const period of performance.periods.values()) {
    // Several actual periods contributed to an overfilled share. Their individual credited amounts require a business decision.
    period.delivered = mixedExcess && period.times > 0n ? null : period.times > BigInt(capacity) ? BigInt(capacity) : period.times;
    period.gross = period.delivered === null ? null : period.delivered * unitPrice;
  }
  return performance;
}

export function giftFactsByShare(facts: GiftDayFact[]) {
  const byShare = new Map<string, GiftDayFact[]>();
  for (const fact of facts) {
    const id = fact._id.shareId.toHexString();
    const rows = byShare.get(id) ?? [];
    rows.push(fact);
    byShare.set(id, rows);
  }
  return byShare;
}

const actualPeriods: GiftReportPeriod[] = ['normal', 'double', 'unconfirmed'];

function money(cents: bigint | null) {
  return cents === null || cents > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(cents);
}

export function giftPerformanceView(performance: Performance): GiftPerformance {
  const periods: GiftPeriodProgress[] = [];
  let estimatedTotal: bigint | null = 0n;
  for (const period of actualPeriods) {
    const counts = performance.periods.get(period);
    if (!counts) continue;
    const estimated = period === 'unconfirmed' && counts.times > 0n ? null : counts.times * (period === 'double' ? 2n : 1n);
    estimatedTotal = addIfKnown(estimatedTotal, estimated);
    periods.push({
      period, observedGiftTimes: jsonReportCount(counts.times),
      deliveredGiftTimes: counts.delivered === null ? null : Number(counts.delivered),
      estimatedDeliveredHearts: estimated === null ? null : jsonReportCount(estimated),
      ...receivedHearts(counts), heartAmountCents: money(counts.gross),
    });
  }
  return {
    observedGiftTimes: jsonReportCount(performance.counts.times),
    excessGiftTimes: jsonReportCount(performance.counts.times - BigInt(performance.delivered)),
    estimatedDeliveredHearts: estimatedTotal === null ? null : jsonReportCount(estimatedTotal),
    heartAmountCents: money(performance.gross), periods,
  };
}

function giftCompensation(performance: Performance, pricing: NonNullable<ClubOrder['dispatchPricing']>) {
  const giftTimes = performance.delivered;
  const grossCents = money(performance.gross);
  const dispatchFeeCents = money(BigInt(giftTimes) * BigInt(pricing.dispatchFeeCents));
  const clubFeeCents = money(BigInt(giftTimes) * BigInt(pricing.clubFeeCents));
  if (grossCents === null || dispatchFeeCents === null || clubFeeCents === null)
    return { compensationIssue: 'out_of_range' as const, pendingCompensation: null };
  const memberCents = grossCents - dispatchFeeCents - clubFeeCents;
  if (memberCents < 0) return { compensationIssue: 'negative_amount' as const, pendingCompensation: null };
  return { compensationIssue: null, pendingCompensation: { giftTimes, grossCents, dispatchFeeCents, clubFeeCents, memberCents } };
}

export function giftProgress(order: ClubOrder, userId: string, facts: GiftDayFact[]): GiftDeliveryProgress {
  const byShare = giftFactsByShare(facts);
  const pricing = order.dispatchPricing!;
  const quotes = activeGiftSegments(order);
  const mine = emptyGiftPerformance();
  const shares: GiftShareProgress[] = [];
  const segments: GiftDeliverySegment[] = [];
  let remainingGiftTimes = 0;
  let orderDeliveredGiftTimes = 0;
  for (const { segmentIndex, shares: assignments } of order.giftDispatch?.segments ?? []) {
    const quote = quotes[segmentIndex];
    if (!quote) continue;
    const segment = emptyGiftPerformance();
    let segmentRemaining = 0;
    let hasShare = false;
    for (const share of assignments) {
      const capacity = share.giftTimes - (share.transferredGiftTimes ?? 0);
      const performance = giftSharePerformance(byShare.get(share.id) ?? [], capacity, quote.unitPriceCents);
      const delivered = performance.delivered;
      orderDeliveredGiftTimes += delivered;
      if (share.userId !== userId) continue;
      hasShare = true;
      const remaining = capacity - delivered;
      addGiftPerformance(segment, performance);
      segmentRemaining += remaining;
      shares.push({
        shareId: share.id, segmentIndex, deliveredGiftTimes: delivered, remainingGiftTimes: remaining,
        observedGiftTimes: jsonReportCount(performance.counts.times),
        excessGiftTimes: jsonReportCount(performance.counts.times - BigInt(delivered)),
        ...receivedHearts(performance.counts), claimObservedReceivedHearts: share.actualReceivedHearts ?? null,
      });
    }
    if (!hasShare) continue;
    addGiftPerformance(mine, segment);
    remainingGiftTimes += segmentRemaining;
    segments.push({
      segmentIndex, quotePeriod: quote.period, unitPriceCents: quote.unitPriceCents,
      deliveredGiftTimes: segment.delivered, remainingGiftTimes: segmentRemaining,
      ...giftPerformanceView(segment), pendingCompensation: giftCompensation(segment, pricing).pendingCompensation,
    });
  }
  const orderGiftTimes = quotes.reduce((sum, quote) => sum + quote.paidGiftTimes, 0);
  return {
    priceUnit: 'gift_times',
    ...receivedHearts(mine.counts), ...giftPerformanceView(mine),
    deliveredGiftTimes: mine.delivered, remainingGiftTimes,
    orderDeliveredGiftTimes,
    orderRemainingGiftTimes: Math.max(0, orderGiftTimes - orderDeliveredGiftTimes),
    estimatedReceivedHearts: order.heartDelivery.estimatedReceivedHearts ?? null,
    canSubmitDaily: acceptsGiftExecution(order),
    canCorrectReports: order.closedAt == null,
    ...giftCompensation(mine, pricing), shares, segments,
  };
}
