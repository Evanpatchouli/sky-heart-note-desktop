import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { estimateReceivedHearts, giftFulfillmentSegments, giftSegmentTimes, type CustomerGiftProgress, type GiftDispatchSupervision, type GiftMemberSupervision, type GiftSupervisionDay } from '@sky-club/common';
import { Model } from 'mongoose';
import { ClubDailyReportStore } from './club-daily-report.store';
import { jsonReportCount } from './club-daily-report-view';
import { ClubDirectoryService } from './club-directory.service';
import { activeGiftSegments, giftSchedule, type StoredGiftShare } from './club-gift-allocation';
import {
  addCounts, addGiftPerformance, eligiblePromotionalFacts, emptyCounts, emptyGiftPerformance, factCounts, giftDayFacts,
  giftFactsByShare, giftPerformanceView, giftSharePerformance, receivedHearts, type GiftDayFact,
} from './club-gift-delivery';
import { acceptsGiftExecution } from './club-gift-execution.service';
import { customerGiftPriceAdjustment, giftPaidAmounts, giftPriceAmendmentView, giftPriceSegments } from './club-gift-price-basis';
import { canTerminateGiftOrder, customerGiftTermination, giftTerminationView } from './club-gift-termination';
import { ClubOrder } from './club-order.schema';

function progress(agreedGiftTimes: number, performance: ReturnType<typeof emptyGiftPerformance>) {
  const deliveredGiftTimes = performance.delivered;
  return {
    agreedGiftTimes, deliveredGiftTimes, remainingGiftTimes: agreedGiftTimes - deliveredGiftTimes,
    ...receivedHearts(performance.counts), ...giftPerformanceView(performance),
  };
}

function isStopped(order: ClubOrder & { dispatchWithdrawnAt?: Date; termination?: unknown; priceAdjustment?: { decision?: { value?: string } } }) {
  return !!(order.dispatchWithdrawnAt || order.termination || order.giftTermination || order.priceAdjustment?.decision?.value === 'decline' ||
    order.giftPriceAdjustmentState === 'stopped');
}

export function canContinueGiftOrder(order: ClubOrder) {
  return order.dispatchStatus === 'published' && order.dispatchPricing?.priceUnit === 'gift_times' &&
    order.receipt?.quote.priceUnit === 'gift_times' && order.receipt.receivedAmountCents === order.receipt.quote.totalAmountCents &&
    acceptsGiftExecution(order);
}

type MemberDay = { planned: number; report: ReturnType<typeof emptyCounts> };

function dayView(businessDate: string, { planned, report }: MemberDay, through?: string): GiftSupervisionDay {
  const hasReport = report.known + report.unknown > 0;
  const status = through && businessDate > through ? 'future' :
    !planned ? 'unplanned' :
    !hasReport ? (through ? 'missing' : 'not_checked') :
    !report.times ? 'reported_zero' :
    report.times < BigInt(planned) ? 'short' : 'on_track';
  return {
    businessDate, plannedGiftTimes: planned, reportedGiftTimes: jsonReportCount(report.times),
    actualReceivedHearts: receivedHearts(report).actualReceivedHearts, status,
  };
}

