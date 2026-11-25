import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { estimateReceivedHearts, type CustomerGiftProgress, type GiftDispatchSupervision, type GiftMemberSupervision, type GiftSupervisionDay } from '@webapp-template/common';
import { Model } from 'mongoose';
import { ClubDailyReportStore } from './club-daily-report.store';
import { jsonReportCount } from './club-daily-report-view';
import { ClubDirectoryService } from './club-directory.service';
import { activeGiftSegments, giftSchedule, type StoredGiftShare } from './club-gift-allocation';
import { giftDayFacts, type GiftDayFact } from './club-gift-delivery';
import { acceptsGiftExecution } from './club-gift-execution.service';
import { ClubOrder } from './club-order.schema';

type Report = { times: bigint; hearts: bigint; known: number; unknown: number };
const emptyReport = (): Report => ({ times: 0n, hearts: 0n, known: 0, unknown: 0 });

function addReport(total: Report, next: Report) {
  total.times += next.times;
  total.hearts += next.hearts;
  total.known += next.known;
  total.unknown += next.unknown;
}

function toReport(fact: GiftDayFact): Report {
  return {
    times: BigInt(fact.giftTimes.toString()), hearts: BigInt(fact.knownHearts.toString()),
    known: fact.knownLines, unknown: fact.unknownLines,
  };
}

function progress(agreedGiftTimes: number, deliveredGiftTimes: number, report: Report) {
  return {
    agreedGiftTimes, deliveredGiftTimes, remainingGiftTimes: agreedGiftTimes - deliveredGiftTimes,
    actualReceivedHearts: report.known > 0 && report.unknown === 0 ? jsonReportCount(report.hearts) : null,
    knownReceivedHearts: jsonReportCount(report.hearts), unknownReceivedLines: report.unknown,
  };
}

function isStopped(order: ClubOrder & { dispatchWithdrawnAt?: Date; termination?: unknown; priceAdjustment?: { decision?: { value?: string } } }) {
  return !!(order.dispatchWithdrawnAt || order.termination || order.priceAdjustment?.decision?.value === 'decline');
}

export function canContinueGiftOrder(order: ClubOrder) {
  return order.dispatchStatus === 'published' && order.dispatchPricing?.priceUnit === 'gift_times' &&
    order.receipt?.quote.priceUnit === 'gift_times' && order.receipt.receivedAmountCents === order.receipt.quote.totalAmountCents &&
    acceptsGiftExecution(order);
}

type MemberDay = { planned: number; report: Report };

function dayView(businessDate: string, { planned, report }: MemberDay, through?: string): GiftSupervisionDay {
  const hasReport = report.known + report.unknown > 0;
  const status = through && businessDate > through ? 'future' :
    !planned ? 'unplanned' :
    !hasReport ? (through ? 'missing' : 'not_checked') :
    !report.times ? 'reported_zero' :
    report.times < BigInt(planned) ? 'short' : 'on_track';
  return {
    businessDate, plannedGiftTimes: planned, reportedGiftTimes: jsonReportCount(report.times),
    actualReceivedHearts: progress(0, 0, report).actualReceivedHearts, status,
  };
}

function groupedFacts(facts: GiftDayFact[]) {
  const byShare = new Map<string, Map<string, Report>>();
  for (const row of facts) {
    const id = row._id.shareId.toHexString();
    const dates = byShare.get(id) ?? new Map<string, Report>();
    dates.set(row._id.businessDate, toReport(row));
    byShare.set(id, dates);
  }
  return byShare;
}

function shareProgress(share: StoredGiftShare, dates: ReadonlyMap<string, Report>) {
  const report = emptyReport();
  for (const daily of dates.values()) addReport(report, daily);
  const transferred = share.transferredGiftTimes ?? 0;
  const net = share.giftTimes - transferred;
  const delivered = report.times >= BigInt(net) ? net : Number(report.times);
  return { report, transferred, net, delivered };
}

