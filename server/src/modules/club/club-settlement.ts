import {
  calculateQuoteAmounts,
  quoteHeartCounts,
  type DispatchPricing,
  type SettlementCalculation,
  type SettlementIssue,
  type SettlementReport,
  type SettlementSendAmounts,
} from '@sky-club/common';
import { type DailyReport } from './club-delivery.schema';
import { activityQuantities, deliveryTarget, publishedQuoteMatchesReceipt } from './club-order-pricing';
import type { ClubOrder } from './club-order.schema';
import { effectivePriceSegments, priceAdjustmentHistoryView, priceAdjustmentReviewsView, priceAdjustmentView } from './club-price-adjustment';
import { dispatchTerminationView } from './club-termination';

export const SETTLEMENT_CALCULATION_VERSION = 1;
export const ACTIVITY_SETTLEMENT_CALCULATION_VERSION = 2;
export const ADJUSTED_SETTLEMENT_CALCULATION_VERSION = 3;
export const TERMINATED_SETTLEMENT_CALCULATION_VERSION = 4;

type Amounts = ReturnType<typeof amounts>;
type Delivery = { hearts: bigint; times: bigint };
type Issues = Set<SettlementIssue>;
type MemberWork = {
  claimed: bigint;
  segments: Map<number, Delivery>;
  issues: Issues;
};

const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
const emptyDelivery = () => ({ hearts: 0n, times: 0n });

function quantity(value: bigint) {
  return value <= maxSafe ? Number(value) : value.toString();
}

function cents(value: bigint, issues: Issues) {
  if (value > maxSafe || value < -maxSafe) {
    issues.add('amount_overflow');
    return null;
  }
  return Number(value);
}

function amounts(gross: bigint, dispatch: bigint, club: bigint) {
  return { gross, dispatch, club, reward: gross - dispatch - club };
}

function sumAmounts(total: Amounts, entry: Amounts) {
  return amounts(
    total.gross + entry.gross,
    total.dispatch + entry.dispatch,
    total.club + entry.club,
  );
}

function moneyView(
  value: Amounts | null,
  issues: Issues,
): SettlementSendAmounts {
  return {
    grossCents: value ? cents(value.gross, issues) : null,
    dispatchFeeCents: value ? cents(value.dispatch, issues) : null,
    clubFeeCents: value ? cents(value.club, issues) : null,
    rewardCents:
      value && value.reward >= 0n ? cents(value.reward, issues) : null,
  };
}

function subtractFees(gross: bigint, units: bigint, pricing: DispatchPricing) {
  return amounts(
    gross,
    units * BigInt(pricing.dispatchFeeCents),
    units * BigInt(pricing.clubFeeCents),
  );
}

function plannedAmounts(pricing: DispatchPricing) {
  let gross = 0n;
  let units = 0n;
  for (const segment of pricing.segments) {
    const hearts = BigInt(segment.hearts + (segment.giftHearts ?? 0));
    const doubleByTime =
      pricing.basis === 'gift_times' && segment.period === 'double';
    if (doubleByTime && hearts % 2n !== 0n) return null;
    gross += hearts * BigInt(segment.unitPriceCents);
    units += doubleByTime ? hearts / 2n : hearts;
  }
  return subtractFees(gross, units, pricing);
}

function plannedMember(
  member: MemberWork,
  pricing: DispatchPricing,
  requested: bigint,
  total: Amounts | null,
) {
  if (member.claimed === requested) return total;
  const [first] = pricing.segments;
  const firstHalfUnits =
    pricing.basis === 'gift_times' && first.period === 'double';
  if (
    pricing.segments.some(
      (segment) =>
        segment.unitPriceCents !== first.unitPriceCents ||
        (pricing.basis === 'gift_times' && segment.period === 'double') !==
          firstHalfUnits,
    )
  )
    return null;
  if (firstHalfUnits && member.claimed % 2n !== 0n) return null;
  return subtractFees(
    member.claimed * BigInt(first.unitPriceCents),
    firstHalfUnits ? member.claimed / 2n : member.claimed,
    pricing,
  );
}

function supportedPricing(order: ClubOrder) {
  const { dispatchPricing: pricing } = order;
  if (
    !pricing ||
    !order.publishedAt ||
    !pricing.segments.length
  )
    return null;
  const quote = calculateQuoteAmounts(pricing.segments, pricing.discountedHeartsAmountCents);
  const counts = quoteHeartCounts(pricing.segments);
  if (
    !quote ||
    !counts ||
    counts.paidHearts !== order.heartDelivery.requestedHearts ||
    ![pricing.clubFeeCents, pricing.dispatchFeeCents].every(
      (fee) => Number.isSafeInteger(fee) && fee >= 0,
    )
  )
    return null;
  return { pricing, quote, counts };
}

