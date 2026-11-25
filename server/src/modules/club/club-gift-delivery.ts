import type { GiftDeliveryProgress, GiftDeliverySegment, GiftPerformance, GiftPeriodProgress, GiftPriceSegment, GiftReportPeriod, GiftShareProgress } from '@sky-club/common';
import { giftSegmentTimes } from '@sky-club/common';
import { Types, type Collection, type PipelineStage } from 'mongoose';
import { jsonReportCount } from './club-daily-report-view';
import type { ClubOrder } from './club-order.schema';
import type { DailyReport } from './club-delivery.schema';
import { acceptsGiftExecution } from './club-gift-execution.service';
import { activeGiftSegments } from './club-gift-allocation';

export type GiftDayFact = {
  _id: { shareId: Types.ObjectId; businessDate: string };
  giftTimes: Types.Decimal128;
  knownHearts: Types.Decimal128;
  unknownLines: number;
  knownLines: number;
  periods: GiftPeriodFact[];
  eligibleGiftTimes?: bigint;
};

type GiftPeriodFact = Omit<GiftDayFact, '_id' | 'periods'> & {
  period: GiftReportPeriod; promotionPaidSegmentIndices?: number[] | null;
};

export function giftDayFacts(
  collection: Collection,
  order: ClubOrder,
  shareId?: Types.ObjectId,
  userId?: string,
  through?: string,
  prospectiveReport?: DailyReport,
) {
  const shareIds = shareId ? [shareId] : (order.giftDispatch?.segments ?? [])
    .flatMap(segment => segment.shares.map(share => new Types.ObjectId(share.id)));
  const pending = prospectiveReport ?? (order.settlementClose ? order.pendingDailyReport : undefined);
  const included = pending && (!userId || pending.userId === userId) && (!through || pending.businessDate <= through);
  return giftFactsForOrderIds(collection, [order._id], shareIds, userId, through, included ? [pending] : []);
}

export function giftFactsForOrders(collection: Collection, orders: ClubOrder[]) {
  const giftOrders = orders.filter(order => order.dispatchPricing?.priceUnit === 'gift_times');
  const shareIds = giftOrders.flatMap(order => (order.giftDispatch?.segments ?? [])
    .flatMap(segment => segment.shares.map(share => new Types.ObjectId(share.id))));
  const admitted = giftOrders.flatMap(order => order.settlementClose && order.pendingDailyReport ? [order.pendingDailyReport] : []);
  return giftFactsForOrderIds(collection, giftOrders.map(order => order._id), shareIds, undefined, undefined, admitted);
}

function giftFactsForOrderIds(
  collection: Collection, orderIds: Types.ObjectId[], shareIds: Types.ObjectId[],
  userId?: string, through?: string, additionalReports: DailyReport[] = [],
) {
  if (!shareIds.length) return Promise.resolve([]);
  const decimal = (value: string) => ({ $toDecimal: { $toLong: value } });
  const pipeline: PipelineStage[] = [
    { $match: {
      orderId: orderIds.length === 1 ? orderIds[0] : { $in: orderIds },
      ...(userId ? { userId } : {}), ...(through ? { businessDate: { $lte: through } } : {}),
      $or: [
        { priceUnit: 'gift_times' },
        { priceUnit: null, $or: [{ shareId: { $in: shareIds } }, { 'lines.shareId': { $in: shareIds } }] },
      ],
    } },
    ...additionalReports.map((report): PipelineStage => ({
      $unionWith: { coll: collection.collectionName, pipeline: [
        { $match: { _id: report.originalId } },
        { $replaceWith: { $literal: report } },
      ] },
    })),
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
        promotionPaidSegmentIndices: '$lines.promotionPaidSegmentIndices',
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
        promotionPaidSegmentIndices: '$_id.promotionPaidSegmentIndices',
        unknownLines: '$unknownLines', knownLines: '$knownLines',
      } },
    } },
  ];
  return collection.aggregate<GiftDayFact>(pipeline).toArray();
}

export function allPaidGiftsDelivered(
  order: ClubOrder, quotes: GiftPriceSegment[], paidSegmentIndices: readonly number[],
  timesByShare: Map<string, bigint>,
) {
  const dispatchByIndex = new Map(order.giftDispatch?.segments.map(segment => [segment.segmentIndex, segment]));
  const paidScope = new Set(paidSegmentIndices);
  for (const adjustment of order.giftPriceAdjustments ?? []) {
    if (adjustment.newQuoteSegment && paidScope.has(adjustment.preview.quoteSegment - 1))
      paidScope.add(adjustment.newQuoteSegment - 1);
  }
  return [...paidScope].every(index => {
    const quote = quotes[index];
    if (!quote || quote.promotionalGiftTimes) return false;
    const covered = (dispatchByIndex.get(index)?.shares ?? []).reduce((sum, share) => {
      const observed = timesByShare.get(share.id) ?? 0n;
      const assigned = BigInt(share.giftTimes - (share.transferredGiftTimes ?? 0));
      return sum + (observed > assigned ? assigned : observed);
    }, 0n);
    return covered >= BigInt(quote.paidGiftTimes);
  });
}

export function addGiftTimesByShare(totals: Map<string, bigint>, shareId: string, times: bigint) {
  totals.set(shareId, (totals.get(shareId) ?? 0n) + times);
}