function giftSupervision(order: ClubOrder, facts: GiftDayFact[], names?: Map<string, string>, through?: string) {
  const factsByShare = giftFactsByShare(eligiblePromotionalFacts(order, facts));
  const dispatchByIndex = new Map(order.giftDispatch?.segments.map(segment => [segment.segmentIndex, segment]));
  const paidWindows = new Map(order.continuationQuotes?.filter(quote => quote.receipt)
    .map(quote => [quote.segmentIndex, quote.window]));
  const active = activeGiftSegments(order);
  const price = order.receipt?.quote ?? order.pricing;
  const quotes = active.length ? active : giftFulfillmentSegments(price?.giftSegments ?? [], price?.promotions);
  const stopped = isStopped(order);
  const paused = !acceptsGiftExecution(order);
  const orderPerformance = emptyGiftPerformance();
  const segments = quotes.map((quote, segmentIndex) => {
    const dispatch = dispatchByIndex.get(segmentIndex);
    const window = dispatch ?? paidWindows.get(segmentIndex);
    const segmentPerformance = emptyGiftPerformance();
    let netClaimed = 0;
    const observed = new Set<number>();
    let unknownClaimObservations = 0;
    const byMember = new Map<string, StoredGiftShare[]>();
    const members: GiftMemberSupervision[] = [];
    for (const share of dispatch?.shares ?? []) {
      const shares = byMember.get(share.userId) ?? [];
      shares.push(share);
      byMember.set(share.userId, shares);
      if (share.actualReceivedHearts == null) unknownClaimObservations++;
      else observed.add(share.actualReceivedHearts);
    }
    for (const [userId, shares] of byMember) {
      const memberPerformance = emptyGiftPerformance();
      const memberDays = new Map<string, MemberDay>();
      let original = 0;
      let net = 0;
      let transferred = 0;
      let overdueGiftTimes = 0;
      function memberDay(date: string) {
        const current = memberDays.get(date) ?? { planned: 0, report: emptyCounts() };
        memberDays.set(date, current);
        return current;
      }
      const shareViews = shares.map(share => {
        const shareFacts = factsByShare.get(share.id) ?? [];
        const transferredGiftTimes = share.transferredGiftTimes ?? 0;
        const netGiftTimes = share.giftTimes - transferredGiftTimes;
        const current = giftSharePerformance(shareFacts, netGiftTimes, quote.unitPriceCents);
        const originalWindow = { startDate: share.startDate, endDate: share.endDate };
        addGiftPerformance(memberPerformance, current);
        original += share.giftTimes;
        net += netGiftTimes;
        transferred += transferredGiftTimes;
        const schedule = names ? giftSchedule(share.days) : new Map<string, number>();
        const scheduledDates = [...schedule.keys()].sort();
        const startDate = scheduledDates[0];
        const endDate = scheduledDates.at(-1);
        const overdue = through && !paused && endDate && endDate <= through
          ? netGiftTimes - current.delivered : 0;
        overdueGiftTimes += overdue;
        const days: GiftSupervisionDay[] = [];
        if (names) {
          const facts = new Map(shareFacts.map(fact => [fact._id.businessDate, factCounts(fact)]));
          for (const [date, amount] of schedule) memberDay(date).planned += amount;
          for (const [date, day] of facts) addCounts(memberDay(date).report, day);
          for (const date of [...new Set([...scheduledDates, ...facts.keys()])].sort())
            days.push(dayView(date, { planned: schedule.get(date) ?? 0, report: facts.get(date) ?? emptyCounts() }, through));
        }
        return {
          ...progress(netGiftTimes, current),
          shareId: share.id, originalWindow, window: startDate && endDate ? { startDate, endDate } : null,
          claimObservedReceivedHearts: share.actualReceivedHearts ?? null,
          transferredGiftTimes, overdueGiftTimes: overdue, days,
        };
      });
      addGiftPerformance(segmentPerformance, memberPerformance);
      netClaimed += net;
      if (names) members.push({
        userId, nickname: names.get(userId) ?? null, ...progress(net, memberPerformance),
        originallyClaimedGiftTimes: original, transferredGiftTimes: transferred, overdueGiftTimes, shares: shareViews,
        days: [...memberDays].sort(([a], [b]) => a.localeCompare(b))
          .map(([date, values]) => dayView(date, values, through)),
      });
    }
    addGiftPerformance(orderPerformance, segmentPerformance);
    const capacity = giftSegmentTimes(quote);
    const unclaimed = capacity - netClaimed;
    return {
      customer: {
        segmentIndex, ...quote, ...progress(capacity, segmentPerformance),
        window: window ? { startDate: window.startDate, endDate: window.endDate } : null,
        estimatedReceivedHearts: estimateReceivedHearts(capacity, quote.period) ?? null,
        claimObservedReceivedHearts: [...observed].sort((a, b) => a - b), unknownClaimObservations,
      },
      dispatch: {
        claimedGiftTimes: netClaimed, unclaimedGiftTimes: unclaimed,
        overdueUnclaimedGiftTimes: through && !paused && window && window.endDate <= through ? unclaimed : 0,
        members,
      },
    };
  });
  const agreed = quotes.length ? quotes.reduce((sum, quote) => sum + giftSegmentTimes(quote), 0) : order.heartDelivery.requestedGiftTimes!;
  const promotional = segments.filter(segment => segment.customer.promotionalGiftTimes);
  const promotionalGiftTimes = promotional.reduce((sum, segment) => sum + segment.customer.promotionalGiftTimes!, 0);
  const deliveredPromotionalGiftTimes = promotional.reduce((sum, segment) => sum + segment.customer.deliveredGiftTimes, 0);
  const deliveredBySegment = new Map(segments.map(({ customer }) => [customer.segmentIndex, customer.deliveredGiftTimes]));
  const termination = !through ? giftTerminationView(order, deliveredBySegment) : undefined;
  const amendments = !through ? giftPriceAmendmentView(order, termination?.refundDueCents) : undefined;
  const customer: CustomerGiftProgress = {
    priceUnit: 'gift_times', ...progress(agreed, orderPerformance),
    ...(promotionalGiftTimes ? {
      paidGiftTimes: agreed - promotionalGiftTimes, promotionalGiftTimes, deliveredPromotionalGiftTimes,
      deliveredPaidGiftTimes: orderPerformance.delivered - deliveredPromotionalGiftTimes,
    } : {}),
    estimatedReceivedHearts: order.heartDelivery.estimatedReceivedHearts ?? null,
    claimObservedReceivedHearts: [...new Set(segments.flatMap(({ customer }) => customer.claimObservedReceivedHearts))].sort((a, b) => a - b),
    unknownClaimObservations: segments.reduce((sum, { customer }) => sum + customer.unknownClaimObservations, 0),
    segments: segments.map(segment => segment.customer),
    closedAt: order.closedAt?.toISOString() ?? null,
    fulfillmentStatus: stopped ? 'stopped' : orderPerformance.delivered === agreed ? 'completed' :
      order.dispatchStatus === 'published' ? 'in_progress' : 'not_started',
    canRequestContinuation: canContinueGiftOrder(order),
    canRequestTermination: !through && canTerminateGiftOrder(order, agreed - orderPerformance.delivered),
    ...(termination ? { termination: customerGiftTermination(termination) } : {}),
    periodOnlyDifferenceCents: 0,
    ...(amendments?.priceAdjustment ? {
      priceAdjustment: customerGiftPriceAdjustment(amendments.priceAdjustment),
      priceAdjustmentHistory: amendments.priceAdjustmentHistory.map(customerGiftPriceAdjustment),
    } : {}),
  };
  return { customer, segments, termination, amendments };
}

