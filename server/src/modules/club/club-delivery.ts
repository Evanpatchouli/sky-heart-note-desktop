import type { Types } from 'mongoose';
import type {
  AgreedReportDay,
  DispatchFulfillment,
  OrderFulfillment,
} from '@sky-club/common';
import type {
  DailyReportLine,
  ReportCheck,
} from './club-delivery.schema';
import type { ClubOrder } from './club-order.schema';
import { deliveryTarget } from './club-order-pricing';
import { effectivePriceSegments } from './club-price-adjustment';
import { deliveryStoppedAt } from './club-termination';

export function quotedDeliverySegments(order: ClubOrder) {
  const pricing = order.receipt?.quote ?? order.dispatchPricing;
  return effectivePriceSegments(order, pricing?.segments ?? []).map(({ period, hearts, giftHearts = 0 }, index) => ({
    number: index + 1,
    period,
    hearts: hearts + giftHearts,
    ...(giftHearts ? { paidHearts: hearts, giftHearts } : {}),
    ...(index >= (pricing?.segments.length ?? 0) ? { adjusted: true as const } : {}),
  }));
}

export function assessDelivery(order: ClubOrder, lines: DailyReportLine[]) {
  const quote = quotedDeliverySegments(order);
  const checks = new Set<ReportCheck>();
  for (const line of lines) {
    const segment = quote[(line.quoteSegment ?? 0) - 1];
    if (!segment || segment.period !== line.period)
      checks.add('unmatched_period');
    if (
      line.period !== 'unconfirmed' &&
      BigInt(line.receivedHearts ?? 0) !==
        BigInt(line.giftTimes) * (line.period === 'double' ? 2n : 1n)
    ) {
      checks.add('quantity_mismatch');
    }
  }
  return [...checks];
}

export function jsonCount(value: bigint) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value.toString();
}

export type ShareDelivery = {
  _id: { orderId: Types.ObjectId; shareId: Types.ObjectId };
  receivedHearts: Types.Decimal128 | bigint;
  giftTimes: Types.Decimal128 | bigint;
};

export type AgreedDayReport = {
  _id: { orderId: Types.ObjectId; shareId: Types.ObjectId; date: string };
  observedHearts: Types.Decimal128;
  reportedAccounts: number;
  supplementPending: boolean;
  correctionPending: boolean;
};

function shareProgress(order: ClubOrder, totals: readonly ShareDelivery[]) {
  const byShare = new Map(
    totals.map((total) => [total._id.shareId.toHexString(), total]),
  );
  return order.shares.map((share) => {
    const id = share._id.toHexString();
    const total = byShare.get(id);
    const observed = BigInt(total?.receivedHearts.toString() ?? '0');
    const promised = BigInt(share.hearts);
    const credited = observed > promised ? promised : observed;
    return {
      share,
      id,
      observed,
      credited,
      remaining: Number(promised - credited),
      giftTimes: BigInt(total?.giftTimes.toString() ?? '0'),
    };
  });
}

function orderFulfillment(
  order: ClubOrder,
  shares: ReturnType<typeof shareProgress>,
): OrderFulfillment {
  const promised = BigInt(deliveryTarget(order));
  let observed = 0n;
  let credited = 0n;
  for (const share of shares) {
    observed += share.observed;
    credited += share.credited;
  }
  if (credited > promised) credited = promised;
  const remainingHearts = Number(promised - credited);
  return {
    agreedDeadline: order.heartDelivery.agreedDeadline ?? null,
    observedHearts: jsonCount(observed),
    creditedHearts: Number(credited),
    remainingHearts,
    ...(deliveryStoppedAt(order) ? { stoppedHearts: order.termination?.stoppedHearts ?? remainingHearts } : {}),
  };
}

export function customerFulfillmentView(
  order: ClubOrder,
  totals: readonly ShareDelivery[],
) {
  return orderFulfillment(order, shareProgress(order, totals));
}