function receiptMatches(
  order: ClubOrder,
  published: NonNullable<ReturnType<typeof supportedPricing>>,
) {
  const receipt = order.receipt;
  const { pricing, quote } = published;
  return (
    receipt &&
    receipt.receivedAmountCents === quote.totalAmountCents &&
    publishedQuoteMatchesReceipt(receipt, pricing, quote)
  );
}

export function calculateSettlement(
  order: ClubOrder,
  reports: readonly DailyReport[],
): SettlementCalculation {
  const { dispatcherUserId } = order;
  if (!dispatcherUserId) throw new Error('结算订单缺少派单人');
  const issues: Issues = new Set();
  const published = supportedPricing(order);
  const priceAdjustment = priceAdjustmentView(order);
  const pricing = published ? {
    ...published.pricing,
    segments: [...effectivePriceSegments(order, published.pricing.segments)],
  } : null;
  const segments = pricing?.segments ?? [];
  const orderShares = new Map(
    order.shares
      .map((share) => [share._id.toHexString(), share] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const members = new Map<string, MemberWork>();
  const requested = BigInt(deliveryTarget(order));
  const shares: SettlementCalculation['shares'] = [];
  let claimed = 0n;
  for (const [id, share] of orderShares) {
    const member = members.get(share.userId) ?? {
      claimed: 0n,
      segments: new Map(),
      issues: new Set<SettlementIssue>(),
    };
    const hearts = BigInt(share.hearts);
    shares.push({ id, userId: share.userId, hearts: share.hearts });
    claimed += hearts;
    member.claimed += hearts;
    members.set(share.userId, member);
  }

  const observedByShare = new Map<string, bigint>();
  const observedBySegment = new Map<number, bigint>();
  const facts: SettlementReport[] = [];
  let observedHearts = 0n;
  for (const report of reports) {
    if (report.priceUnit === 'gift_times' || report.receivedHearts == null) continue;
    const shareId = report.shareId.toHexString();
    const accountId = report.accountId.toHexString();
    const share = orderShares.get(shareId);
    const effective = report.kind === 'daily' && report.version === 1;
    const account =
      share?.userId === report.userId
        ? share.executionGameAccounts?.find(
            (value) =>
              value._id.equals(report.accountId) && value.personalAccountId,
          )
        : undefined;
    const observedLines = report.lines.flatMap((line) =>
      line.receivedHearts == null ? [] : [{ ...line, receivedHearts: line.receivedHearts }],
    );
    const reportHearts = observedLines.reduce(
      (total, line) => total + BigInt(line.receivedHearts),
      0n,
    );
    const valid = !!account && observedLines.length === report.lines.length && reportHearts === BigInt(report.receivedHearts);
    const lines = observedLines.map((line) => {
      const checks: SettlementIssue[] = [];
      const number = line.quoteSegment ?? 0;
      const segment = segments[number - 1];
      if (!effective) checks.push('pending_report');
      if (!valid) checks.push('invalid_report');
      if (!segment || segment.period !== line.period)
        checks.push('unmatched_line');
      if (
        line.period !== 'unconfirmed' &&
        BigInt(line.receivedHearts) !==
          BigInt(line.giftTimes) * (line.period === 'double' ? 2n : 1n)
      ) {
        checks.push('quantity_mismatch');
      }
      if (effective && valid && segment?.period === line.period) {
        observedBySegment.set(
          number,
          (observedBySegment.get(number) ?? 0n) + BigInt(line.receivedHearts),
        );
      }
      return {
        ...line,
        quoteSegment: line.quoteSegment ?? null,
        issues: checks,
      };
    });
    if (!effective) issues.add('pending_report');
    if (!valid) issues.add('invalid_report');
    if (effective && valid) {
      observedHearts += reportHearts;
      observedByShare.set(
        shareId,
        (observedByShare.get(shareId) ?? 0n) + reportHearts,
      );
    }
    facts.push({
      id: report._id.toHexString(),
      originalId: report.originalId.toHexString(),
      version: report.version,
      userId: report.userId,
      shareId,
      accountId,
      accountName: report.accountName,
      businessDate: report.businessDate,
      submittedAt: report.submittedAt.toISOString(),
      kind: report.kind,
      reason: report.reason ?? null,
      lines,
    });
  }

  const excessShares = new Set<string>();
  let allSharesFulfilled = claimed === requested;
  for (const [id, share] of orderShares) {
    const actual = observedByShare.get(id) ?? 0n;
    const expected = BigInt(share.hearts);
    if (actual !== expected) allSharesFulfilled = false;
    if (actual > expected) {
      excessShares.add(id);
      issues.add('share_excess');
    }
  }
  const excessSegments = new Set<number>();
  let allSegmentsFulfilled = true;
  for (const [index, segment] of segments.entries()) {
    const actual = observedBySegment.get(index + 1) ?? 0n;
    const expected = BigInt(segment.hearts + (segment.giftHearts ?? 0));
    if (actual !== expected) allSegmentsFulfilled = false;
    if (actual > expected) {
      excessSegments.add(index + 1);
      issues.add('segment_excess');
    }
    if (actual < expected && allSharesFulfilled)
      issues.add('segment_shortfall');
  }

  for (const report of facts) {
    const member = members.get(report.userId);
    for (const line of report.lines) {
      const number = line.quoteSegment ?? 0;
      const effective = !line.issues.includes('pending_report');
      if (effective && excessShares.has(report.shareId))
        line.issues.push('share_excess');
      if (effective && excessSegments.has(number))
        line.issues.push('segment_excess');
      for (const issue of line.issues) {
        issues.add(issue);
        member?.issues.add(issue);
      }
      // When both observed counts and the applicable price are known, compute
      // the trial amount even if the actual counts differ from the usual ratio.
      if (!member || line.issues.some((issue) => issue !== 'quantity_mismatch'))
        continue;
      const delivery = member.segments.get(number) ?? emptyDelivery();
      delivery.hearts += BigInt(line.receivedHearts);
      delivery.times += BigInt(line.giftTimes);
      member.segments.set(number, delivery);
    }
  }

  const matchingReceipt = published && receiptMatches(order, published);
  const termination = dispatchTerminationView(order, issues.has('pending_report'));
  if (!published || !order.allocation) issues.add('missing_publication');
  if (!matchingReceipt) issues.add('receipt_mismatch');
  if (termination) {
    if (termination.refundRemainingCents !== 0) issues.add('refund_pending');
    if (termination.review.length) issues.add('termination_review_pending');
  } else if (!allSharesFulfilled) issues.add('incomplete');
  if (!termination && (priceAdjustment?.state === 'awaiting_customer' || priceAdjustment?.state === 'awaiting_supplement'))
    issues.add('price_adjustment_pending');
  if (order.priceAdjustmentReviews?.length) issues.add('price_review_pending');
  const exactActivityDelivery = !termination && allSharesFulfilled && allSegmentsFulfilled &&
    !!order.allocation && matchingReceipt &&
    !issues.has('invalid_report') && !issues.has('pending_report') &&
    !issues.has('unmatched_line') && !issues.has('quantity_mismatch');
  const discountPending = published?.quote.originalHeartsAmountCents !== undefined;
  if (discountPending) issues.add('discount_cost_pending');

  const planned = pricing ? plannedAmounts(pricing) : null;
  let aggregate = amounts(0n, 0n, 0n);
  let rewardValid = true;
  const byMember = Array.from(members, ([userId, member]) => {
    if (discountPending) member.issues.add('discount_cost_pending');
    let totals = amounts(0n, 0n, 0n);
    let negative = false;
    const rows = Array.from(member.segments, ([number, delivery]) => {
      const segment = segments[number - 1];
      const unitCount =
        pricing!.basis === 'gift_times' ? delivery.times : delivery.hearts;
      const value = subtractFees(
        delivery.hearts * BigInt(segment.unitPriceCents),
        unitCount,
        pricing!,
      );
      totals = sumAmounts(totals, value);
      if (value.reward < 0n) {
        negative = true;
        member.issues.add('negative_reward');
      }
      return {
        number,
        receivedHearts: quantity(delivery.hearts),
        giftTimes: quantity(delivery.times),
        ...moneyView(value, member.issues),
      };
    }).sort((a, b) => a.number - b.number);
    const plannedMemberAmounts = pricing
      ? plannedMember(member, pricing, requested, planned)
      : null;
    const plan = moneyView(plannedMemberAmounts, member.issues);
    if (plannedMemberAmounts && plannedMemberAmounts.reward < 0n)
      member.issues.add('negative_reward');
    aggregate = sumAmounts(aggregate, totals);
    rewardValid &&= !negative;
    const knownSubtotalCents =
      pricing && !negative
        ? cents(totals.reward, member.issues)
        : null;
    const view = {
      userId,
      claimedHearts: quantity(member.claimed),
      segments: rows,
      rewardCents:
        pricing && !negative ? cents(totals.reward, member.issues) : null,
      knownSubtotalCents,
      totalCents: member.issues.size ? null : knownSubtotalCents,
      plannedRewardCents: plan.rewardCents,
      issues: [...member.issues],
    };
    for (const issue of view.issues) issues.add(issue);
    return view;
  }).sort((a, b) => a.userId.localeCompare(b.userId));

  let activity: SettlementCalculation['activity'];
  let giftExpense = 0n;
  if (published?.counts.giftHearts) {
    const plannedGiftExpense = segments.reduce(
      (sum, { giftHearts = 0, unitPriceCents }) => sum + BigInt(giftHearts) * BigInt(unitPriceCents),
      0n,
    );
    if (exactActivityDelivery) giftExpense = plannedGiftExpense;
    else issues.add('gift_cost_pending');
    activity = {
      kind: 'buy_and_gift',
      plannedGiftExpenseCents: Number(plannedGiftExpense),
      observedGiftHearts: exactActivityDelivery ? published.counts.giftHearts : null,
      giftExpenseCents: exactActivityDelivery ? Number(giftExpense) : null,
      clubNetCents: exactActivityDelivery ? cents(aggregate.club - giftExpense, issues) : null,
    };
  } else if (published?.quote.originalHeartsAmountCents !== undefined) {
    activity = {
      kind: 'discount',
      discountCents: published.quote.originalHeartsAmountCents - published.quote.heartsAmountCents,
    };
  }
  const activityPending = issues.has('gift_cost_pending') || issues.has('discount_cost_pending');
  const allocated = pricing && rewardValid && !activityPending
    ? aggregate.gross - giftExpense
    : null;
  const difference =
    allocated !== null && order.receipt
      ? BigInt(termination?.netReceivedCents ?? priceAdjustment?.netReceivedCents ?? order.receipt.receivedAmountCents) - allocated
      : null;
  if (allSharesFulfilled && !activityPending && difference !== 0n) issues.add('unreconciled');
  if (termination?.refundRemainingCents === 0 && !termination.review.length && difference !== 0n)
    issues.add('unreconciled');
  const totals = {
    ...moneyView(pricing ? aggregate : null, issues),
    rewardCents:
      rewardValid && pricing ? cents(aggregate.reward, issues) : null,
    allocatedCents: allocated === null ? null : cents(allocated, issues),
    differenceCents: difference === null ? null : cents(difference, issues),
  };
  if (planned && planned.reward < 0n) issues.add('negative_reward');

  return {
    orderId: order._id.toHexString(),
    clubId: order.clubId,
    source: order.source,
    dispatcherUserId,
    publicationId: order.publication?.id.toHexString() ?? null,
    publishedAt: order.publishedAt?.toISOString() ?? null,
    requestedHearts: order.heartDelivery.requestedHearts ?? 0,
    ...activityQuantities(order),
    unclaimedHearts: termination ? 0 : quantity(claimed < requested ? requested - claimed : 0n),
    observedHearts: quantity(observedHearts),
    pricing: published?.pricing ?? null,
    ...(priceAdjustment ? { priceAdjustment } : {}),
    ...(order.priceAdjustmentHistory?.length ? { priceAdjustmentHistory: priceAdjustmentHistoryView(order) } : {}),
    ...(order.priceAdjustmentReviews?.length ? { priceAdjustmentReviews: priceAdjustmentReviewsView(order) } : {}),
    ...(termination ? {
      termination, originallyUnclaimedHearts: quantity(claimed < requested ? requested - claimed : 0n),
    } : {}),
    receipt: order.receipt
      ? {
          ...order.receipt,
          receivedAt: order.receipt.receivedAt.toISOString(),
          recordedAt: order.receipt.recordedAt.toISOString(),
        }
      : null,
    members: byMember,
    shares,
    reports: facts,
    ...(activity ? { activity } : {}),
    totals,
    planned: moneyView(planned, issues),
    issues: [...issues],
  };
}