export function eligiblePromotionalFacts(order: ClubOrder, facts: GiftDayFact[]) {
  const quotes = activeGiftSegments(order);
  const promotionalShares = new Set(order.giftDispatch?.segments.flatMap(segment =>
    quotes[segment.segmentIndex]?.promotionalGiftTimes ? segment.shares.map(share => share.id) : [],
  ));
  if (!promotionalShares.size) return facts;
  const sorted = [...facts].sort((a, b) => a._id.businessDate.localeCompare(b._id.businessDate));
  const paidByShare = new Map<string, bigint>();
  const coverage = new Map<string, boolean>();
  let cursor = 0;
  return sorted.map(fact => {
    if (!promotionalShares.has(fact._id.shareId.toHexString())) return fact;
    const date = fact._id.businessDate;
    while (cursor < sorted.length && sorted[cursor]._id.businessDate <= date) {
      const row = sorted[cursor++];
      addGiftTimesByShare(paidByShare, row._id.shareId.toHexString(), BigInt(row.giftTimes.toString()));
    }
    const periods = fact.periods.map(period => {
      const scope = period.promotionPaidSegmentIndices;
      if (!scope?.length) return { ...period, eligibleGiftTimes: 0n };
      const key = date + ':' + scope;
      let valid = coverage.get(key);
      if (valid === undefined) {
        valid = allPaidGiftsDelivered(order, quotes, scope, paidByShare);
        coverage.set(key, valid);
      }
      return { ...period, eligibleGiftTimes: valid ? BigInt(period.giftTimes.toString()) : 0n };
    });
    return { ...fact, periods, eligibleGiftTimes: periods.reduce((sum, period) => sum + period.eligibleGiftTimes, 0n) };
  });
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
  return { counts: emptyCounts(), delivered: 0, gross: 0n, pendingPromotional: 0n, periods: new Map<GiftReportPeriod, PeriodCounts>() };
}

type Performance = ReturnType<typeof emptyGiftPerformance>;

function addIfKnown(first: bigint | null, second: bigint | null) {
  return first === null || second === null ? null : first + second;
}

export function addGiftPerformance(total: Performance, next: Performance) {
  addCounts(total.counts, next.counts);
  total.delivered += next.delivered;
  total.gross += next.gross;
  total.pendingPromotional += next.pendingPromotional;
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
  const credits = new Map<GiftReportPeriod, bigint>();
  let eligible = 0n;
  for (const fact of facts) {
    addCounts(performance.counts, factCounts(fact));
    eligible += fact.eligibleGiftTimes ?? BigInt(fact.giftTimes.toString());
    for (const row of fact.periods) {
      const period = performance.periods.get(row.period) ?? { ...emptyCounts(), delivered: 0n, gross: 0n };
      addCounts(period, factCounts(row));
      performance.periods.set(row.period, period);
      const eligibleGiftTimes = row.eligibleGiftTimes ?? BigInt(row.giftTimes.toString());
      credits.set(row.period, (credits.get(row.period) ?? 0n) + eligibleGiftTimes);
    }
  }
  const exceedsShare = eligible > BigInt(capacity);
  performance.pendingPromotional = performance.counts.times - eligible;
  performance.delivered = exceedsShare ? capacity : Number(eligible);
  performance.gross = BigInt(performance.delivered) * unitPrice;
  const mixedExcess = exceedsShare && capacity > 0 && [...credits.values()].filter(amount => amount > 0n).length > 1;
  for (const [key, period] of performance.periods) {
    // Several actual periods contributed to an overfilled share. Their individual credited amounts require a business decision.
    const amount = credits.get(key)!;
    period.delivered = mixedExcess && amount > 0n ? null : amount > BigInt(capacity) ? BigInt(capacity) : amount;
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

export function deliveredGiftTimesBySegment(order: ClubOrder, facts: GiftDayFact[]) {
  const byShare = new Map<string, bigint>();
  for (const fact of eligiblePromotionalFacts(order, facts)) {
    addGiftTimesByShare(byShare, fact._id.shareId.toHexString(),
      fact.eligibleGiftTimes ?? BigInt(fact.giftTimes.toString()));
  }
  return new Map(order.giftDispatch?.segments.map(segment => [
    segment.segmentIndex,
    segment.shares.reduce((delivered, share) => {
      const count = byShare.get(share.id) ?? 0n;
      const capacity = BigInt(share.giftTimes - (share.transferredGiftTimes ?? 0));
      return delivered + Number(count > capacity ? capacity : count);
    }, 0),
  ]));
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
    ...(performance.pendingPromotional ? { pendingPromotionalGiftTimes: jsonReportCount(performance.pendingPromotional) } : {}),
    estimatedDeliveredHearts: estimatedTotal === null ? null : jsonReportCount(estimatedTotal),
    heartAmountCents: money(performance.gross), periods,
  };
}

export function giftCompensationBasis(delivered: number, gross: bigint, pricing: NonNullable<ClubOrder['dispatchPricing']>) {
  const dispatch = BigInt(delivered) * BigInt(pricing.dispatchFeeCents);
  const club = BigInt(delivered) * BigInt(pricing.clubFeeCents);
  return { gross, dispatch, club, reward: gross - dispatch - club };
}

function giftCompensation(performance: Performance, pricing: NonNullable<ClubOrder['dispatchPricing']>) {
  const giftTimes = performance.delivered;
  const basis = giftCompensationBasis(giftTimes, performance.gross, pricing);
  const grossCents = money(basis.gross);
  const dispatchFeeCents = money(basis.dispatch);
  const clubFeeCents = money(basis.club);
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
      ...(quote.promotionalGiftTimes ? { promotionalGiftTimes: quote.promotionalGiftTimes } : {}),
      deliveredGiftTimes: segment.delivered, remainingGiftTimes: segmentRemaining,
      ...giftPerformanceView(segment), pendingCompensation: giftCompensation(segment, pricing).pendingCompensation,
    });
  }
  const orderGiftTimes = quotes.reduce((sum, quote) => sum + giftSegmentTimes(quote), 0);
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
