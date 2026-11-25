import {
  giftSegmentTimes, type GiftSettlementAmounts, type GiftSettlementCalculation,
  type GiftSettlementCash, type GiftSettlementIssue, type GiftSettlementProgress,
} from '@webapp-template/common';
import { isDeepStrictEqual } from 'node:util';
import { continuationView } from './club-continuation.service';
import type { ClubFinancialAdjustment } from './club-financial-adjustment.schema';
import type { DailyReport } from './club-delivery.schema';
import {
  addGiftPerformance, eligiblePromotionalFacts, emptyGiftPerformance, giftCompensationBasis,
  giftFactsByShare, giftPerformanceView, giftSharePerformance, receivedHearts, type GiftDayFact,
} from './club-gift-delivery';
import { giftSettlementAdjustments } from './club-gift-settlement-adjustments';
import {
  giftPaidAmounts, giftPriceAmendmentView, giftPriceSegments,
} from './club-gift-price-basis';
import { giftTerminationView } from './club-gift-termination';
import type { ClubOrder } from './club-order.schema';

export const GIFT_SETTLEMENT_CALCULATION_VERSION = 6;

type Pricing = NonNullable<ClubOrder['dispatchPricing']>;
type PriceBasis = ReturnType<typeof giftPriceSegments>[number];
type Performance = ReturnType<typeof emptyGiftPerformance>;

function distribution() {
  return { gross: 0n, dispatch: 0n, club: 0n, reward: 0n, personal: 0n, platform: 0n, promotional: 0n };
}

function addDistribution(target: Distribution, entry: Distribution) {
  for (const key of Object.keys(target) as (keyof Distribution)[]) target[key] += entry[key];
}

type Distribution = ReturnType<typeof distribution>;

function segmentDistribution(basis: PriceBasis, times: number, pricing?: Pricing): Distribution {
  const gross = BigInt(times) * BigInt(basis.segment.unitPriceCents);
  const { personalDiscountCents, platformDiscountCents } = giftPaidAmounts(basis, 0, times);
  return {
    ...(pricing ? giftCompensationBasis(times, gross, pricing) : { gross, dispatch: 0n, club: 0n, reward: 0n }),
    personal: BigInt(personalDiscountCents), platform: BigInt(platformDiscountCents),
    promotional: basis.segment.promotionalGiftTimes ? gross : 0n,
  };
}

function progress(agreedGiftTimes: number, performance: Performance): GiftSettlementProgress {
  return {
    agreedGiftTimes, deliveredGiftTimes: performance.delivered,
    ...receivedHearts(performance.counts), ...giftPerformanceView(performance),
  };
}

function memberWork() {
  return { agreed: 0, performance: emptyGiftPerformance(), rows: [] as GiftSettlementCalculation['members'][number]['segments'] };
}

function cashAndStop(order: ClubOrder, delivered: ReadonlyMap<number, number>) {
  const originalReceivedCents = order.receipt?.receivedAmountCents ?? 0;
  const continuationReceivedCents = (order.continuationQuotes ?? []).reduce((sum, item) =>
    sum + (item.receipt?.receivedAmountCents ?? 0), 0);
  const stopped = !!order.giftTermination || order.giftPriceAdjustmentState === 'stopped';
  const termination = giftTerminationView(order, delivered) ?? null;
  const amendments = giftPriceAmendmentView(order, termination?.refundDueCents);
  const supplementReceivedCents = amendments.priceAdjustment?.supplementReceivedCents ?? 0;
  const cash: GiftSettlementCash = termination ? {
    originalReceivedCents: termination.originalReceivedCents, continuationReceivedCents: termination.continuationReceivedCents,
    supplementReceivedCents: termination.supplementReceivedCents, refundDueCents: termination.refundDueCents,
    refundedCents: termination.refundedCents, refundRemainingCents: termination.refundRemainingCents,
    excessRefundCents: termination.excessRefundCents, netReceivedCents: termination.netReceivedCents,
  } : {
    originalReceivedCents, continuationReceivedCents, supplementReceivedCents, refundDueCents: 0, refundedCents: 0,
    refundRemainingCents: 0, excessRefundCents: 0,
    netReceivedCents: originalReceivedCents + continuationReceivedCents + supplementReceivedCents,
  };
  return { cash, termination, stopped, amendments };
}

