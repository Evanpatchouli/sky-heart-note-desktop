import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { Model, Types } from 'mongoose';
import { ClubDailyReportStore, reportObjectId } from './club-daily-report.store';
import type { CreateDailyReportDto, CreateReportCorrectionDto } from './club-delivery.dto';
import { DailyReport, type DailyReportLine } from './club-delivery.schema';
import { ClubDirectoryService } from './club-directory.service';
import { addGiftTimesByShare, allPaidGiftsDelivered, eligiblePromotionalFacts, giftDayFacts, giftProgress } from './club-gift-delivery';
import { acceptsGiftExecution, publishedGiftOrder, writableGiftDispatch } from './club-gift-execution.service';
import { activeGiftSegments } from './club-gift-allocation';
import { ClubOrder } from './club-order.schema';
import { correctionView } from './club-settlement-close';

type Submission =
  | (CreateDailyReportDto & { shareId: string; accountId: string })
  | (CreateReportCorrectionDto & { kind: 'correction'; reportId: string });

@Injectable()
export class ClubGiftDeliveryService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    @InjectModel(DailyReport.name) private readonly reports: Model<DailyReport>,
    private readonly directory: ClubDirectoryService,
    private readonly store: ClubDailyReportStore,
  ) {}

  async orderForMember(clubId: string, userId: string, orderId: string) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.orders.findOne({
      _id: reportObjectId(orderId), clubId, dispatchStatus: 'published',
      $or: [{ 'giftDispatch.segments.shares.userId': userId }, { 'shares.userId': userId }],
    }).lean();
    if (!order) throw new NotFoundException('该承接订单不存在');
    return order;
  }

  async history(clubId: string, userId: string, orderId: string, after?: string) {
    const order = await this.orderForMember(clubId, userId, orderId);
    const history = await this.store.history(order, userId, after);
    if (order.dispatchPricing?.priceUnit !== 'gift_times') return { ...history, priceUnit: 'received_hearts' };
    const facts = await giftDayFacts(this.reports.collection, order);
    return { ...history, priceUnit: 'gift_times', giftProgress: giftProgress(order, userId, eligiblePromotionalFacts(order, facts)),
      canRequestClosedCorrection: !!order.settlementClose,
      settlementCorrections: order.settlementCorrections?.filter(row => row.kind === 'daily_report' && row.requestedByUserId === userId).map(correctionView),
    };
  }

  async submit(clubId: string, userId: string, orderId: string, input: Submission):
    Promise<NonNullable<Awaited<ReturnType<ClubDailyReportStore['replay']>>>>;
  async submit(clubId: string, userId: string, orderId: string, input: Submission, prepare: true):
    Promise<{ report: DailyReport; previous: DailyReport }>;
  async submit(clubId: string, userId: string, orderId: string, input: Submission, prepare = false):
    Promise<NonNullable<Awaited<ReturnType<ClubDailyReportStore['replay']>>> | { report: DailyReport; previous: DailyReport }> {
    const correction = input.kind === 'correction';
    const targetId = reportObjectId(correction ? input.reportId : input.shareId);
    const requestedAccountId = correction ? undefined : reportObjectId(input.accountId);
    const requestHash = createHash('sha256').update(JSON.stringify([
      prepare ? 'closed_correction' : input.kind, targetId, requestedAccountId, correction ? input.expectedVersion : input.businessDate, input.reason,
      input.lines.map(line => [line.shareId?.toLowerCase(), line.period, line.quoteSegment, line.giftTimes, line.receivedHearts ?? null]),
    ])).digest('hex');

    const deadline = Date.now() + 8000;
    do {
      const order = await this.orderForMember(clubId, userId, orderId);
      if (order.dispatchPricing?.priceUnit !== 'gift_times')
        throw new ConflictException('该订单使用历史按颗日报');
      const scope = { orderId: order._id, userId, requestId: input.requestId };
      if (order.pendingDailyReport?.requestId === input.requestId && order.pendingDailyReport.userId === userId)
        await this.store.flushPendingReport(order);
      const prior = prepare ? null : await this.store.replay(scope, requestHash, true);
      if (prior) return prior;
      if (prepare && await this.reports.exists(scope))
        throw new ConflictException('相同提交标识已用于其他日报');
      if (order.pendingDailyReport) {
        await this.store.flushPendingReport(order);
        continue;
      }
      if (prepare ? !order.settlementClose || !correction : !!order.closedAt)
        throw new ConflictException(prepare ? '本单尚未确认结单' : '该单已确认结单，请发起日报更正申请');
      if (input.kind === 'daily' && !acceptsGiftExecution(order))
        throw new ConflictException('本单已停止当前送心，请通过补报登记过去实绩');
      const previous = correction ? await this.reports.findOne({
        orderId: order._id, userId, originalId: targetId,
      }).sort({ version: -1 }).lean() : null;
      if (correction) {
        if (!previous) throw new NotFoundException('该日报不存在');
        if (previous.version !== input.expectedVersion) {
          const replayed = prepare ? null : await this.store.replay(scope, requestHash, true);
          if (replayed) return replayed;
          throw new ConflictException('已有新的日报版本，请刷新后核对');
        }
      }

      const shareId = previous?.shareId ?? targetId;
      const accountId = previous?.accountId ?? requestedAccountId!;
      const account = order.giftDispatch?.executionAccounts?.find(item =>
        item.id === accountId.toHexString() && item.userId === userId && item.personalAccountId &&
        item.shareIds.includes(shareId.toHexString()),
      );
      if (!account) throw new NotFoundException('该份额没有关联此本人送心号');
      const linkedShares = new Map<string, number>();
      for (const segment of order.giftDispatch!.segments) {
        for (const share of segment.shares) {
          if (share.userId === userId && account.shareIds.includes(share.id))
            linkedShares.set(share.id, segment.segmentIndex);
        }
      }
      if (!linkedShares.has(shareId.toHexString()))
        throw new NotFoundException('该承接份额不存在');
      const quotes = activeGiftSegments(order);
      const lines: DailyReportLine[] = input.lines.map(line => {
        const lineShareId = line.shareId?.toLowerCase() ?? shareId.toHexString();
        const segmentIndex = linkedShares.get(lineShareId);
        if (segmentIndex === undefined) throw new NotFoundException('日报明细含该送心号未关联的本人份额');
        const quote = quotes[segmentIndex];
        if (!quote || line.quoteSegment !== undefined && line.quoteSegment !== segmentIndex + 1)
          throw new BadRequestException('日报明细的份额和计价段不匹配');
        return {
          shareId: new Types.ObjectId(lineShareId), quoteSegment: segmentIndex + 1,
          period: line.period ?? quote.period, giftTimes: line.giftTimes, receivedHearts: line.receivedHearts ?? null,
        };
      });
      const hearts = lines.reduce((total, line) => total + (line.receivedHearts ?? 0), 0);
      if (!Number.isSafeInteger(hearts))
        throw new BadRequestException('单份日报的实际到账合计超出整数范围');
      const id = new Types.ObjectId();
      const businessDate = correction ? previous!.businessDate : input.businessDate;
      const submittedAt = new Date();
      if (order.giftTermination && input.kind === 'supplement') {
        const stoppedDate = new Date(Date.parse(order.giftTermination.stoppedAt) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
        if (businessDate > stoppedDate) throw new ConflictException('停送后只可补报停送前的实际履约');
      }
      let priceAdjustment: Pick<ClubOrder, 'giftPriceAdjustments' | 'giftPriceAdjustmentState'> | undefined;
      const previousByShare = new Map<string, { times: bigint; scope?: number[] }>();
      for (const line of previous?.lines ?? []) {
        const id = (line.shareId ?? shareId).toHexString();
        const existing = previousByShare.get(id);
        previousByShare.set(id, { times: (existing?.times ?? 0n) + BigInt(line.giftTimes),
          scope: existing?.scope ?? line.promotionPaidSegmentIndices });
      }
      const amendments = order.giftPriceAdjustments ?? [];
      if (amendments.length) {
        const current = amendments.at(-1)!;
        const held = current.state === 'awaiting_decision' || current.state === 'awaiting_supplement' ||
          current.state === 'needs_requote' || current.state === 'stopped';
        const holdDate = new Date(Date.parse(current.holdStartedAt ?? current.submittedAt) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
        if (held && input.kind === 'supplement' && businessDate > holdDate)
          throw new ConflictException('改价暂停或已停送时，只能补报暂停前的实际履约');
        const submitted = new Map<string, bigint>();
        for (const line of lines) addGiftTimesByShare(submitted, line.shareId!.toHexString(), BigInt(line.giftTimes));
        const changedShares = [...new Set([...submitted.keys(), ...previousByShare.keys()])].filter(id =>
          (submitted.get(id) ?? 0n) !== (previousByShare.get(id)?.times ?? 0n));
        for (const id of changedShares) {
          const replacement = amendments.find(item => item.newQuoteSegment === linkedShares.get(id)! + 1);
          if (!replacement || (submitted.get(id) ?? 0n) <= (previousByShare.get(id)?.times ?? 0n)) continue;
          if (replacement.earliestBusinessDate && businessDate < replacement.earliestBusinessDate)
            throw new ConflictException('该日报属于改价前的履约，请使用当时适用的计价段');
          if ([...previousByShare].some(([share, row]) => linkedShares.get(share)! < replacement.newQuoteSegment! - 1 &&
              (submitted.get(share) ?? 0n) < row.times))
            throw new ConflictException('同日可追加改价续送明细，原计价段已有实绩须保留');
        }
        const paidShares = changedShares.filter(id => quotes[linkedShares.get(id)!]?.paidGiftTimes);
        if (held && paidShares.length) {
          const totals = new Map<string, bigint>();
          for (const fact of await giftDayFacts(this.reports.collection, order))
            addGiftTimesByShare(totals, fact._id.shareId.toHexString(), BigInt(fact.giftTimes.toString()));
          const changed = paidShares.some(id => {
            const segment = order.giftDispatch!.segments.find(item => item.segmentIndex === linkedShares.get(id))!;
            const share = segment.shares.find(item => item.id === id)!;
            const limit = BigInt(share.giftTimes - (share.transferredGiftTimes ?? 0));
            const before = totals.get(id) ?? 0n;
            const after = before - (previousByShare.get(id)?.times ?? 0n) + (submitted.get(id) ?? 0n);
            return (before > limit ? limit : before) !== (after > limit ? limit : after);
          });
          if (changed) {
            const state = current.state === 'stopped' ? 'stopped' : 'needs_requote';
            const updated = {
              ...current, state, revision: current.revision + 1,
              latestFactChange: { reportId: id.toHexString(), version: (previous?.version ?? 0) + 1, recordedAt: submittedAt.toISOString() },
            } satisfies typeof current;
            priceAdjustment = {
              giftPriceAdjustments: [...amendments.slice(0, -1), updated],
              giftPriceAdjustmentState: state,
            };
          }
        }
      }
      const promotionalLines = lines.filter(line => quotes[line.quoteSegment! - 1].promotionalGiftTimes);
      if (promotionalLines.some(line => line.giftTimes)) {
        const facts = await giftDayFacts(this.reports.collection, order, undefined, undefined, businessDate);
        const after = new Map<string, bigint>();
        const submitted = new Map<string, bigint>();
        for (const fact of facts) addGiftTimesByShare(after, fact._id.shareId.toHexString(), BigInt(fact.giftTimes.toString()));
        for (const [id, prior] of previousByShare) addGiftTimesByShare(after, id, -prior.times);
        for (const line of lines) {
          const id = line.shareId!.toHexString();
          addGiftTimesByShare(after, id, BigInt(line.giftTimes));
          addGiftTimesByShare(submitted, id, BigInt(line.giftTimes));
        }
        const laterContinuations = new Set(order.continuationQuotes?.flatMap(item =>
          item.receipt && item.window && item.window.startDate > businessDate ? [item.segmentIndex] : [],
        ));
        const applicable = quotes.flatMap((quote, index) =>
          quote.paidGiftTimes && (input.kind === 'daily' || !laterContinuations.has(index)) ? [index] : [],
        );
        for (const line of promotionalLines) {
          const id = line.shareId!.toHexString();
          const prior = previousByShare.get(id);
          const scope = prior?.scope ?? applicable;
          if ((submitted.get(id) ?? 0n) > (prior?.times ?? 0n) && !allPaidGiftsDelivered(order, quotes, scope, after))
            throw new ConflictException('须完成整单已核款的全部付费次数，再登记促销赠送');
          line.promotionPaidSegmentIndices = scope;
        }
      }
      const report: DailyReport = {
        ...scope, _id: id, priceUnit: 'gift_times', clubId,
        shareId, accountId,
        accountName: previous?.accountName ?? account.name,
        accountLocalId: previous?.accountLocalId ?? account.localAccountId,
        personalAccountId: previous?.personalAccountId ?? account.personalAccountId,
        memberNickname: previous ? previous.memberNickname : account.memberNickname,
        recipientGameAccount: previous?.recipientGameAccount ?? account.recipientGameAccount,
        businessDate,
        submittedAt, kind: input.kind, version: (previous?.version ?? 0) + 1,
        originalId: previous?.originalId ?? id, requestHash, reason: input.reason,
        lines, receivedHearts: lines.some(line => line.receivedHearts === null) ? null : hearts,
      };
      if (prepare) return { report, previous: previous! };
      // A rejected duplicate must never invalidate the quote along with a report that was not admitted.
      if (priceAdjustment && !correction && await this.reports.exists({
        orderId: order._id, userId, accountId, businessDate, version: 1,
      })) throw new ConflictException('该送心号在这一天已有日报，请查看原记录或更正');
      if (!await this.store.stage(order, {
        ...(input.kind === 'daily' ? writableGiftDispatch : publishedGiftOrder),
        closedAt: null, clubId, 'giftDispatch.segments.shares.userId': userId,
        ...(promotionalLines.length ? { continuationRevision: order.continuationRevision ?? { $in: [null, 0] } } : {}),
      }, report, priceAdjustment)) {
        await wait(5 + Math.random() * 20);
        continue;
      }
      const recorded = await this.store.replay(scope, requestHash, true);
      if (recorded) return recorded;
      throw new ConflictException(correction
        ? '已有新的日报版本，请刷新后核对'
        : '该送心号在这一天已有日报，请查看原记录或更正');
    } while (Date.now() < deadline);
    throw new ServiceUnavailableException('订单履约正在更新，请重试本次日报');
  }
}