function promotionBasis(order: ClubOrder, segments: CustomerGiftProgress['segments']): GiftDispatchSupervision['promotionBasis'] {
  const quote = order.receipt?.quote;
  const pricing = order.dispatchPricing;
  if ((!quote?.promotions && !order.giftPriceAdjustments?.length && !order.giftTermination) || !pricing) return undefined;
  const bySegment = giftPriceSegments(order);
  const total = {
    grossServiceCents: 0, customerServiceCents: 0, personalDiscountCents: 0,
    platformDiscountCents: 0, promotionalGiftCostCents: 0, unfulfilledServiceCents: 0,
  };
  let delivered = 0;
  for (const segment of segments) {
    const gross = segment.deliveredGiftTimes * segment.unitPriceCents;
    delivered += segment.deliveredGiftTimes;
    total.grossServiceCents += gross;
    if (segment.promotionalGiftTimes) {
      total.promotionalGiftCostCents += gross;
      continue;
    }
    const basis = bySegment[segment.segmentIndex];
    if (!basis) continue;
    const fulfilled = giftPaidAmounts(basis, 0, segment.deliveredGiftTimes);
    total.customerServiceCents += fulfilled.serviceCents;
    total.personalDiscountCents += fulfilled.personalDiscountCents;
    total.platformDiscountCents += fulfilled.platformDiscountCents;
    total.unfulfilledServiceCents += giftPaidAmounts(basis, segment.deliveredGiftTimes, segment.paidGiftTimes).serviceCents;
  }
  const dispatchFeeCents = delivered * pricing.dispatchFeeCents;
  const clubFeeCents = delivered * pricing.clubFeeCents;
  const memberFeeCents = total.grossServiceCents - dispatchFeeCents - clubFeeCents;
  return {
    ...total,
    dispatchFeeCents: Number.isSafeInteger(dispatchFeeCents) ? dispatchFeeCents : null,
    clubFeeCents: Number.isSafeInteger(clubFeeCents) ? clubFeeCents : null,
    memberFeeCents: Number.isSafeInteger(memberFeeCents) ? memberFeeCents : null,
  };
}

