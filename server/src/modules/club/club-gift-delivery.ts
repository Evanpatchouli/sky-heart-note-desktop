import type { GiftDeliveryProgress, GiftShareProgress } from '@webapp-template/common';
import { Types, type Collection, type PipelineStage } from 'mongoose';
import { jsonReportCount } from './club-daily-report-view';
import type { ClubOrder } from './club-order.schema';
import { acceptsGiftExecution } from './club-gift-execution.service';

export type GiftDayFact = {
  _id: { shareId: Types.ObjectId; businessDate: string };
  giftTimes: Types.Decimal128;
  knownHearts: Types.Decimal128;
  unknownLines: number;
  knownLines: number;
};

export function giftDayFacts(
  collection: Collection,
  order: ClubOrder,
  shareId?: Types.ObjectId,
  userId?: string,
) {
  const decimal = (value: string) => ({ $toDecimal: { $toLong: value } });
  const shareIds = shareId ? [shareId] : (order.giftDispatch?.segments ?? [])
    .flatMap(segment => segment.shares.map(share => new Types.ObjectId(share.id)));
  if (!shareIds.length) return Promise.resolve([]);
  const pipeline: PipelineStage[] = [
    { $match: {
      orderId: order._id, ...(userId ? { userId } : {}),
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
      _id: { shareId: '$shareId', businessDate: '$businessDate' },
      giftTimes: { $sum: decimal('$lines.giftTimes') },
      knownHearts: { $sum: decimal('$lines.receivedHearts') },
      unknownLines: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$lines.receivedHearts', null] }, null] }, 1, 0] } },
      knownLines: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$lines.receivedHearts', null] }, null] }, 1, 0] } },
    } },
  ];
  return collection.aggregate<GiftDayFact>(pipeline).toArray();
}

type Counts = { times: bigint; hearts: bigint; known: number; unknown: number };

function emptyCounts(): Counts {
  return { times: 0n, hearts: 0n, known: 0, unknown: 0 };
}

function addCounts(target: Counts, source: Counts) {
  target.times += source.times;
  target.hearts += source.hearts;
  target.known += source.known;
  target.unknown += source.unknown;
}

function quantities(counts: Counts, deliveredGiftTimes: number, remainingGiftTimes: number) {
  return {
    observedGiftTimes: jsonReportCount(counts.times),
    deliveredGiftTimes,
    remainingGiftTimes,
    excessGiftTimes: jsonReportCount(counts.times - BigInt(deliveredGiftTimes)),
    actualReceivedHearts: counts.known && !counts.unknown ? jsonReportCount(counts.hearts) : null,
    knownReceivedHearts: jsonReportCount(counts.hearts),
    knownReceivedLines: counts.known,
    unknownReceivedLines: counts.unknown,
  };
}

export function giftProgress(order: ClubOrder, userId: string, facts: GiftDayFact[]): GiftDeliveryProgress {
  const byShare = new Map<string, Counts>();
  for (const row of facts) {
    const id = row._id.shareId.toHexString();
    const counts = byShare.get(id) ?? emptyCounts();
    addCounts(counts, {
      times: BigInt(row.giftTimes.toString()), hearts: BigInt(row.knownHearts.toString()),
      known: row.knownLines, unknown: row.unknownLines,
    });
    byShare.set(id, counts);
  }
  const pricing = order.dispatchPricing!;
  const mine = emptyCounts();
  const shares: GiftShareProgress[] = [];
  let deliveredGiftTimes = 0;
  let remainingGiftTimes = 0;
  let orderDeliveredGiftTimes = 0;
  let estimatedDeliveredHearts = 0n;
  let grossCents = 0n;
  for (const { segmentIndex, shares: assignments } of order.giftDispatch?.segments ?? []) {
    const quote = pricing.giftSegments?.[segmentIndex];
    if (!quote) continue;
    for (const share of assignments) {
      const counts = byShare.get(share.id) ?? emptyCounts();
      const capacity = share.giftTimes - (share.transferredGiftTimes ?? 0);
      const delivered = counts.times > BigInt(capacity) ? capacity : Number(counts.times);
      orderDeliveredGiftTimes += delivered;
      if (share.userId !== userId) continue;
      const remaining = capacity - delivered;
      addCounts(mine, counts);
      deliveredGiftTimes += delivered;
      remainingGiftTimes += remaining;
      grossCents += BigInt(delivered) * BigInt(quote.unitPriceCents);
      estimatedDeliveredHearts += BigInt(delivered) * (quote.period === 'double' ? 2n : 1n);
      shares.push({ shareId: share.id, segmentIndex, ...quantities(counts, delivered, remaining) });
    }
  }
  const orderGiftTimes = pricing.giftSegments?.reduce((sum, quote) => sum + quote.paidGiftTimes, 0) ?? 0;
  const dispatchFeeCents = BigInt(deliveredGiftTimes) * BigInt(pricing.dispatchFeeCents);
  const clubFeeCents = BigInt(deliveredGiftTimes) * BigInt(pricing.clubFeeCents);
  const memberCents = grossCents - dispatchFeeCents - clubFeeCents;
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  const compensationIssue = [grossCents, dispatchFeeCents, clubFeeCents].some(cents => cents > maximum)
    ? 'out_of_range' : memberCents < 0n ? 'negative_amount' : null;
  return {
    priceUnit: 'gift_times',
    ...quantities(mine, deliveredGiftTimes, remainingGiftTimes),
    orderDeliveredGiftTimes,
    orderRemainingGiftTimes: Math.max(0, orderGiftTimes - orderDeliveredGiftTimes),
    estimatedReceivedHearts: order.heartDelivery.estimatedReceivedHearts ?? null,
    estimatedDeliveredHearts: jsonReportCount(estimatedDeliveredHearts),
    canSubmitDaily: acceptsGiftExecution(order),
    compensationIssue,
    pendingCompensation: compensationIssue ? null : {
      giftTimes: deliveredGiftTimes, grossCents: Number(grossCents),
      dispatchFeeCents: Number(dispatchFeeCents), clubFeeCents: Number(clubFeeCents), memberCents: Number(memberCents),
    },
    shares,
  };
}
