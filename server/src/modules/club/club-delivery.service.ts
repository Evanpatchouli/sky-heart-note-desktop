import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { Model, Types } from 'mongoose';
import { ClubDailyReportStore, reportObjectId as objectId } from './club-daily-report.store';
import { ClubDirectoryService } from './club-directory.service';
import type {
  CreateDailyReportDto,
  CreateReportCorrectionDto,
} from './club-delivery.dto';
import { DailyReport } from './club-delivery.schema';
import {
  assessDelivery,
  dailyReportView,
  quotedDeliverySegments,
  type AgreedDayReport,
  type ShareDelivery,
} from './club-delivery';
import { summarizeDeliveryPeriods, type DeliveryPeriodRow } from './club-delivery-review';
import { claimedOrderScope } from './club-execution.service';
import { ClubOrder } from './club-order.schema';
import { adjustmentDeliveryHold } from './club-price-adjustment';

type Submission =
  | (CreateDailyReportDto & { shareId: string; accountId: string })
  | (CreateReportCorrectionDto & { kind: 'correction'; reportId: string });

@Injectable()
export class ClubDeliveryService {
  constructor(
    @InjectModel(ClubOrder.name) private readonly orders: Model<ClubOrder>,
    @InjectModel(DailyReport.name) private readonly reports: Model<DailyReport>,
    private readonly directory: ClubDirectoryService,
    private readonly store: ClubDailyReportStore,
  ) {}

  totals(orderIds: readonly Types.ObjectId[], through?: string) {
    if (!orderIds.length) return Promise.resolve([]);
    // Sum the immutable facts directly. No separate delivery counter needs to be repaired.
    return this.reports
      .aggregate<ShareDelivery>([
        {
          $match: {
            orderId: { $in: orderIds },
            kind: 'daily',
            ...(through ? { businessDate: { $lte: through } } : {}),
          },
        },
        {
          $group: {
            _id: { orderId: '$orderId', shareId: '$shareId' },
            receivedHearts: {
              $sum: { $toDecimal: { $toLong: '$receivedHearts' } },
            },
            giftTimes: {
              $sum: {
                $reduce: {
                  input: '$lines',
                  initialValue: 0,
                  in: {
                    $add: [
                      '$$value',
                      { $toDecimal: { $toLong: '$$this.giftTimes' } },
                    ],
                  },
                },
              },
            },
          },
        },
      ])
      .exec();
  }

