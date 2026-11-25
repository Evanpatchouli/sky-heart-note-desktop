import type { GiftShare } from '@webapp-template/common';
import type { QueryFilter } from 'mongoose';
import { activeGiftSegments, giftShareView } from './club-gift-allocation';
import { eligiblePromotionalFacts, giftProgress, type GiftDayFact } from './club-gift-delivery';
import { giftExecutionAccounts, giftHistoryScopes } from './club-gift-execution.service';
import type { ClubOrder } from './club-order.schema';

export function personalAssignmentScope(clubId: string, userId: string): QueryFilter<ClubOrder> {
  return {
    clubId, dispatchStatus: 'published',
    $or: [
      { 'dispatchPricing.priceUnit': { $ne: 'gift_times' }, 'shares.userId': userId },
      ...giftHistoryScopes(clubId, userId),
    ],
  };
}

export function personalScheduleView(order: ClubOrder, userId: string) {
  const schedule = order.personalSchedules?.find(entry => entry.userId === userId);
  return {
    startDate: schedule?.startDate ?? null,
    endDate: schedule?.endDate ?? null,
    revision: schedule?.revision ?? 0,
  };
}

export function giftAssignment(
  order: ClubOrder, userId: string, byShare: ReadonlyMap<string, GiftDayFact[]>,
) {
  const segments = order.giftDispatch?.segments ?? [];
  const facts = segments.flatMap(({ shares }) => shares.flatMap(share => byShare.get(share.id) ?? []));
  // Promotion eligibility uses all paid performance. Only the caller's result is returned.
  const progress = giftProgress(order, userId, eligiblePromotionalFacts(order, facts));
  const pending = order.pendingDailyReport?.userId === userId;
  const stopped = order.giftPriceAdjustmentState === 'stopped' || !!(order as ClubOrder & { giftTermination?: unknown }).giftTermination;
  return {
    id: order._id.toHexString(),
    priceUnit: 'gift_times' as const,
    recipientGameAccount: order.recipientGameAccount,
    personalSchedule: personalScheduleView(order, userId),
    giftProgress: {
      acceptedGiftTimes: progress.deliveredGiftTimes + progress.remainingGiftTimes,
      observedGiftTimes: progress.observedGiftTimes,
      deliveredGiftTimes: progress.deliveredGiftTimes,
      remainingGiftTimes: progress.remainingGiftTimes,
      excessGiftTimes: progress.excessGiftTimes,
      pendingPromotionalGiftTimes: progress.pendingPromotionalGiftTimes,
      actualReceivedHearts: progress.actualReceivedHearts,
      knownReceivedHearts: progress.knownReceivedHearts,
      unknownReceivedLines: progress.unknownReceivedLines,
      reportSyncPending: pending,
      canSubmitDaily: progress.canSubmitDaily,
      stopped,
    },
  };
}

export function giftAssignmentDetail(
  order: ClubOrder, userId: string, byShare: ReadonlyMap<string, GiftDayFact[]>,
) {
  const summary = giftAssignment(order, userId, byShare);
  const quotes = activeGiftSegments(order);
  const accountsByShare = new Map<string, NonNullable<GiftShare['executionGameAccounts']>>();
  for (const account of giftExecutionAccounts(order, userId)) {
    for (const id of account.shareIds) {
      const linked = accountsByShare.get(id) ?? [];
      linked.push(account);
      accountsByShare.set(id, linked);
    }
  }
  return {
    ...summary,
    segments: (order.giftDispatch?.segments ?? []).flatMap(segment => {
      const shares = segment.shares.filter(share => share.userId === userId).map(share => ({
        ...giftShareView(share, segment.offers),
        executionGameAccounts: accountsByShare.get(share.id) ?? [],
      }));
      return shares.length ? [{
        segmentIndex: segment.segmentIndex,
        startDate: segment.startDate,
        endDate: segment.endDate,
        quotePeriod: quotes[segment.segmentIndex]?.period,
        shares,
      }] : [];
    }),
  };
}