export function isGiftExceptionDay(day: GiftSupervisionDay) {
  return day.status === 'missing' || day.status === 'reported_zero' || day.status === 'short';
}

export function giftExceptionScope(through: string) {
  return {
    'dispatchPricing.priceUnit': 'gift_times', dispatchStatus: 'published' as const, closedAt: null,
    $or: [
      { 'giftDispatch.segments.startDate': { $lte: through } },
      { continuationQuotes: { $elemMatch: { receipt: { $exists: true }, 'window.startDate': { $lte: through } } } },
    ],
  };
}

@Injectable()
export class ClubGiftSupervision {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    private readonly dailyReports: ClubDailyReportStore,
    private readonly directory: ClubDirectoryService,
  ) {}

  private async facts(order: ClubOrder, through?: string) {
    await this.dailyReports.flushPendingReport(order);
    return giftDayFacts(this.orders.db.collection('club_daily_reports'), order, undefined, undefined, through);
  }

  async customer(order: ClubOrder) {
    if (order.heartDelivery.requestedGiftTimes === undefined) return undefined;
    return giftSupervision(order, await this.facts(order)).customer;
  }

  async dispatch(order: ClubOrder, through?: string): Promise<GiftDispatchSupervision> {
    const memberIds = new Set(order.giftDispatch?.segments.flatMap(segment => segment.shares.map(share => share.userId)));
    const [facts, names] = await Promise.all([
      this.facts(order, through), this.directory.memberNicknames([...memberIds]),
    ]);
    const result = giftSupervision(order, facts, names, through);
    const segments = result.segments.map(({ customer, dispatch }) => ({ ...customer, ...dispatch }));
    const hasExceptions = !!through && acceptsGiftExecution(order) && segments.some(segment =>
      segment.overdueUnclaimedGiftTimes ||
      segment.members.some(member => member.shares.some(share => share.overdueGiftTimes || share.days.some(isGiftExceptionDay))),
    );
    const basis = promotionBasis(order, result.customer.segments);
    const { priceAdjustment: _amendment, priceAdjustmentHistory: _history, ...customer } = result.customer;
    return { ...customer, ...result.amendments, termination: result.termination, through: through ?? null, hasExceptions, segments,
      ...(basis ? { promotionBasis: basis } : {}) };
  }

  async exceptions(order: ClubOrder, through: string) {
    const view = await this.dispatch(order, through);
    if (!view.hasExceptions) return null;
    return {
      ...view,
      segments: view.segments.flatMap(segment => {
        const members = segment.members.flatMap(member => {
          const days = member.days.filter(isGiftExceptionDay);
          const shares = member.shares.flatMap(share => {
            const days = share.days.filter(isGiftExceptionDay);
            return days.length || share.overdueGiftTimes ? [{ ...share, days }] : [];
          });
          return shares.length ? [{ ...member, days, shares }] : [];
        });
        return members.length || segment.overdueUnclaimedGiftTimes ? [{ ...segment, members }] : [];
      }),
    };
  }
}