function giftSupervision(order: ClubOrder, facts: GiftDayFact[], names?: Map<string, string>, through?: string) {
  const factsByShare = groupedFacts(facts);
  const dispatchByIndex = new Map(order.giftDispatch?.segments.map(segment => [segment.segmentIndex, segment]));
  const paidWindows = new Map(order.continuationQuotes?.filter(quote => quote.receipt)
    .map(quote => [quote.segmentIndex, quote.window]));
  const active = activeGiftSegments(order);
  const quotes = active.length ? active : order.pricing?.giftSegments ?? order.receipt?.quote.giftSegments ?? [];
  const stopped = isStopped(order);
  const orderReport = emptyReport();
  let totalDelivered = 0;
  const segments = quotes.map((quote, segmentIndex) => {
    const dispatch = dispatchByIndex.get(segmentIndex);
    const window = dispatch ?? paidWindows.get(segmentIndex);
    const segmentReport = emptyReport();
    let segmentDelivered = 0;
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
      const report = emptyReport();
      const memberDays = new Map<string, MemberDay>();
      let original = 0;
      let net = 0;
      let transferred = 0;
      let delivered = 0;
      let overdueGiftTimes = 0;
      function memberDay(date: string) {
        const current = memberDays.get(date) ?? { planned: 0, report: emptyReport() };
        memberDays.set(date, current);
        return current;
      }
      const shareViews = shares.map(share => {
        const facts = factsByShare.get(share.id) ?? new Map<string, Report>();
        const current = shareProgress(share, facts);
        const originalWindow = { startDate: share.startDate, endDate: share.endDate };
        addReport(report, current.report);
        original += share.giftTimes;
        net += current.net;
        transferred += current.transferred;
        delivered += current.delivered;
        const schedule = names ? giftSchedule(share.days) : new Map<string, number>();
        const scheduledDates = [...schedule.keys()].sort();
        const startDate = scheduledDates[0];
        const endDate = scheduledDates.at(-1);
        const overdue = through && !stopped && !order.closedAt && endDate && endDate <= through
          ? current.net - current.delivered : 0;
        overdueGiftTimes += overdue;
        const days: GiftSupervisionDay[] = [];
        if (names) {
          for (const [date, amount] of schedule) memberDay(date).planned += amount;
          for (const [date, day] of facts) addReport(memberDay(date).report, day);
          for (const date of [...new Set([...scheduledDates, ...facts.keys()])].sort())
            days.push(dayView(date, { planned: schedule.get(date) ?? 0, report: facts.get(date) ?? emptyReport() }, through));
        }
        return {
          ...progress(current.net, current.delivered, current.report),
          shareId: share.id, originalWindow, window: startDate && endDate ? { startDate, endDate } : null,
          transferredGiftTimes: current.transferred, overdueGiftTimes: overdue, days,
        };
      });
      addReport(segmentReport, report);
      segmentDelivered += delivered;
      netClaimed += net;
      if (names) members.push({
        userId, nickname: names.get(userId) ?? null, ...progress(net, delivered, report),
        originallyClaimedGiftTimes: original, transferredGiftTimes: transferred, overdueGiftTimes, shares: shareViews,
        days: [...memberDays].sort(([a], [b]) => a.localeCompare(b))
          .map(([date, values]) => dayView(date, values, through)),
      });
    }
    addReport(orderReport, segmentReport);
    totalDelivered += segmentDelivered;
    const unclaimed = quote.paidGiftTimes - netClaimed;
    return {
      customer: {
        segmentIndex, ...quote, ...progress(quote.paidGiftTimes, segmentDelivered, segmentReport),
        window: window ? { startDate: window.startDate, endDate: window.endDate } : null,
        estimatedReceivedHearts: estimateReceivedHearts(quote.paidGiftTimes, quote.period) ?? null,
        claimObservedReceivedHearts: [...observed].sort((a, b) => a - b), unknownClaimObservations,
      },
      dispatch: {
        claimedGiftTimes: netClaimed, unclaimedGiftTimes: unclaimed,
        overdueUnclaimedGiftTimes: through && !stopped && !order.closedAt && window && window.endDate <= through ? unclaimed : 0,
        members,
      },
    };
  });
  const agreed = active.length ? active.reduce((sum, quote) => sum + quote.paidGiftTimes, 0) : order.heartDelivery.requestedGiftTimes!;
  const customer: CustomerGiftProgress = {
    priceUnit: 'gift_times', ...progress(agreed, totalDelivered, orderReport),
    estimatedReceivedHearts: order.heartDelivery.estimatedReceivedHearts ?? null,
    claimObservedReceivedHearts: [...new Set(segments.flatMap(({ customer }) => customer.claimObservedReceivedHearts))].sort((a, b) => a - b),
    unknownClaimObservations: segments.reduce((sum, { customer }) => sum + customer.unknownClaimObservations, 0),
    segments: segments.map(segment => segment.customer),
    closedAt: order.closedAt?.toISOString() ?? null,
    fulfillmentStatus: stopped ? 'stopped' : totalDelivered === agreed ? 'completed' :
      order.dispatchStatus === 'published' ? 'in_progress' : 'not_started',
    canRequestContinuation: canContinueGiftOrder(order),
  };
  return { customer, segments };
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
    const hasExceptions = !!through && !isStopped(order) && !order.closedAt && segments.some(segment =>
      segment.overdueUnclaimedGiftTimes ||
      segment.members.some(member => member.shares.some(share => share.overdueGiftTimes || share.days.some(isGiftExceptionDay))),
    );
    return { ...result.customer, through: through ?? null, hasExceptions, segments };
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