export function calculateGiftSettlement(
  order: ClubOrder, facts: GiftDayFact[], reports: readonly DailyReport[], financialAdjustments: readonly ClubFinancialAdjustment[],
): GiftSettlementCalculation {
  const pricing = order.dispatchPricing;
  const published = order.dispatchStatus === 'published';
  const issues = new Set<GiftSettlementIssue>();
  function cents(amount: bigint) {
    const value = Number(amount);
    if (Number.isSafeInteger(value)) return value;
    issues.add('amount_overflow');
    return null;
  }
  function amounts(entry: Distribution, feesAvailable = true): GiftSettlementAmounts {
    if (entry.reward < 0n) issues.add('negative_reward');
    const dispatchNet = entry.dispatch - entry.personal;
    const clubNet = entry.club - entry.platform - entry.promotional;
    return {
      grossCents: cents(entry.gross), dispatchFeeCents: feesAvailable ? cents(entry.dispatch) : null,
      clubFeeCents: feesAvailable ? cents(entry.club) : null, rewardCents: feesAvailable ? cents(entry.reward) : null,
      personalDiscountCents: cents(entry.personal), platformDiscountCents: cents(entry.platform),
      promotionalGiftCostCents: cents(entry.promotional), dispatchNetCents: feesAvailable ? cents(dispatchNet) : null,
      clubNetCents: feesAvailable ? cents(clubNet) : null,
      allocatedCents: cents(entry.gross - entry.personal - entry.platform - entry.promotional),
    };
  }

  const basis = giftPriceSegments(order);
  const byShare = giftFactsByShare(eligiblePromotionalFacts(order, facts));
  const members = new Map<string, ReturnType<typeof memberWork>>();
  const netShares = new Map<string, GiftSettlementCalculation['shares'][number]>();
  const dispatch = new Map(order.giftDispatch?.segments.map(value => [value.segmentIndex, value]));
  const deliveredBySegment = new Map<number, number>();
  const overall = emptyGiftPerformance();
  const planned = distribution();
  const actual = distribution();

  if (!order.dispatcherUserId || !basis.length || published && (!order.publishedAt || pricing?.basis !== 'gift_times'))
    issues.add('missing_publication');
  if ((order.giftDispatch?.segments.length ?? 0) !== dispatch.size ||
    [...dispatch.keys()].some(index => !basis[index])) issues.add('invalid_fulfillment');

  const segments = basis.map((entry, segmentIndex) => {
    const { segment: quote } = entry;
    const capacity = giftSegmentTimes(quote);
    const progressByMember = new Map<string, { agreed: number; performance: Performance }>();
    const performance = emptyGiftPerformance();
    let claimed = 0;
    for (const share of dispatch.get(segmentIndex)?.shares ?? []) {
      const transferredGiftTimes = share.transferredGiftTimes ?? 0;
      const netGiftTimes = share.giftTimes - transferredGiftTimes;
      if (netShares.has(share.id) || netGiftTimes < 0) {
        issues.add('invalid_fulfillment');
        continue;
      }
      netShares.set(share.id, { id: share.id, userId: share.userId, segmentIndex,
        originalGiftTimes: share.giftTimes, transferredGiftTimes, netGiftTimes });
      const sharePerformance = giftSharePerformance(byShare.get(share.id) ?? [], netGiftTimes, quote.unitPriceCents);
      const member = progressByMember.get(share.userId) ?? { agreed: 0, performance: emptyGiftPerformance() };
      member.agreed += netGiftTimes;
      addGiftPerformance(member.performance, sharePerformance);
      addGiftPerformance(performance, sharePerformance);
      progressByMember.set(share.userId, member);
      claimed += netGiftTimes;
    }
    if (!pricing && progressByMember.size) issues.add('invalid_fulfillment');
    if (claimed > capacity) issues.add('invalid_fulfillment');
    for (const [userId, current] of progressByMember) {
      const member = members.get(userId) ?? memberWork();
      const plannedReward = pricing ? giftCompensationBasis(current.agreed, BigInt(current.agreed) * BigInt(quote.unitPriceCents), pricing).reward : null;
      const result = pricing ? giftCompensationBasis(current.performance.delivered, current.performance.gross, pricing) : null;
      member.agreed += current.agreed;
      addGiftPerformance(member.performance, current.performance);
      member.rows.push({
        segmentIndex, unitPriceCents: quote.unitPriceCents, ...progress(current.agreed, current.performance),
        plannedRewardCents: plannedReward === null ? null : cents(plannedReward),
        grossCents: result ? cents(result.gross) : null, dispatchFeeCents: result ? cents(result.dispatch) : null,
        clubFeeCents: result ? cents(result.club) : null, rewardCents: result ? cents(result.reward) : null,
      });
      members.set(userId, member);
    }
    deliveredBySegment.set(segmentIndex, performance.delivered);
    addGiftPerformance(overall, performance);
    const plan = segmentDistribution(entry, capacity, pricing);
    const result = segmentDistribution(entry, performance.delivered, pricing);
    addDistribution(planned, plan);
    addDistribution(actual, result);
    return {
      segmentIndex, quote, ...progress(capacity, performance), unclaimedGiftTimes: capacity - claimed,
      planned: amounts(plan, !!pricing), totals: amounts(result, !!pricing || !performance.delivered),
    };
  });
  const agreedGiftTimes = segments.reduce((sum, segment) => sum + segment.agreedGiftTimes, 0);
  const reportVersions = new Map<string, number>();
  for (const report of reports) {
    const originalId = (report.originalId ?? report._id).toHexString();
    reportVersions.set(originalId, Math.max(reportVersions.get(originalId) ?? 0, report.version));
  }
  const reportViews = reports.map(report => {
    const originalId = (report.originalId ?? report._id).toHexString();
    const effective = reportVersions.get(originalId) === report.version;
    const lines = report.lines.map(line => {
      const shareId = (line.shareId ?? report.shareId).toHexString();
      if (effective && netShares.get(shareId)?.userId !== report.userId) issues.add('invalid_fulfillment');
      return {
        shareId, period: line.period ?? 'unconfirmed', giftTimes: line.giftTimes,
        receivedHearts: line.receivedHearts ?? null,
        ...(line.promotionPaidSegmentIndices ? { promotionPaidSegmentIndices: line.promotionPaidSegmentIndices } : {}),
      };
    });
    return {
      id: report._id.toHexString(), originalId, version: report.version, effective, userId: report.userId,
      shareId: report.shareId.toHexString(), accountId: report.accountId.toHexString(), accountName: report.accountName,
      businessDate: report.businessDate, submittedAt: report.submittedAt.toISOString(), kind: report.kind,
      reason: report.reason ?? null, lines,
    };
  });
  if (overall.pendingPromotional) issues.add('promotion_pending');

  const { cash: originalCash, termination, stopped, amendments } = cashAndStop(order, deliveredBySegment);
  const settlement = order.closedAt ? {
    closedAt: order.closedAt,
    adjustmentIds: new Set(order.settlementPenaltyIds?.map(id => id.toHexString())),
  } : undefined;
  const { adjustments, penalties, penaltyCents, compensation } = giftSettlementAdjustments(financialAdjustments, issues, termination?.refunds, settlement);
  const cash = compensation.due ? {
    ...originalCash,
    refundDueCents: cents(BigInt(originalCash.refundDueCents!) + compensation.due),
    refundedCents: cents(BigInt(originalCash.refundedCents!) + compensation.paid),
    refundRemainingCents: cents(BigInt(originalCash.refundRemainingCents!) + compensation.remaining),
    excessRefundCents: cents(BigInt(originalCash.excessRefundCents!) + compensation.excess),
    netReceivedCents: cents(BigInt(originalCash.netReceivedCents!) - compensation.paid),
    compensationRefundDueCents: cents(compensation.due),
    compensationRefundedCents: cents(compensation.paid),
    compensationRefundRemainingCents: cents(compensation.remaining),
  } : originalCash;
  const receipt = order.receipt;
  const continuations = continuationView(order).continuationQuotes.map((quote, index) => {
    const payment = order.continuationQuotes?.[index].receipt;
    return payment ? {
      ...quote, receipt: { ...quote.receipt!, requestId: payment.requestId,
        recordedAt: payment.recordedAt.toISOString(), recordedByUserId: payment.recordedByUserId },
    } : quote as GiftSettlementCalculation['continuations'][number];
  });
  if (!receipt || receipt.quote.priceUnit !== 'gift_times' || receipt.receivedAmountCents !== receipt.quote.totalAmountCents ||
    (pricing && (receipt.quote.revision !== pricing.revision || !isDeepStrictEqual(receipt.quote.giftSegments, pricing.giftSegments) ||
    !isDeepStrictEqual(receipt.quote.promotions, pricing.promotions))) ||
    continuations.some(quote => quote.receipt && quote.receipt.receivedAmountCents !== quote.amountCents))
    issues.add('receipt_mismatch');
  if (continuations.some(quote => quote.acceptance && !quote.receipt) && !stopped)
    issues.add('continuation_payment_pending');
  const adjustmentState = order.giftPriceAdjustmentState;
  if (!stopped && adjustmentState && !['continuing', 'superseded'].includes(adjustmentState))
    issues.add('price_adjustment_pending');
  if (stopped && !termination || cash.refundRemainingCents !== 0 || cash.excessRefundCents !== 0)
    issues.add('refund_pending');
  if (!published && (!stopped || overall.delivered || reportViews.length)) issues.add('invalid_fulfillment');
  if (Object.values(cash).some(value => !Number.isSafeInteger(value))) issues.add('amount_overflow');

  const memberRows = [...members].sort(([a], [b]) => a.localeCompare(b)).map(([userId, member]) => {
    const baseReward = pricing ? giftCompensationBasis(member.performance.delivered, member.performance.gross, pricing).reward : null;
    const penalty = penalties.get(userId);
    return {
      userId, ...progress(member.agreed, member.performance), segments: member.rows,
      plannedRewardCents: member.rows.every(row => row.plannedRewardCents !== null)
        ? cents(member.rows.reduce((sum, row) => sum + BigInt(row.plannedRewardCents!), 0n)) : null,
      rewardCents: baseReward === null ? null : cents(baseReward),
      ...(penalty ? {
        penaltyCents: cents(penalty.sum), penalties: penalty.items,
        netRewardCents: baseReward === null ? null : cents(baseReward - penalty.sum),
      } : {}),
    };
  });
  const plannedAmounts = amounts(planned, !!pricing);
  const baseAmounts = amounts(actual, !!pricing || !overall.delivered);
  const totals = compensation.due || penaltyCents ? {
    ...baseAmounts,
    customerCompensationCents: cents(compensation.due), memberPenaltyCents: cents(penaltyCents),
    memberNetCents: cents(actual.reward - penaltyCents),
    clubNetCents: cents(actual.club - actual.platform - actual.promotional - compensation.due + penaltyCents),
    allocatedCents: cents(actual.gross - actual.personal - actual.platform - actual.promotional - compensation.due),
  } : baseAmounts;
  const ended = stopped || segments.every(segment => segment.deliveredGiftTimes === segment.agreedGiftTimes);
  const differenceCents = receipt && totals.allocatedCents !== null && cash.netReceivedCents !== null && Number.isSafeInteger(cash.netReceivedCents)
    ? cents(BigInt(cash.netReceivedCents) - BigInt(totals.allocatedCents)) : null;
  const contractCents = plannedAmounts.allocatedCents;
  const totalReceived = BigInt(cash.originalReceivedCents) + BigInt(cash.continuationReceivedCents) + BigInt(cash.supplementReceivedCents);
  if (ended && differenceCents !== 0 || contractCents !== null && BigInt(contractCents) !== totalReceived)
    issues.add('unreconciled');
  const status = order.closedAt ? 'closed' : issues.size ? 'review_required' : ended ? 'ready_to_close' : 'in_progress';

  return {
    priceUnit: 'gift_times', clubId: order.clubId, orderId: order._id.toHexString(), source: order.source, status,
    dispatcherUserId: order.dispatcherUserId ?? '', publishedAt: order.publishedAt?.toISOString() ?? null,
    publicationId: order.publication?.id.toHexString() ?? null,
    ...progress(agreedGiftTimes, overall),
    pricing: pricing ?? null, receipt: receipt ? { ...receipt, receivedAt: receipt.receivedAt.toISOString(),
      recordedAt: receipt.recordedAt.toISOString() } : null,
    continuations, priceAdjustments: amendments.priceAdjustment ? [...amendments.priceAdjustmentHistory, amendments.priceAdjustment] : [],
    ...(adjustments.length ? { adjustments } : {}),
    cash: receipt ? cash : null, termination, stopped, planned: plannedAmounts, totals: { ...totals, differenceCents },
    unclaimedGiftTimes: segments.reduce((sum, segment) => sum + segment.unclaimedGiftTimes, 0),
    members: memberRows, segments, shares: [...netShares.values()], reports: reportViews, issues: [...issues],
  };
}