  async pendingPersonalReports(orders: readonly ClubOrder[], userId: string) {
    if (!orders.length) return new Map<string, number>();
    const rows = await this.reports.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { orderId: { $in: orders.map(({ _id }) => _id) }, userId, kind: { $in: ['supplement', 'correction'] } } },
      { $group: { _id: '$orderId', count: { $sum: 1 } } },
    ]).exec();
    return new Map(rows.map(({ _id, count }) => [_id.toHexString(), count]));
  }

  agreedDayReports(orders: readonly ClubOrder[], through?: string) {
    if (!through) return Promise.resolve([]);
    const orderIds = orders
      .filter(({ shares }) =>
        shares.some(({ agreedReportDates }) =>
          agreedReportDates?.some((date) => date <= through),
        ),
      )
      .map(({ _id }) => _id);
    if (!orderIds.length) return Promise.resolve([]);
    const recorded = { $eq: ['$kind', 'daily'] };
    return this.reports
      .aggregate<AgreedDayReport>([
        { $match: { orderId: { $in: orderIds }, businessDate: { $lte: through } } },
        {
          $group: {
            _id: { orderId: '$orderId', shareId: '$shareId', date: '$businessDate' },
            observedHearts: {
              $sum: {
                $toDecimal: { $toLong: { $cond: [recorded, '$receivedHearts', 0] } },
              },
            },
            reportedAccounts: { $sum: { $cond: [recorded, 1, 0] } },
            supplementPending: { $max: { $eq: ['$kind', 'supplement'] } },
            correctionPending: { $max: { $eq: ['$kind', 'correction'] } },
          },
        },
      ])
      .exec();
  }

  async periodRows(order: ClubOrder, through?: string, includePending = false): Promise<DeliveryPeriodRow[]> {
    await this.flushPendingReport(order);
    return this.confirmedPeriodRows(order, through, includePending);
  }

  confirmedPeriodRows(order: ClubOrder, through?: string, includePending = false): Promise<DeliveryPeriodRow[]> {
    if (!order.shares.length) return Promise.resolve([]);
    const daily = { $eq: ['$kind', 'daily'] };
    const hearts = { $toDecimal: { $toLong: '$lines.receivedHearts' } };
    const times = { $toDecimal: { $toLong: '$lines.giftTimes' } };
    return this.reports.aggregate<DeliveryPeriodRow>([
      { $match: {
        orderId: order._id,
        shareId: { $in: order.shares.map(({ _id }) => _id) },
        ...(!includePending ? { kind: 'daily' } : {}),
        ...(through ? { businessDate: { $lte: through } } : {}),
      } },
      { $unwind: '$lines' },
      { $match: { $or: [
        { kind: { $ne: 'daily' } },
        { 'lines.receivedHearts': { $gt: 0 } },
        { 'lines.giftTimes': { $gt: 0 } },
      ] } },
      {
        $group: {
          _id: { $cond: [daily, {
            shareId: '$shareId',
            period: '$lines.period',
            quoteSegment: { $ifNull: ['$lines.quoteSegment', null] },
          }, null] },
          hearts: { $sum: { $cond: [daily, hearts, 0] } },
          times: { $sum: { $cond: [daily, times, 0] } },
          mismatch: { $max: { $in: ['quantity_mismatch', { $ifNull: ['$checks', []] }] } },
        },
      },
    ]).exec();
  }

  async dispatchPeriodReports(order: ClubOrder, through?: string, after?: string) {
    await this.flushPendingReport(order);
    const pageSize = 25;
    const reports = await this.reports.find({
      orderId: order._id,
      shareId: { $in: order.shares.map(({ _id }) => _id) },
      ...(through ? { businessDate: { $lte: through } } : {}),
      ...(after ? { _id: { $lt: objectId(after) } } : {}),
    }).sort({ _id: -1 }).limit(pageSize + 1).lean();
    const page = reports.slice(0, pageSize);
    return {
      items: page.map((report) => dailyReportView(report)),
      nextCursor: reports.length > pageSize ? page.at(-1)!._id.toHexString() : null,
    };
  }

  async submit(
    clubId: string,
    userId: string,
    orderId: string,
    input: Submission,
  ) {
    const deadline = Date.now() + 8000;
    do {
      const order = await this.requireClaimedOrder(clubId, userId, orderId);
      const result = await this.submitCurrent(order, userId, input);
      if (result) return result;
      // Several accounts can report together. Let a competing admission
      // finish before reading the next order version.
      await wait(5 + Math.random() * 20);
    } while (Date.now() < deadline);
    throw new ConflictException('订单正在录入其他履约记录，请核对后重试');
  }

  private async submitCurrent(order: ClubOrder, userId: string, input: Submission) {
    const target =
      input.kind === 'correction'
        ? {
            reportId: objectId(input.reportId),
            expectedVersion: input.expectedVersion,
          }
        : {
            shareId: objectId(input.shareId),
            accountId: objectId(input.accountId),
            businessDate: input.businessDate,
          };
    const lines = input.lines.map(
      ({ shareId, period, quoteSegment, giftTimes, receivedHearts }) => {
        if (shareId !== undefined || !period || receivedHearts == null)
          throw new BadRequestException('历史按颗日报须填写实际时段与到账颗数');
        return {
          period,
          quoteSegment,
          giftTimes,
          receivedHearts,
        };
      },
    );
    const receivedHearts = lines.reduce(
      (total, line) => total + line.receivedHearts,
      0,
    );
    if (!Number.isSafeInteger(receivedHearts))
      throw new BadRequestException('单份日报的实际到账合计超出整数范围');
    const requestHash = createHash('sha256')
      .update(JSON.stringify([input.kind, target, lines, input.reason]))
      .digest('hex');
    const requestScope = {
      orderId: order._id,
      userId,
      requestId: input.requestId,
    };
    const saved = await this.store.replay(requestScope, requestHash);
    if (saved) return saved;
    if (order.pendingDailyReport) {
      await this.flushPendingReport(order);
      return;
    }
    const hold = adjustmentDeliveryHold(order);
    if (hold && input.kind === 'daily') throw new ConflictException(hold);

    const correction = 'reportId' in target;
    const previous = correction
      ? await this.reports
          .findOne({ orderId: order._id, userId, originalId: target.reportId })
          .sort({ version: -1 })
          .lean()
      : null;
    if (correction && !previous) throw new NotFoundException('该日报不存在');
    const shareId = previous?.shareId ?? target.shareId;
    const accountId = previous?.accountId ?? target.accountId;
    const share = order.shares.find(
      (item) => item.userId === userId && item._id.equals(shareId),
    );
    const account = share?.executionGameAccounts?.find(
      (item) => item._id.equals(accountId) && item.personalAccountId,
    );
    if (!share || !account)
      throw new NotFoundException('该份额中没有关联的本人送心号');
    if (correction && previous!.version !== target.expectedVersion) {
      const replay = await this.store.replay(requestScope, requestHash);
      if (replay) return replay;
      throw new ConflictException('已有新的日报版本，请刷新后核对');
    }

    const id = new Types.ObjectId();
    const checks = assessDelivery(order, lines);
    if (order.priceAdjustment?.state === 'continuing' && input.kind === 'daily') {
      const review = summarizeDeliveryPeriods(order, await this.periodRows(order));
      const quote = quotedDeliverySegments(order);
      const available = new Map(review.breakdown.segments.map(({ number, pendingHearts }) => [number, pendingHearts ?? 0]));
      for (const line of lines) {
        if (!line.receivedHearts && !line.giftTimes) continue;
        const number = line.quoteSegment ?? 0;
        const left = available.get(number);
        if (left === undefined || quote[number - 1]?.period !== line.period ||
            line.receivedHearts > left || checks.includes('quantity_mismatch'))
          throw new ConflictException('日报超出对应时段的可送数量或未匹配计价段，请核对。异常实绩可单列待核对');
        available.set(number, left - line.receivedHearts);
      }
      const delivered = review.totals.find((total) => total._id.shareId.equals(share._id));
      if (BigInt(delivered?.receivedHearts.toString() ?? '0') + BigInt(receivedHearts) > BigInt(share.hearts))
        throw new ConflictException('日报到账超过本份额可送数量，请单列异常实绩待核对');
    }
    const report: DailyReport = {
      ...requestScope,
      _id: id,
      shareId: share._id,
      accountId: account._id,
      accountName: previous?.accountName ?? account.name,
      accountLocalId: previous?.accountLocalId ?? account.localAccountId,
      recipientGameAccount:
        previous?.recipientGameAccount ?? order.recipientGameAccount,
      businessDate: previous?.businessDate ?? target.businessDate!,
      submittedAt: new Date(),
      kind: input.kind,
      version: (previous?.version ?? 0) + 1,
      originalId: previous?.originalId ?? id,
      requestHash,
      reason: input.reason,
      lines,
      receivedHearts,
      checks,
    };
    const staged = await this.store.stage(order, {
      ...claimedOrderScope(order.clubId, userId),
      'priceAdjustment.id': order.priceAdjustment?.id ?? null,
      'priceAdjustment.revision': order.priceAdjustment?.revision ?? null,
      'termination.id': order.termination?.id ?? null,
    }, report);
    if (!staged) return;
    const recorded = await this.store.replay(requestScope, requestHash);
    if (recorded) return recorded;
    throw new ConflictException(
      correction
        ? '已有新的日报版本，请刷新后核对'
        : '该送心号在这一天已有日报，请查看原记录或申请更正',
    );
  }

  flushPendingReport(order: Pick<ClubOrder, '_id' | 'pendingDailyReport'>) {
    return this.store.flushPendingReport(order);
  }

  private async requireClaimedOrder(
    clubId: string,
    userId: string,
    orderId: string,
  ) {
    await this.directory.requireMember(clubId, userId);
    const order = await this.orders
      .findOne({ ...claimedOrderScope(clubId, userId), _id: objectId(orderId) })
      .lean();
    if (!order) throw new NotFoundException('该承接订单不存在');
    return order;
  }

}