export function dispatchFulfillmentView(
  order: ClubOrder,
  totals: readonly ShareDelivery[],
  reports: readonly AgreedDayReport[],
  names: Map<string, string>,
  through?: string,
): DispatchFulfillment {
  const shares = shareProgress(order, totals);
  const progress = orderFulfillment(order, shares);
  const stopped = progress.stoppedHearts !== undefined;
  const deadlineReached =
    !stopped && !!through && !!progress.agreedDeadline && progress.agreedDeadline <= through;
  const unclaimedHearts = deliveryTarget(order) - shares.reduce((sum, { share }) => sum + share.hearts, 0);
  const byDay = new Map(
    reports.map((report) => [`${report._id.shareId}:${report._id.date}`, report]),
  );
  return {
    ...progress,
    unclaimedHearts: stopped ? 0 : unclaimedHearts,
    ...(stopped ? { originallyUnclaimedHearts: unclaimedHearts } : {}),
    overdue: deadlineReached && progress.remainingHearts > 0,
    shares: shares.map(({ share, id, observed, remaining }) => ({
      id,
      userId: share.userId,
      nickname: names.get(share.userId) ?? null,
      promisedHearts: share.hearts,
      observedHearts: jsonCount(observed),
      remainingHearts: remaining,
      ...(stopped ? { stoppedHearts: remaining } : {}),
      overdue: deadlineReached && remaining > 0,
      days: (share.agreedReportDates ?? []).map((date): AgreedReportDay => {
        const report = byDay.get(`${id}:${date}`);
        const reportedAccounts = report?.reportedAccounts ?? 0;
        const supplementPending = report?.supplementPending ?? false;
        let status: AgreedReportDay['status'];
        if (!through) status = 'not_checked';
        else if (!stopped && date > through) status = 'not_due';
        else if (reportedAccounts) status = 'recorded';
        else if (supplementPending) status = 'pending_review';
        else if (stopped) status = 'stopped';
        else status = 'missing';
        return {
          date,
          status,
          reportedAccounts,
          observedHearts: jsonCount(BigInt(report?.observedHearts.toString() ?? '0')),
          supplementPending,
          correctionPending: report?.correctionPending ?? false,
        };
      }),
    })),
  };
}

export function deliveryProgressView(
  order: ClubOrder,
  userId: string,
  totals: readonly ShareDelivery[],
) {
  const fulfilled = shareProgress(order, totals);
  const progress = orderFulfillment(order, fulfilled);
  const stopped = progress.stoppedHearts !== undefined;
  let myObserved = 0n;
  let myCredited = 0n;
  let myGiftTimes = 0n;
  let myPromised = 0;
  const shares: {
    id: string;
    observedHearts: number | string;
    creditedHearts: number;
    remainingHearts: number;
    stoppedHearts?: number;
    excessHearts: number | string;
  }[] = [];
  for (const { share, id, observed, credited, remaining, giftTimes } of fulfilled) {
    if (share.userId === userId) {
      myPromised += share.hearts;
      myObserved += observed;
      myCredited += credited;
      myGiftTimes += giftTimes;
      shares.push({
        id,
        observedHearts: jsonCount(observed),
        creditedHearts: Number(credited),
        remainingHearts: remaining,
        ...(stopped ? { stoppedHearts: remaining } : {}),
        excessHearts: jsonCount(observed - credited),
      });
    }
  }
  return {
    myGiftTimes: jsonCount(myGiftTimes),
    myObservedHearts: jsonCount(myObserved),
    myCreditedHearts: Number(myCredited),
    myRemainingHearts: myPromised - Number(myCredited),
    myExcessHearts: jsonCount(myObserved - myCredited),
    orderCreditedHearts: progress.creditedHearts,
    orderRemainingHearts: progress.remainingHearts,
    ...(stopped ? {
      orderStoppedHearts: progress.stoppedHearts,
      myStoppedHearts: myPromised - Number(myCredited),
    } : {}),
    shares,
  };
}

export { dailyReportView } from './club-daily-report-view';
